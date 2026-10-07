import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateRef, toMoney, isPositiveNumber, asyncHandler, sendCsv } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { ensureSchedules } from '../lib/loans.js';
import { notify } from '../lib/notify.js';
import { settleDueCollections } from '../lib/collections.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

/* ---------- Stats ---------- */
router.get('/stats', asyncHandler(async (req, res) => {
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
router.get('/users', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at,
           COALESCE(w.balance,0) AS balance,
           (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id=u.id) AS total_savings,
           k.status AS kyc_status
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN kyc_profiles k ON k.user_id = u.id
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ message: 'Invalid status' });
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

router.patch('/users/:id/role', asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['member', 'admin'].includes(role))
    return res.status(400).json({ message: 'Invalid role' });
  const { rows } = await query(
    `UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING id, role`,
    [role, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'User not found' });
  audit(req, `member.role_${role}`, 'user', req.params.id, {});
  res.json(rows[0]);
}));

/* ---------- Transactions ---------- */
router.get('/transactions', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, u.first_name, u.last_name, u.email
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Savings ---------- */
router.get('/savings', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT s.*, u.first_name, u.last_name, u.email
    FROM savings s JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Loans ---------- */
router.get('/loans', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT l.*, u.first_name, u.last_name, u.email
    FROM loans l JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/loans/:id', async (req, res) => {
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
        return r.rows[0];
      }

      // approved → disburse into wallet
      const w = await client.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [loan.user_id]);
      const newBalance = toMoney(Number(w.rows[0].balance) + Number(loan.amount));
      await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [
        newBalance, loan.user_id,
      ]);
      await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'loan_disbursement',$3,$4,$5,$6)`,
        [loan.user_id, w.rows[0].id, loan.amount, newBalance, generateRef('LND'), `Loan #${loan.id} disbursement`]
      );
      const r = await client.query(
        `UPDATE loans SET status='disbursed', reviewed_by=$1, reviewed_at=NOW(), review_note=$2
         WHERE id=$3 RETURNING *`,
        [req.user.id, note || null, loan.id]
      );
      await ensureSchedules(client, r.rows[0]);
      return r.rows[0];
    });

    audit(req, `loan.${status}`, 'loan', result.id, { amount: Number(result.amount) });
    notify(result.user_id, status === 'approved'
      ? { title: 'Loan approved', body: `Your loan of ${result.amount} has been disbursed to your wallet.`, link: '/loans' }
      : { title: 'Loan application update', body: 'Your loan application was not approved. Contact support for details.', link: '/loans' });
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

/* ---------- Dividends ---------- */
router.get('/dividends', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT d.*, u.first_name, u.last_name, u.email
    FROM dividends d JOIN users u ON u.id = d.user_id
    ORDER BY d.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

// Declare a dividend. If totalAmount provided → distributed equally among active members.
// If userId + amount provided → single member.
router.post('/dividends', async (req, res) => {
  try {
    const { period, totalAmount, userId, amount } = req.body;
    if (!period) return res.status(400).json({ message: 'Period is required (e.g. "2025 Q1")' });

    const inserted = await withTransaction(async (client) => {
      if (userId) {
        if (!isPositiveNumber(amount)) throw new Error('Amount is required for single member');
        const r = await client.query(
          `INSERT INTO dividends (user_id, amount, period) VALUES ($1,$2,$3) RETURNING *`,
          [userId, toMoney(amount), period]
        );
        return [r.rows[0]];
      }

      if (!isPositiveNumber(totalAmount)) throw new Error('totalAmount or userId+amount required');
      const members = await client.query(`SELECT id FROM users WHERE role='member' AND status='active'`);
      if (!members.rows.length) throw new Error('No active members');
      const per = toMoney(Number(totalAmount) / members.rows.length);

      const out = [];
      for (const m of members.rows) {
        const r = await client.query(
          `INSERT INTO dividends (user_id, amount, period) VALUES ($1,$2,$3) RETURNING *`,
          [m.id, per, period]
        );
        out.push(r.rows[0]);
      }
      return out;
    });

    audit(req, 'dividend.declared', 'dividend', null, { period, count: inserted.length });
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

router.patch('/dividends/:id/pay', async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const d = await client.query('SELECT * FROM dividends WHERE id=$1 FOR UPDATE', [req.params.id]);
      const div = d.rows[0];
      if (!div) throw new Error('Dividend not found');
      if (div.status === 'paid') throw new Error('Already paid');

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
      return r.rows[0];
    });
    audit(req, 'dividend.paid', 'dividend', result.id, { amount: Number(result.amount) });
    notify(result.user_id, {
      title: 'Dividend paid',
      body: `${result.amount} for ${result.period} is now in your wallet.`,
      link: '/dividends',
    });
    await settleDueCollections(withTransaction, result.user_id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

/* ---------- Loan products ---------- */
router.get('/loan-products', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM loan_products ORDER BY min_amount');
  res.json(rows);
}));

router.post('/loan-products', asyncHandler(async (req, res) => {
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
    audit(req, 'loan_product.created', 'loan_product', rows[0].id, { name });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'A product with that name exists' });
    throw e;
  }
}));

router.patch('/loan-products/:id', asyncHandler(async (req, res) => {
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
  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE loan_products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
  audit(req, 'loan_product.updated', 'loan_product', rows[0].id, { name: rows[0].name });
  res.json(rows[0]);
}));

/* ---------- Fixed deposits ---------- */
router.get('/fixed-deposits', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT f.*, u.first_name, u.last_name, u.email
    FROM fixed_deposits f JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Exports ---------- */
router.get('/export/transactions.csv', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.created_at, u.email, t.reference, t.type, t.description, t.amount, t.balance_after
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-transactions.csv',
    ['Date', 'Member Email', 'Reference', 'Type', 'Description', 'Amount', 'Balance After'],
    rows.map((t) => [t.created_at, t.email, t.reference, t.type, t.description, t.amount, t.balance_after]));
}));

router.get('/export/loans.csv', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT l.id, u.email, l.amount, l.interest_rate, l.duration_months, l.total_repayable,
           l.amount_paid, l.penalty_accrued, l.status, l.created_at
    FROM loans l JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-loans.csv',
    ['ID', 'Member Email', 'Amount', 'Rate %', 'Months', 'Repayable', 'Paid', 'Penalties', 'Status', 'Created'],
    rows.map((l) => [l.id, l.email, l.amount, l.interest_rate, l.duration_months, l.total_repayable, l.amount_paid, l.penalty_accrued, l.status, l.created_at]));
}));

router.get('/export/members.csv', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at,
           COALESCE(w.balance,0) AS balance
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    ORDER BY u.created_at DESC LIMIT 5000
  `);
  sendCsv(res, 'mpcs-members.csv',
    ['First Name', 'Last Name', 'Email', 'Phone', 'Role', 'Status', 'Joined', 'Wallet Balance'],
    rows.map((u) => [u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at, u.balance]));
}));

/* ---------- Manual funding (officer credits a member by email/account) ---------- */
router.post('/fund', asyncHandler(async (req, res) => {
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
    return { member: `${target.first_name} ${target.last_name}`, transaction: tx.rows[0], balance: newBalance };
  });

  audit(req, 'wallet.funded_manual', 'user', result.transaction.user_id, { amount: amt, note: note || null });
  await settleDueCollections(withTransaction, result.transaction.user_id);
  res.status(201).json(result);
}));

/* ---------- Audit log ---------- */
router.get('/audit-logs', asyncHandler(async (req, res) => {
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