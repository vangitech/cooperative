import express from 'express';
import { query } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';

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
    if (!nextOfKinName || !nextOfKinPhone)
      return res.status(400).json({ message: 'Next of kin name and phone are required' });

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
    res.status(201).json(rows[0]);
  })
);

// Member views their own KYC profile + guarantors.
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await query('SELECT * FROM kyc_profiles WHERE user_id = $1', [req.user.id]);
    const guarantors = await query(
      'SELECT * FROM guarantors WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );
    res.json({ profile: profile.rows[0] || null, guarantors: guarantors.rows });
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

/* ---------- Admin review ---------- */

router.get(
  '/',
  authenticate,
  requireAdmin,
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
  requireAdmin,
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
    res.json(rows[0]);
  })
);

export default router;
