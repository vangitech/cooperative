import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { verifyKyc, validateDocument } from '../lib/onboarding.js';
import { notify } from '../lib/notify.js';
import { assignVirtualAccount } from '../lib/virtualAccounts.js';

const router = express.Router();

const ID_TYPES = ['nin', 'drivers_license', 'voters_card', 'passport'];

// Member submits (or updates) their KYC profile. Resubmission after a
// rejection re-opens review (back to pending).
router.post(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const {
      dob, gender, occupation, employer, idType, idNumber,
      residentialAddress, nextOfKinName, nextOfKinPhone, nextOfKinRelationship,
    } = req.body;

    if (!idType || !ID_TYPES.includes(idType))
      return res.status(400).json({ message: `ID type must be one of: ${ID_TYPES.join(', ')}` });
    if (!idNumber) return res.status(400).json({ message: 'ID number is required' });
    if (idType === 'nin' && !/^\d{11}$/.test(String(idNumber).trim()))
      return res.status(400).json({ message: 'NIN must be exactly 11 digits' });
    if (!nextOfKinName || !nextOfKinPhone)
      return res.status(400).json({ message: 'Next of kin name and phone are required' });

    // Never wipe the registration identity snapshot (NIN/BVN PASSED): the
    // stored BVN feeds the system pass and the registry result is merged.
    let storedBvn = null;
    let identitySnapshot = null;
    try {
      const prev = await query('SELECT bvn, bvn_result, verification_result FROM kyc_profiles WHERE user_id = $1', [req.user.id]);
      storedBvn = prev.rows[0]?.bvn || null;
      const vr = prev.rows[0]?.verification_result;
      identitySnapshot = typeof vr === 'string' ? JSON.parse(vr) : vr;
    } catch (e) {
      if (!/column .* does not exist|undefined_column/.test(String(e.message))) throw e;
    }
    const { rows } = await query(
      `INSERT INTO kyc_profiles
         (user_id, dob, gender, occupation, employer, id_type, id_number,
          residential_address, next_of_kin_name, next_of_kin_phone,
          next_of_kin_relationship, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         dob = EXCLUDED.dob, gender = EXCLUDED.gender,
         occupation = EXCLUDED.occupation, employer = EXCLUDED.employer,
         id_type = EXCLUDED.id_type, id_number = EXCLUDED.id_number,
         residential_address = EXCLUDED.residential_address,
         next_of_kin_name = EXCLUDED.next_of_kin_name,
         next_of_kin_phone = EXCLUDED.next_of_kin_phone,
         next_of_kin_relationship = EXCLUDED.next_of_kin_relationship,
         status = 'pending', review_note = NULL, reviewed_by = NULL,
         reviewed_at = NULL, updated_at = NOW()
       RETURNING *`,
      [
        req.user.id, dob || null, gender || null, occupation || null, employer || null,
        idType, idNumber, residentialAddress || null,
        nextOfKinName, nextOfKinPhone, nextOfKinRelationship || null,
      ]
    );
    audit(req, 'kyc.submitted', 'kyc', req.user.id, { idType });
    // System verification pass runs on every submission — human review stays final.
    try {
      const docs = await query('SELECT id FROM kyc_documents WHERE user_id = $1', [req.user.id]);
      const u = await query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
      const verification = await verifyKyc(query, {
        userId: req.user.id, email: req.user.email, phone: u.rows[0]?.phone,
        firstName: req.user.first_name, lastName: req.user.last_name, dob,
        idType, idNumber, bvn: storedBvn || undefined, documents: docs.rows,
      });
      // Merge the registration NIN/BVN PASSED snapshot so the member keeps
      // seeing their signup identity as passed alongside the new checks.
      const merged = { ...verification };
      if (identitySnapshot?.nin?.verified || identitySnapshot?.bvn?.verified) {
        merged.identity = {
          nin: identitySnapshot.nin || null,
          bvn: identitySnapshot.bvn || null,
        };
        const seen = new Set(merged.checks.map((c) => c.key));
        for (const c of (identitySnapshot.checks || [])) {
          if (['nin', 'bvn_match'].includes(c.key) && !seen.has(`reg_${c.key}`)) {
            merged.checks.unshift({ ...c, key: `reg_${c.key}` });
          }
        }
      }
      await query(
        `UPDATE kyc_profiles SET verification_result = $1,
          verified_at = CASE WHEN $2 THEN NOW() ELSE NULL END WHERE user_id = $3`,
        [JSON.stringify(merged), verification.passed, req.user.id]
      );
      rows[0].verification_result = merged;
    } catch (e) {
      console.error('kyc verification failed:', e.message);
    }
    res.status(201).json(rows[0]);
  })
);

// Member views their own KYC profile + guarantors + documents (drives the
// dashboard "additional verification" card: NIN/BVN PASSED from signup plus
// which address documents like utility bill are still missing).
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await query('SELECT * FROM kyc_profiles WHERE user_id = $1', [req.user.id]);
    const guarantors = await query(
      'SELECT * FROM guarantors WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );
    let docs;
    try {
      docs = await query(
        `SELECT id, doc_type, filename, mime, size_bytes, doc_date, created_at
         FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
        [req.user.id]
      );
    } catch (e) {
      if (/column .* does not exist|undefined_column/.test(String(e.message))) {
        docs = await query(
          `SELECT id, doc_type, filename, mime, size_bytes, created_at
           FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
          [req.user.id]
        );
      } else {
        throw e;
      }
    }
    let p = profile.rows[0] || null;
    if (p && typeof p.verification_result === 'string') {
      try { p = { ...p, verification_result: JSON.parse(p.verification_result) }; } catch { /* keep raw */ }
    }
    if (p && typeof p.bvn_result === 'string') {
      try { p = { ...p, bvn_result: JSON.parse(p.bvn_result) }; } catch { /* keep raw */ }
    }
    res.json({ profile: p, guarantors: guarantors.rows, documents: docs.rows });
  })
);

// Member adds a guarantor (max 2).
router.post(
  '/guarantors',
  authenticate,
  asyncHandler(async (req, res) => {
    const { fullName, phone, email, relationship } = req.body;
    if (!fullName || !phone)
      return res.status(400).json({ message: 'Guarantor name and phone are required' });

    const count = await query('SELECT COUNT(*) FROM guarantors WHERE user_id = $1', [req.user.id]);
    if (Number(count.rows[0].count) >= 2)
      return res.status(400).json({ message: 'Maximum of 2 guarantors' });

    try {
      const { rows } = await query(
        `INSERT INTO guarantors (user_id, full_name, phone, email, relationship)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, fullName, phone, email || null, relationship || null]
      );
      audit(req, 'kyc.guarantor_added', 'guarantor', rows[0].id, { fullName });
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ message: 'This guarantor is already added' });
      throw e;
    }
  })
);

/* ---------- Identity document vault (DB-backed, RLS-locked) ---------- */

// Member uploads an ID scan/photo (jpg, png, pdf ≤ 5MB, base64 JSON body).
// Utility bills (electricity / water / waste) must include their BILL date
// (docDate YYYY-MM-DD, within the last 3 months) — the loan gate enforces it.
router.post(
  '/documents',
  authenticate,
  asyncHandler(async (req, res) => {
    const { docType, filename, mime, data, docDate } = req.body || {};
    let file;
    try {
      file = validateDocument({ docType, filename, mime, data, docDate });
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    const count = await query('SELECT COUNT(*) FROM kyc_documents WHERE user_id = $1', [req.user.id]);
    if (Number(count.rows[0].count) >= 5)
      return res.status(400).json({ message: 'Maximum of 5 documents' });
    let rows;
    try {
      ({ rows } = await query(
        `INSERT INTO kyc_documents (user_id, doc_type, filename, mime, size_bytes, data, uploaded_by, doc_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, user_id, doc_type, filename, mime, size_bytes, doc_date, created_at`,
        [req.user.id, file.docType, filename, mime, file.size, file.bytes, req.user.id,
         file.docDate ? file.docDate.toISOString().slice(0, 10) : null]
      ));
    } catch (e) {
      // Older DBs without the doc_date column: store without the bill date.
      if (/column .* does not exist|undefined_column/.test(String(e.message))) {
        ({ rows } = await query(
          `INSERT INTO kyc_documents (user_id, doc_type, filename, mime, size_bytes, data, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, user_id, doc_type, filename, mime, size_bytes, created_at`,
          [req.user.id, file.docType, filename, mime, file.size, file.bytes, req.user.id]
        ));
      } else {
        throw e;
      }
    }
    audit(req, 'kyc.document_uploaded', 'kyc', req.user.id, { filename, docType: file.docType });
    res.status(201).json(rows[0]);
  })
);

// List my documents (metadata only — bytes stream separately).
router.get(
  '/documents',
  authenticate,
  asyncHandler(async (req, res) => {
    let rows;
    try {
      ({ rows } = await query(
        `SELECT id, doc_type, filename, mime, size_bytes, doc_date, created_at
         FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
        [req.user.id]
      ));
    } catch (e) {
      if (/column .* does not exist|undefined_column/.test(String(e.message))) {
        ({ rows } = await query(
          `SELECT id, doc_type, filename, mime, size_bytes, created_at
           FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
          [req.user.id]
        ));
      } else {
        throw e;
      }
    }
    res.json(rows);
  })
);

// Download one document: owner, or staff with kyc.review.
router.get(
  '/documents/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM kyc_documents WHERE id = $1', [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    const staff = ['super_admin', 'admin', 'officer', 'accountant'].includes(req.user.role);
    if (doc.user_id !== req.user.id && !staff)
      return res.status(403).json({ message: 'Insufficient permissions' });
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.send(doc.data);
  })
);

/* ---------- Staff review queue (KYC console) ---------- */

// Enriched queue: every KYC profile with the member, their group
// (organisation), document/guarantor counts and verification score.
router.get(
  '/queue',
  authenticate,
  requirePerm('kyc.review'),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where = 'WHERE k.status = $1';
      params.push(status);
    }
    const { rows } = await query(
      `SELECT k.*, u.first_name, u.last_name, u.email, u.phone, u.status AS member_status,
              u.member_no, u.employment_type, u.email_verified, u.created_at AS registered_at,
              o.name AS org_name, o.code AS org_code, o.type AS org_type,
              (SELECT COUNT(*) FROM kyc_documents d WHERE d.user_id = u.id) AS doc_count,
              (SELECT COUNT(*) FROM guarantors g WHERE g.user_id = u.id) AS guarantor_count
       FROM kyc_profiles k JOIN users u ON u.id = k.user_id
       LEFT JOIN organisation_members m ON m.user_id = u.id AND m.is_primary AND m.status = 'active'
       LEFT JOIN organisations o ON o.id = m.org_id
       ${where} ORDER BY k.updated_at DESC LIMIT 200`,
      params
    );
    res.json(rows.map((r) => {
      let vr = r.verification_result;
      if (typeof vr === 'string') {
        try { vr = JSON.parse(vr); } catch { vr = null; }
      }
      return { ...r, verification_result: vr };
    }));
  })
);

// Full member file: everything they submitted + their group.
router.get(
  '/user/:userId',
  authenticate,
  requirePerm('kyc.review'),
  asyncHandler(async (req, res) => {
    const u = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.role,
              u.status, u.member_no, u.employment_type, u.email_verified, u.created_at,
              o.id AS org_id, o.name AS org_name, o.code AS org_code, o.type AS org_type
       FROM users u
       LEFT JOIN organisation_members m ON m.user_id = u.id AND m.is_primary AND m.status = 'active'
       LEFT JOIN organisations o ON o.id = m.org_id
       WHERE u.id = $1`,
      [req.params.userId]
    );
    if (!u.rows[0]) return res.status(404).json({ message: 'User not found' });
    const profile = await query('SELECT * FROM kyc_profiles WHERE user_id = $1', [req.params.userId]);
    const guarantors = await query('SELECT * FROM guarantors WHERE user_id = $1 ORDER BY created_at', [req.params.userId]);
    let docs;
    try {
      docs = await query(
        `SELECT id, doc_type, filename, mime, size_bytes, doc_date, created_at
         FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
        [req.params.userId]
      );
    } catch (e) {
      if (/column .* does not exist|undefined_column/.test(String(e.message))) {
        docs = await query(
          `SELECT id, doc_type, filename, mime, size_bytes, created_at
           FROM kyc_documents WHERE user_id = $1 ORDER BY created_at`,
          [req.params.userId]
        );
      } else {
        throw e;
      }
    }
    let p = profile.rows[0] || null;
    if (p && typeof p.verification_result === 'string') {
      try { p = { ...p, verification_result: JSON.parse(p.verification_result) }; } catch { /* keep raw */ }
    }
    res.json({ user: u.rows[0], profile: p, guarantors: guarantors.rows, documents: docs.rows });
  })
);

router.get(
  '/',
  authenticate,
  requirePerm('kyc.review'),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where = 'WHERE k.status = $1';
      params.push(status);
    }
    const { rows } = await query(
      `SELECT k.*, u.first_name, u.last_name, u.email, u.phone, u.status AS member_status
       FROM kyc_profiles k JOIN users u ON u.id = k.user_id
       ${where} ORDER BY k.updated_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  })
);

router.patch(
  '/:userId',
  authenticate,
  requirePerm('kyc.review'),
  asyncHandler(async (req, res) => {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    const { rows } = await query(
      `UPDATE kyc_profiles
       SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE user_id = $4 RETURNING *`,
      [status, note || null, req.user.id, req.params.userId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'KYC profile not found' });
    audit(req, `kyc.${status}`, 'kyc', req.params.userId, { note: note || null });
    notify(req.params.userId, status === 'approved'
      ? { title: 'Identity verified', body: 'Your KYC has been approved.', link: '/profile' }
      : { title: 'KYC needs attention', body: note || 'Your KYC was rejected. Update and resubmit.', link: '/profile' });

    // Approving a NIN-verified profile unlocks the static funding account
    // (live mode requires NIN/BVN). Awaited (not fire-and-forget) because
    // serverless functions may freeze before background work finishes.
    // The outcome is returned so the admin UI can report it.
    let virtualAccount = null;
    let accountError = null;
    if (status === 'approved' && rows[0].id_type === 'nin' && rows[0].id_number) {
      try {
        virtualAccount = await assignVirtualAccount(req.params.userId, { nin: rows[0].id_number });
      } catch (e) {
        accountError = e.code === '23505'
          ? 'Account number already assigned (test-mode mock numbers repeat — live keys issue unique numbers).'
          : e.message;
        console.error('kyc-triggered account assignment failed:', e.message);
      }
    }
    res.json({ ...rows[0], virtualAccount, accountError });
  })
);

export default router;
