import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { ORG_TYPES, publicOrgList } from '../lib/onboarding.js';

const router = express.Router();

// Public: active organisations for the signup unit/branch/department picker.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await publicOrgList());
}));

// Staff: full list with member counts (for the admin Organisations page).
router.get(
  '/all',
  authenticate,
  requirePerm('orgs.read'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT o.*, p.name AS parent_name,
              (SELECT COUNT(*) FROM organisation_members m WHERE m.org_id = o.id AND m.status = 'active') AS members
       FROM organisations o LEFT JOIN organisations p ON p.id = o.parent_id
       ORDER BY o.type, o.name`
    );
    res.json(rows);
  })
);

// Staff: members of one organisation (payroll-deduction source list).
router.get(
  '/:id/members',
  authenticate,
  requirePerm('orgs.read'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status,
              m.member_no, m.joined_at, COALESCE(w.balance, 0) AS balance,
              (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id = u.id) AS total_savings
       FROM organisation_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE m.org_id = $1 AND m.status = 'active'
       ORDER BY u.first_name, u.last_name`,
      [req.params.id]
    );
    res.json(rows);
  })
);

function cleanCode(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
}

router.post(
  '/',
  authenticate,
  requirePerm('orgs.manage'),
  asyncHandler(async (req, res) => {
    const { name, code, type = 'branch', parentId, contactName, contactPhone, address } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Organisation name is required' });
    const clean = cleanCode(code);
    if (!clean) return res.status(400).json({ message: 'Code is required (letters/numbers, e.g. LAG-MKT)' });
    if (!ORG_TYPES.includes(type)) {
      return res.status(400).json({ message: `Type must be one of: ${ORG_TYPES.join(', ')}` });
    }
    if (parentId) {
      const p = await query('SELECT id FROM organisations WHERE id = $1', [parentId]);
      if (!p.rows[0]) return res.status(400).json({ message: 'Parent organisation not found' });
    }
    try {
      const { rows } = await query(
        `INSERT INTO organisations (name, code, type, parent_id, contact_name, contact_phone, address, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [name.trim(), clean, type, parentId || null, contactName || null, contactPhone || null,
         address || null, req.user.id]
      );
      audit(req, 'org.created', 'organisation', rows[0].id, { name, code: clean, type }, { after: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ message: 'An organisation with that code exists' });
      throw e;
    }
  })
);

router.patch(
  '/:id',
  authenticate,
  requirePerm('orgs.manage'),
  asyncHandler(async (req, res) => {
    const allowed = ['name', 'type', 'parent_id', 'contact_name', 'contact_phone', 'address', 'status'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val = req.body[key] !== undefined ? req.body[key] : req.body[camel];
      if (val === undefined) continue;
      if (key === 'type' && !ORG_TYPES.includes(val)) {
        return res.status(400).json({ message: `Type must be one of: ${ORG_TYPES.join(', ')}` });
      }
      if (key === 'status' && !['active', 'inactive'].includes(val)) {
        return res.status(400).json({ message: 'Status must be active or inactive' });
      }
      if (key === 'parent_id' && val !== null) {
        if (Number(val) === Number(req.params.id)) {
          return res.status(400).json({ message: 'An organisation cannot parent itself' });
        }
        const p = await query('SELECT id FROM organisations WHERE id = $1', [val]);
        if (!p.rows[0]) return res.status(400).json({ message: 'Parent organisation not found' });
      }
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ message: 'Nothing to update' });
    // Existing member numbers are frozen — a code change only affects future numbering.
    const before = await query('SELECT * FROM organisations WHERE id = $1', [req.params.id]);
    if (!before.rows[0]) return res.status(404).json({ message: 'Organisation not found' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE organisations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    audit(req, 'org.updated', 'organisation', rows[0].id, { name: rows[0].name },
      { before: before.rows[0], after: rows[0] });
    res.json(rows[0]);
  })
);

export default router;
