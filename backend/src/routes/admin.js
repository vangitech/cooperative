import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { generateRef, toMoney, isPositiveNumber, asyncHandler, sendCsv } from '../utils/helpers.js';
import { audit, auditTx } from '../lib/audit.js';
import { nextMemberNo, verifyKyc, validateDocument, ID_TYPES } from '../lib/onboarding.js';
import { bytidConfigured } from '../lib/bytid.js';
import { postJournal } from '../lib/ledger.js';
import { surplusForMonth, DEFAULT_PAYOUT_RATIO, periodOf } from '../lib/ledger.js';
import { assignVirtualAccount } from '../lib/virtualAccounts.js';
import { ensureSchedules } from '../lib/loans.js';
import { notify } from '../lib/notify.js';
import { settleDueCollections } from '../lib/collections.js';
import { runDuePlans } from '../lib/plans.js';
import { ALL_ROLES } from '../lib/permissions.js';

const router = express.Router();
router.use(authenticate);

/* ---------- Stats ---------- */
router.get('/stats', requirePerm('overview.read'), asyncHandler(async (req, res) => {
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='member') AS total_members,
      (SELECT COUNT(*) FROM users WHERE status='active') AS active_members,
      (SELECT COALESCE(SUM(balance),0) FROM wallets) AS total_wallet_balance,
      (SELECT COALESCE(SUM(amount),0) FROM savings) AS total_savings,
      (SELECT COALESCE(SUM(amount),0) FROM loans WHERE status IN ('disbursed','approved')) AS active_loans_amount,
      (SELECT COUNT(*) FROM loans WHERE status='pending') AS pending_loans,
      (SELECT COALESCE(SUM(amount),0) FROM dividends WHERE status='paid') AS total_dividends_paid,
      (SELECT COUNT(*) FROM transactions) AS total_transactions,
      (SELECT COUNT(DISTINCT loan_id) FROM loan_schedules
        WHERE due_date < CURRENT_DATE AND amount_paid < amount_due) AS overdue_loans,
      (SELECT COALESCE(SUM(amount),0) FROM fixed_deposits WHERE status = 'active') AS active_fixed_deposits
  `);

  const monthly = await query(`
    SELECT TO_CHAR(DATE_TRUNC('month', savings_date), 'Mon YYYY') AS month,
           SUM(amount)::float AS total
    FROM savings
    WHERE savings_date >= (CURRENT_DATE - INTERVAL '6 months')
    GROUP BY DATE_TRUNC('month', savings_date)
    ORDER BY DATE_TRUNC('month', savings_date)
  `);

  res.json({ stats: stats.rows[0], monthlySavings: monthly.rows });
}));

/* ---------- Members ---------- */
router.get('/users', requirePerm('members.read'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.member_no, u.created_at,
           COALESCE(w.balance,0) AS balance,
           (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id=u.id) AS total_savings,
           k.status AS kyc_status,
           v.account_number AS funding_account, v.bank_name AS funding_bank,
           o.name AS org_name, o.code AS org_code
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN kyc_profiles k ON k.user_id = u.id
    LEFT JOIN virtual_accounts v ON v.user_id = u.id
    LEFT JOIN organisation_members m ON m.user_id = u.id AND m.is_primary AND m.status = 'active'
    LEFT JOIN organisations o ON o.id = m.org_id
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/users/:id/status', requirePerm('members.review'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ message: 'Invalid status' });
  if (String(req.params.id) === String(req.user.id))
    return res.status(400).json({ message: 'You cannot change your own status' });
  const { rows } = await query(
    `UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'User not found' });
  audit(req, `member.${status}`, 'user', req.params.id, {});
  if (status === 'active') {
    notify(req.params.id, {
      title: 'Membership approved',
      body: 'Your account is active. You can now save, borrow and earn dividends.',
      link: '/dashboard',
    });
  }
  res.json(rows[0]);
}));

router.patch('/users/:id/role', requirePerm('*'), asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!ALL_ROLES.includes(role))
    return res.status(400).json({ message: `Invalid role (one of: ${ALL_ROLES.join(', ')})` });
  if (String(req.params.id) === String(req.user.id))
    return res.status(400).json({ message: 'You cannot change your own role' });
  const { rows } = await query(
    `UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING id, role`,
    [role, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'User not found' });
  audit(req, `member.role_${role}`, 'user', req.params.id, {});
  res.json(rows[0]);
}));

/* ---------- Staff-assisted onboarding (admin/officer creates member + KYC) ---------- */
// One atomic call: user + wallet + member number + affiliation + KYC profile +
// guarantors + identity documents, then the system verification pass.
// IDs are MANDATORY: private workers provide NIN + BVN (both registry-verified),
// civil servants provide IPPIS + BVN. No member is created without verified identity.
// Password: supplied (min 6) or a one-time temp password returned in the
// response for the officer to hand over in person. KYC auto-approval is
// admin-only (separation of duties: officers capture, admins approve).
router.post('/users', requirePerm('members.create'), async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, address, password, orgId,
      status = 'pending', autoApproveKyc = false, employmentType,
      ippisNumber, bvn,
      kyc = {}, guarantors = [], documents = [],
    } = req.body;

    if (!firstName || !lastName || !email)
      return res.status(400).json({ message: 'First name, last name and email are required' });
    if (!['private', 'civil_servant'].includes(employmentType))
      return res.status(400).json({ message: 'Choose private worker or civil servant' });
    if (password && password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    if (!['pending', 'active'].includes(status))
      return res.status(400).json({ message: 'Status must be pending or active' });
    if (autoApproveKyc && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Only admins can auto-approve KYC' });
    if (!bytidConfigured())
      return res.status(503).json({ message: 'Identity verification service unavailable — try again shortly' });

    const exists = await query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ message: 'Email already registered' });

    const cleanBvn = String(bvn || '').trim();
    if (!/^\d{11}$/.test(cleanBvn))
      return res.status(400).json({ message: 'BVN (11 digits) is mandatory' });

    let ippis = null;
    if (employmentType === 'civil_servant') {
      ippis = String(ippisNumber || '').trim();
      if (!/^\d{4,12}$/.test(ippis))
        return res.status(400).json({ message: 'IPPIS number (4–12 digits) is mandatory for civil servants' });
      const dup = await query('SELECT id FROM users WHERE ippis_number = $1', [ippis]);
      if (dup.rows.length) return res.status(409).json({ message: 'This IPPIS number is already registered' });
    }

    const {
      dob, gender, occupation, employer, idType, idNumber,
      residentialAddress, nextOfKinName, nextOfKinPhone, nextOfKinRelationship,
    } = kyc;
    // Private workers MUST present full KYC with NIN; civil servants present
    // IPPIS+BVN above and may attach a full KYC profile when NIN is available.
    const needsKyc = employmentType === 'private' || idType || idNumber;
    if (employmentType === 'private') {
      if (idType !== 'nin')
        return res.status(400).json({ message: 'Private workers must present a NIN' });
      if (!/^\d{11}$/.test(String(idNumber || '').trim()))
        return res.status(400).json({ message: 'NIN (11 digits) is mandatory' });
      if (!nextOfKinName || !nextOfKinPhone)
        return res.status(400).json({ message: 'Next of kin name and phone are required' });
      if (!dob)
        return res.status(400).json({ message: 'Date of birth is required' });
    } else if (needsKyc) {
      if (!idType || !ID_TYPES.includes(idType))
        return res.status(400).json({ message: `ID type must be one of: ${ID_TYPES.join(', ')}` });
      if (!idNumber) return res.status(400).json({ message: 'ID number is required' });
      if (!nextOfKinName || !nextOfKinPhone)
        return res.status(400).json({ message: 'Next of kin name and phone are required' });
    }
    if (guarantors.length > 2)
      return res.status(400).json({ message: 'Maximum of 2 guarantors' });
    for (const g of guarantors) {
      if (!g.fullName || !g.phone)
        return res.status(400).json({ message: 'Each guarantor needs a name and phone' });
    }
    if (documents.length > 5)
      return res.status(400).json({ message: 'Maximum of 5 documents' });
    const files = documents.map(validateDocument);

    const tempPassword = password || crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(tempPassword, 10);

    const result = await withTransaction(async (client) => {
      const org = await client.query(
        `SELECT id FROM organisations WHERE id = $1 AND status = 'active'`, [orgId || 0]
      );
      const affiliationId = org.rows[0]?.id || (await client.query(
        `SELECT id FROM organisations WHERE code = 'GEN'`
      )).rows[0].id;
      const memberNo = await nextMemberNo(client, affiliationId);

      const u = await client.query(
        `INSERT INTO users (first_name,last_name,email,password_hash,phone,address,status,member_no,employment_type,ippis_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, first_name, last_name, email, phone, role, status, member_no, employment_type, created_at`,
        [firstName, lastName, String(email).toLowerCase(), hash, phone || null, address || null,
         status, memberNo, employmentType, ippis]
      );
      const user = u.rows[0];
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [user.id]);
      await client.query(
        `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary, verified_by)
         VALUES ($1,$2,$3,true,$4)`,
        [user.id, affiliationId, memberNo, req.user.id]
      );

      let kycRow = null;
      let verification = null;
      if (needsKyc) {
        const k = await client.query(
          `INSERT INTO kyc_profiles
             (user_id, dob, gender, occupation, employer, id_type, id_number,
              residential_address, next_of_kin_name, next_of_kin_phone,
              next_of_kin_relationship, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
           RETURNING *`,
          [user.id, dob || null, gender || null, occupation || null, employer || null,
           idType, String(idNumber).trim(), residentialAddress || null,
           nextOfKinName, nextOfKinPhone, nextOfKinRelationship || null]
        );
        kycRow = k.rows[0];
        verification = await verifyKyc(client, {
          userId: user.id, email: user.email, phone: user.phone, firstName, lastName, dob,
          idType, idNumber, bvn: cleanBvn, documents: files,
        });
        const approved = autoApproveKyc && verification.passed;
        const v = await client.query(
          `UPDATE kyc_profiles
           SET verification_result = $1, verified_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
               status = CASE WHEN $2 THEN 'approved' ELSE 'pending' END,
               reviewed_by = CASE WHEN $2 THEN $3::integer ELSE NULL END,
               reviewed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
           WHERE user_id = $4 RETURNING *`,
          [JSON.stringify(verification), approved, req.user.id, user.id]
        );
        kycRow = v.rows[0];
      }

      const kin = [];
      for (const g of guarantors) {
        const r = await client.query(
          `INSERT INTO guarantors (user_id, full_name, phone, email, relationship)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [user.id, g.fullName, g.phone, g.email || null, g.relationship || null]
        );
        kin.push(r.rows[0]);
      }

      const docs = [];
      files.forEach((f, i) => docs.push({ ...f, filename: documents[i].filename, mime: documents[i].mime }));
      for (const f of docs) {
        await client.query(
          `INSERT INTO kyc_documents (user_id, doc_type, filename, mime, size_bytes, data, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [user.id, f.docType, f.filename, f.mime, f.size, f.bytes, req.user.id]
        );
      }

      await auditTx(client, req, 'member.onboarded', 'user', user.id,
        { email: user.email, memberNo, orgId: affiliationId, status, kyc: !!kycRow,
          verification: verification ? { passed: verification.passed, score: verification.score } : null,
          guarantors: kin.length, documents: docs.length });
      if (kycRow) {
        await auditTx(client, req, 'kyc.submitted', 'kyc', user.id,
          { idType, by: 'staff' },
          { before: null, after: { status: kycRow.status }, actorId: req.user.id });
      }
      return { user, kyc: kycRow, verification, guarantors: kin, affiliationId, memberNo,
               docCount: docs.length };
    });

    // Funding account number: best-effort (member ID is instant; account follows).
    let virtualAccount = null;
    try {
      const nin = /^\d{11}$/.test(String(kyc.idNumber || '').trim()) ? String(kyc.idNumber).trim() : undefined;
      virtualAccount = await assignVirtualAccount(result.user.id, { nin, bvn: cleanBvn });
    } catch (e) {
      console.error('virtual account deferred:', e.message);
    }

    const { password_hash, ...safeUser } = result.user;
    res.status(201).json({
      ...result, user: safeUser,
      tempPassword: password ? undefined : tempPassword,
      virtualAccount,
    });
  } catch (e) {
    console.error(e);
    res.status(e.status || 400).json({ message: e.message || 'Onboarding failed' });
  }
});

/* ---------- Transactions ---------- */
router.get('/transactions', requirePerm('transactions.read'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, u.first_name, u.last_name, u.email
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Savings ---------- */
router.get('/savings', requirePerm('savings.read'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT s.*, u.first_name, u.last_name, u.email
    FROM savings s JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Loans ---------- */
router.get('/loans', requirePerm('loans.read'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT l.*, u.first_name, u.last_name, u.email
    FROM loans l JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/loans/:id', requirePerm('loans.review'), async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    const result = await withTransaction(async (client) => {
      const l = await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [req.params.id]);
      const loan = l.rows[0];
      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'pending') throw new Error('Loan already reviewed');

      if (status === 'rejected') {
        const r = await client.query(
          `UPDATE loans SET status='rejected', reviewed_by=$1, reviewed_at=NOW(), review_note=$2
           WHERE id=$3 RETURNING *`,
          [req.user.id, note || null, loan.id]
        );
        await auditTx(client, req, 'loan.rejected', 'loan', loan.id,
          { amount: Number(loan.amount) },
          { before: { status: 'pending' }, after: { status: 'rejected' } });
        return r.rows[0];
      }

      // approved → disburse into wallet
      const w = await client.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [loan.user_id]);
      const newBalance = toMoney(Number(w.rows[0].balance) + Number(loan.amount));
      await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [
        newBalance, loan.user_id,
      ]);
      const disbTx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'loan_disbursement',$3,$4,$5,$6) RETURNING *`,
        [loan.user_id, w.rows[0].id, loan.amount, newBalance, generateRef('LND'), `Loan #${loan.id} disbursement`]
      );
      // Disbursal creates the loan asset against the member's wallet claim.
      // No float moves: this is internal credit creation, not a payout.
      await postJournal(client, req, { type: 'loan_disbursement', transactionId: disbTx.rows[0].id,
        reference: disbTx.rows[0].reference, amount: Number(loan.amount),
        lines: [
          { code: '1200', debit: Number(loan.amount), credit: 0 },
          { code: '1100', debit: 0, credit: Number(loan.amount) },
        ] });
      const r = await client.query(
        `UPDATE loans SET status='disbursed', reviewed_by=$1, reviewed_at=NOW(), review_note=$2
         WHERE id=$3 RETURNING *`,
        [req.user.id, note || null, loan.id]
      );
      await ensureSchedules(client, r.rows[0]);
      await auditTx(client, req, 'loan.approved', 'loan', loan.id,
        { amount: Number(loan.amount) },
        { before: { status: 'pending', balance: Number(w.rows[0].balance) },
          after: { status: 'disbursed', balance: newBalance } });
      return r.rows[0];
    });

    notify(result.user_id, status === 'approved'
      ? { title: 'Loan approved', body: `Your loan of ${result.amount} has been disbursed to your wallet.`, link: '/loans' }
      : { title: 'Loan application update', body: 'Your loan application was not approved. Contact support for details.', link: '/loans' });
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

/* ---------- Dividends ---------- */
router.get('/dividends', requirePerm('dividends.manage'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT d.*, u.first_name, u.last_name, u.email
    FROM dividends d JOIN users u ON u.id = d.user_id
    ORDER BY d.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

// Declare a dividend (propose). If totalAmount provided → distributed equally
// among active members. If userId + amount provided → single member.
// D1: one declaration per member+period (409 on retry); rows land as pending.
// D2: pass capMonth (YYYY-MM) to enforce totalAmount ≤ surplus × payoutRatio.
router.post('/dividends', requirePerm('dividends.manage'), async (req, res) => {
  try {
    const { period, totalAmount, userId, amount, capMonth, payoutRatio } = req.body;
    if (!period) return res.status(400).json({ message: 'Period is required (e.g. "2025 Q1")' });

    let cap = null;
    const ratio = payoutRatio !== undefined ? Number(payoutRatio) : DEFAULT_PAYOUT_RATIO;
    if (payoutRatio !== undefined && !(ratio > 0 && ratio <= 1))
      throw new Error('payoutRatio must be between 0 and 1');
    if (capMonth) {
      const s = await surplusForMonth(capMonth);
      cap = { ...s, ratio, maxDistributable: toMoney(Math.max(0, s.surplus * ratio)) };
    }
    const enforceCap = (total) => {
      if (cap && Number(total) > cap.maxDistributable) {
        throw new Error(
          `₦${total} exceeds the distributable cap of ₦${cap.maxDistributable} ` +
          `(surplus ₦${cap.surplus} × ${Math.round(cap.ratio * 100)}% for ${cap.month})`
        );
      }
    };

    const declareTx = async (client, uid, amt) => {
      try {
        const r = await client.query(
          `INSERT INTO dividends (user_id, amount, period) VALUES ($1,$2,$3) RETURNING *`,
          [uid, toMoney(amt), period]
        );
        await postJournal(client, req, { type: 'dividend_declared',
          reference: `${period} → user #${uid}`, amount: Number(r.rows[0].amount),
          lines: [
            { code: '3002', debit: Number(r.rows[0].amount), credit: 0 },
            { code: '2002', debit: 0, credit: Number(r.rows[0].amount) },
          ] });
        await auditTx(client, req, 'dividend.declared', 'dividend', r.rows[0].id,
          { period, amount: Number(r.rows[0].amount), member: uid, cap });
        return r.rows[0];
      } catch (e) {
        if (e.code === '23505') throw new Error(`Member #${uid} already declared for ${period}`);
        throw e;
      }
    };

    const inserted = await withTransaction(async (client) => {
      if (userId) {
        if (!isPositiveNumber(amount)) throw new Error('Amount is required for single member');
        enforceCap(amount);
        return [await declareTx(client, userId, amount)];
      }

      if (!isPositiveNumber(totalAmount)) throw new Error('totalAmount or userId+amount required');
      enforceCap(totalAmount);
      const members = await client.query(`SELECT id FROM users WHERE role='member' AND status='active'`);
      if (!members.rows.length) throw new Error('No active members');
      const per = toMoney(Number(totalAmount) / members.rows.length);

      const out = [];
      for (const m of members.rows) {
        out.push(await declareTx(client, m.id, per));
      }
      return out;
    });

    for (const d of inserted) {
      notify(d.user_id, {
        title: 'Dividend declared',
        body: `You received ${d.amount} for ${period}.`,
        link: '/dividends',
      });
    }
    res.status(201).json({ count: inserted.length, dividends: inserted });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.patch('/dividends/:id/pay', requirePerm('dividends.manage'), async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const d = await client.query('SELECT * FROM dividends WHERE id=$1 FOR UPDATE', [req.params.id]);
      const div = d.rows[0];
      if (!div) throw new Error('Dividend not found');
      if (div.status === 'paid') throw new Error('Already paid');
      if (div.status !== 'approved') throw new Error('Dividend must be approved before payout');

      const w = await client.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [div.user_id]);
      const newBalance = toMoney(Number(w.rows[0].balance) + Number(div.amount));
      await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [
        newBalance, div.user_id,
      ]);

      const tx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'dividend',$3,$4,$5,$6) RETURNING *`,
        [div.user_id, w.rows[0].id, div.amount, newBalance, generateRef('DIV'), `Dividend ${div.period}`]
      );

      const r = await client.query(
        `UPDATE dividends SET status='paid', transaction_id=$1 WHERE id=$2 RETURNING *`,
        [tx.rows[0].id, div.id]
      );
      await auditTx(client, req, 'dividend.paid', 'dividend', div.id,
        { amount: Number(div.amount) },
        { before: { status: 'pending', balance: Number(w.rows[0].balance) },
          after: { status: 'paid', balance: newBalance } });
      await postJournal(client, req, { type: 'dividend', transactionId: tx.rows[0].id,
        reference: tx.rows[0].reference, amount: Number(div.amount),
        lines: [
          { code: '2002', debit: Number(div.amount), credit: 0 },
          { code: '1100', debit: 0, credit: Number(div.amount) },
        ] });
      return r.rows[0];
    });
    notify(result.user_id, {
      title: 'Dividend paid',
      body: `${result.amount} for ${result.period} is now in your wallet.`,
      link: '/dividends',
    });
    await settleDueCollections(withTransaction, result.user_id);
    await runDuePlans();
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// D1: approve a proposed dividend (admin-only: declarer cannot self-approve).
router.patch('/dividends/:id/approve', requirePerm('*'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE dividends SET status = 'approved', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pending dividend not found' });
  audit(req, 'dividend.approved', 'dividend', rows[0].id,
    { period: rows[0].period, amount: Number(rows[0].amount) });
  res.json(rows[0]);
}));

// D1: pay a whole approved period atomically — no half-paid periods.
router.post('/dividends/pay-period', requirePerm('dividends.manage'), async (req, res) => {
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ message: 'Period is required' });
    const paid = await withTransaction(async (client) => {
      const list = await client.query(
        `SELECT * FROM dividends WHERE period = $1 AND status = 'approved' ORDER BY id FOR UPDATE`,
        [period]
      );
      if (!list.rows.length) throw new Error('No approved dividends for this period');
      const out = [];
      for (const div of list.rows) {
        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [div.user_id]);
        const newBalance = toMoney(Number(w.rows[0].balance) + Number(div.amount));
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
          newBalance, div.user_id,
        ]);
        const tx = await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'dividend',$3,$4,$5,$6) RETURNING *`,
          [div.user_id, w.rows[0].id, div.amount, newBalance, generateRef('DIV'), `Dividend ${div.period}`]
        );
        const r = await client.query(
          `UPDATE dividends SET status = 'paid', transaction_id = $1 WHERE id = $2 RETURNING *`,
          [tx.rows[0].id, div.id]
        );
        await auditTx(client, req, 'dividend.paid', 'dividend', div.id,
          { amount: Number(div.amount), batch: period },
          { before: { status: 'approved', balance: Number(w.rows[0].balance) },
            after: { status: 'paid', balance: newBalance } });
        await postJournal(client, req, { type: 'dividend', transactionId: tx.rows[0].id,
          reference: tx.rows[0].reference, amount: Number(div.amount),
          lines: [
            { code: '2002', debit: Number(div.amount), credit: 0 },
            { code: '1100', debit: 0, credit: Number(div.amount) },
          ] });
        out.push(r.rows[0]);
        notify(div.user_id, {
          title: 'Dividend paid',
          body: `${div.amount} for ${div.period} is now in your wallet.`,
          link: '/dividends',
        });
      }
      return out;
    });
    res.json({ period, count: paid.length, dividends: paid });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// D2: surplus + distributable cap for a journal month (YYYY-MM).
router.get('/dividends/surplus', requirePerm('dividends.manage'), asyncHandler(async (req, res) => {
  const month = req.query.month || periodOf(new Date());
  const s = await surplusForMonth(month);
  const ratio = DEFAULT_PAYOUT_RATIO;
  res.json({ ...s, payoutRatio: ratio, maxDistributable: toMoney(Math.max(0, s.surplus * ratio)) });
}));

/* ---------- Loan products ---------- */
router.get('/loan-products', requirePerm('loans.read'), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM loan_products ORDER BY min_amount');
  res.json(rows);
}));

router.post('/loan-products', requirePerm('loans.review'), asyncHandler(async (req, res) => {
  const {
    name, description, interestRate, penaltyRate, minAmount, maxAmount,
    minDurationMonths, maxDurationMonths, requiredSavingsMultiple,
    minMembershipMonths, requiresGuarantors, guarantorCount,
  } = req.body;
  if (!name || interestRate === undefined)
    return res.status(400).json({ message: 'Name and interest rate are required' });
  try {
    const { rows } = await query(
      `INSERT INTO loan_products
         (name, description, interest_rate, penalty_rate, min_amount, max_amount,
          min_duration_months, max_duration_months, required_savings_multiple,
          min_membership_months, requires_guarantors, guarantor_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        name, description || null, interestRate, penaltyRate ?? 5, minAmount ?? 0, maxAmount || null,
        minDurationMonths ?? 1, maxDurationMonths ?? 12, requiredSavingsMultiple ?? 0,
        minMembershipMonths ?? 0, !!requiresGuarantors, guarantorCount ?? 0,
      ]
    );
    audit(req, 'loan_product.created', 'loan_product', rows[0].id, { name }, { after: rows[0] });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'A product with that name exists' });
    throw e;
  }
}));

router.patch('/loan-products/:id', requirePerm('loans.review'), asyncHandler(async (req, res) => {
  const allowed = [
    'description', 'interest_rate', 'penalty_rate', 'min_amount', 'max_amount',
    'min_duration_months', 'max_duration_months', 'required_savings_multiple',
    'min_membership_months', 'requires_guarantors', 'guarantor_count', 'status',
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[key] !== undefined || req.body[camel] !== undefined) {
      params.push(req.body[key] !== undefined ? req.body[key] : req.body[camel]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ message: 'Nothing to update' });
  const before = await query('SELECT * FROM loan_products WHERE id = $1', [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ message: 'Product not found' });
  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE loan_products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
  audit(req, 'loan_product.updated', 'loan_product', rows[0].id,
    { name: rows[0].name }, { before: before.rows[0], after: rows[0] });
  res.json(rows[0]);
}));

/* ---------- Fixed deposits ---------- */
router.get('/fixed-deposits', requirePerm('savings.read'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT f.*, u.first_name, u.last_name, u.email
    FROM fixed_deposits f JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Exports ---------- */
router.get('/export/transactions.csv', requirePerm('exports'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.created_at, u.email, t.reference, t.type, t.description, t.amount, t.balance_after
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-transactions.csv',
    ['Date', 'Member Email', 'Reference', 'Type', 'Description', 'Amount', 'Balance After'],
    rows.map((t) => [t.created_at, t.email, t.reference, t.type, t.description, t.amount, t.balance_after]));
  audit(req, 'export.downloaded', 'export', null, { file: 'mpcs-transactions.csv', rows: rows.length });
}));

router.get('/export/loans.csv', requirePerm('exports'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT l.id, u.email, l.amount, l.interest_rate, l.duration_months, l.total_repayable,
           l.amount_paid, l.penalty_accrued, l.status, l.created_at
    FROM loans l JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-loans.csv',
    ['ID', 'Member Email', 'Amount', 'Rate %', 'Months', 'Repayable', 'Paid', 'Penalties', 'Status', 'Created'],
    rows.map((l) => [l.id, l.email, l.amount, l.interest_rate, l.duration_months, l.total_repayable, l.amount_paid, l.penalty_accrued, l.status, l.created_at]));
  audit(req, 'export.downloaded', 'export', null, { file: 'mpcs-loans.csv', rows: rows.length });
}));

router.get('/export/members.csv', requirePerm('exports'), asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at,
           COALESCE(w.balance,0) AS balance
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    ORDER BY u.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-members.csv',
    ['First Name', 'Last Name', 'Email', 'Phone', 'Role', 'Status', 'Joined', 'Wallet Balance'],
    rows.map((u) => [u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at, u.balance]));
  audit(req, 'export.downloaded', 'export', null, { file: 'mpcs-members.csv', rows: rows.length });
}));

/* ---------- Manual funding (officer credits a member by email/account) ---------- */
router.post('/fund', requirePerm('fund'), asyncHandler(async (req, res) => {
  const { identifier, amount, note } = req.body;
  if (!identifier) return res.status(400).json({ message: 'Member email or account number is required' });
  if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
  const amt = toMoney(amount);

  const result = await withTransaction(async (client) => {
    const q = String(identifier).trim();
    let target = null;
    if (/^\d{10}$/.test(q)) {
      const va = await client.query(
        'SELECT u.* FROM virtual_accounts v JOIN users u ON u.id = v.user_id WHERE v.account_number = $1',
        [q]
      );
      target = va.rows[0];
    } else {
      const u = await client.query('SELECT * FROM users WHERE email = $1', [q.toLowerCase()]);
      target = u.rows[0];
    }
    if (!target) throw new Error('Member not found');
    if (target.status !== 'active') throw new Error('Member account is not active');

    const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [target.id]);
    if (!w.rows[0]) throw new Error('Wallet not found');
    const newBalance = toMoney(Number(w.rows[0].balance) + amt);
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
      newBalance, w.rows[0].id,
    ]);
    const tx = await client.query(
      `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
       VALUES ($1,$2,'deposit',$3,$4,$5,$6) RETURNING *`,
      [target.id, w.rows[0].id, amt, newBalance, generateRef('ADM'), note || 'Officer funding']
    );
    await client.query(
      `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
      [target.id, 'Wallet funded', `${amt} NGN was added to your wallet by an officer.`, '/wallet']
    );
    await auditTx(client, req, 'wallet.funded_manual', 'user', target.id,
      { amount: amt, note: note || null },
      { before: { balance: Number(w.rows[0].balance) }, after: { balance: newBalance } });
    await postJournal(client, req, { type: 'deposit', transactionId: tx.rows[0].id,
      reference: tx.rows[0].reference, amount: amt, direction: 'in' });
    return { member: `${target.first_name} ${target.last_name}`, transaction: tx.rows[0], balance: newBalance };
  });

  await settleDueCollections(withTransaction, result.transaction.user_id);
  await runDuePlans();
  res.status(201).json(result);
}));

/* ---------- Audit log ---------- */
router.get('/audit-logs', requirePerm('audit.read'), asyncHandler(async (req, res) => {
  const { action, entity, limit } = req.query;
  const conditions = [];
  const params = [];
  if (action) {
    params.push(`%${action}%`);
    conditions.push(`a.action ILIKE $${params.length}`);
  }
  if (entity) {
    params.push(entity);
    conditions.push(`a.entity = $${params.length}`);
  }
  const lim = Math.min(Number(limit) || 100, 500);
  params.push(lim);
  const { rows } = await query(
    `SELECT a.*, u.first_name, u.last_name, u.email
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY a.created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows);
}));

export default router;