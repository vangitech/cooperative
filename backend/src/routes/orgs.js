import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit, auditTx } from '../lib/audit.js';
import { ORG_TYPES, publicOrgList, nextMemberNo } from '../lib/onboarding.js';

const router = express.Router();

// Public: active organisations for the signup unit/branch/department picker.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await publicOrgList());
}));

// Staff: full list with member counts + grantor seat coverage (for the
// admin Organisations page hierarchy and loan-readiness indicators).
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
    // Grantor seats per org (missing table = pre-migration DB → zeros).
    let seats = {};
    try {
      const g = await query(
        `SELECT org_id, COUNT(*) AS n FROM org_grantors GROUP BY org_id`
      );
      for (const r of g.rows) seats[r.org_id] = Number(r.n);
    } catch (e) {
      if (!/relation .* does not exist|undefined_table/.test(String(e.message))) throw e;
    }
    res.json(rows.map((o) => ({ ...o, grantors: seats[o.id] || 0, grantor_seats: 3 })));
  })
);

// Staff: members of one organisation (payroll-deduction source list).
router.get(
  '/:id/members',
  authenticate,
  requirePerm('orgs.read'),
  asyncHandler(async (req, res) => {
    // Super-admin is invisible here unless the viewer is a super-admin.
    const hideSuper = req.user.role !== 'super_admin';
    const { rows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status, u.role,
              m.member_no, m.joined_at, COALESCE(w.balance, 0) AS balance,
              (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id = u.id) AS total_savings
       FROM organisation_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE m.org_id = $1 AND m.status = 'active'
       ${hideSuper ? `AND u.role <> 'super_admin'` : ''}
       ORDER BY u.first_name, u.last_name`,
      [req.params.id]
    );
    res.json(rows);
  })
);

function cleanCode(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
}

// Seat one union grantor. Shared by the seats endpoint and organisation
// creation (a brand-new union has no members yet, so leaders are picked
// from anywhere and auto-affiliated as secondary members — their primary
// union never moves). Throws { status, message } on any rule failure.
// `db` is pool or a transaction client (both expose .query).
async function seatGrantor(db, { orgId, orgName, userId, phone, email, assignedBy }) {
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

  const cand = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status,
            k.id_number, k.bvn_verified,
            (SELECT COUNT(*) FROM kyc_documents d WHERE d.user_id = u.id) AS docs
     FROM users u LEFT JOIN kyc_profiles k ON k.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const c = cand.rows[0];
  if (!c) fail(404, 'Member not found');
  if (c.status !== 'active') fail(400, `${c.first_name} ${c.last_name}'s account is not active`);
  if (c.role === 'super_admin') fail(400, 'The super-admin cannot be a union grantor');
  if (!c.id_number && !c.bvn_verified) {
    fail(400, `${c.first_name} ${c.last_name} is not fully registered — verified NIN/BVN plus uploaded documents are required before seating a grantor`);
  }
  if (Number(c.docs) === 0) {
    fail(400, `${c.first_name} ${c.last_name} is not fully registered — verified NIN/BVN plus uploaded documents are required before seating a grantor`);
  }

  // Affiliation: primary members stay put; anyone else is affiliated as a
  // secondary (non-primary) member so the seat has a home without moving them.
  const aff = await db.query(
    'SELECT id, is_primary FROM organisation_members WHERE user_id = $1 AND org_id = $2',
    [userId, orgId]
  );
  let affiliated = false;
  if (!aff.rows[0]) {
    try {
      await db.query(
        `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary, status)
         VALUES ($1,$2,$3,false,'active')`,
        [userId, orgId, `AFF-${orgId}-${userId}`]
      );
      affiliated = true;
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }

  const seats = await db.query('SELECT COUNT(*) FROM org_grantors WHERE org_id = $1', [orgId]);
  if (Number(seats.rows[0].count) >= 3)
    fail(409, `${orgName} already has 3 grantors — remove one first`);

  // Seat contact: official union phone (required) + email (optional),
  // defaulting to the member's own details when not supplied.
  const contactPhone = String(phone || '').trim() || c.phone || null;
  if (!contactPhone) fail(400, 'A contact phone is required for the grantor seat');
  const contactEmail = String(email || '').trim() || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
    fail(400, 'Contact email is invalid');

  let seat = null;
  try {
    ({ rows: seat } = await db.query(
      `INSERT INTO org_grantors (org_id, user_id, assigned_by, contact_phone, contact_email)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, user_id) DO NOTHING RETURNING *`,
      [orgId, userId, assignedBy, contactPhone, contactEmail]
    ));
  } catch (e) {
    // Stale DB without the contact columns: seat without contacts.
    if (/column .* does not exist|undefined_column/.test(String(e.message))) {
      ({ rows: seat } = await db.query(
        `INSERT INTO org_grantors (org_id, user_id, assigned_by)
         VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO NOTHING RETURNING *`,
        [orgId, userId, assignedBy]
      ));
    } else {
      throw e;
    }
  }
  await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', ['grantor', userId]);
  return { seat: seat[0] || null, contactPhone, contactEmail, affiliated, member: c };
}

// Union leadership: every organisation seats 3 grantors (union leaders).
// Only admin / super_admin may assign — from FULLY REGISTERED members of
// that union (active + verified identity + address documents on file).
// list is staff-visible; assign/remove is admin + super-admin only.
router.get(
  '/:id/grantors',
  authenticate,
  requirePerm('orgs.read'),
  asyncHandler(async (req, res) => {
    const org = await query('SELECT id, name, code FROM organisations WHERE id = $1', [req.params.id]);
    if (!org.rows[0]) return res.status(404).json({ message: 'Organisation not found' });
    let rows = [];
    const baseSelect = (extra) => `
        SELECT g.user_id AS id, u.first_name, u.last_name, u.email, u.phone, u.status,
               u.member_no, g.assigned_at, ${extra}
               a.first_name AS assigned_by_first, a.last_name AS assigned_by_last
        FROM org_grantors g
        JOIN users u ON u.id = g.user_id
        LEFT JOIN users a ON a.id = g.assigned_by
        WHERE g.org_id = $1 ORDER BY g.assigned_at`;
    try {
      ({ rows } = await query(baseSelect('g.contact_phone, g.contact_email,'), [req.params.id]));
    } catch (e) {
      const msg = String(e.message);
      if (/relation .* does not exist|undefined_table/.test(msg)) {
        rows = []; // pre-migration DB: no seats table yet
      } else if (/column .* does not exist|undefined_column/.test(msg)) {
        ({ rows } = await query(baseSelect(''), [req.params.id])); // table without contact columns
      } else {
        throw e;
      }
    }
    res.json({ org: org.rows[0], seats: 3, grantors: rows });
  })
);

router.post(
  '/:id/grantors',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      if (!['admin', 'super_admin'].includes(req.user.role))
        return res.status(403).json({ message: 'Only admins can assign union grantors' });
      const { userId, phone, email } = req.body || {};
      if (!userId) return res.status(400).json({ message: 'userId is required' });

      const org = await query('SELECT id, name FROM organisations WHERE id = $1 AND status = $2', [
        req.params.id, 'active',
      ]);
      if (!org.rows[0]) return res.status(404).json({ message: 'Organisation not found or inactive' });

      // Any fully-registered member can be seated — non-members are
      // auto-affiliated (secondary) so a union's first leaders don't need
      // a prior move. Primary affiliation never changes here.
      const out = await seatGrantor(query, {
        orgId: req.params.id, orgName: org.rows[0].name, userId,
        phone, email, assignedBy: req.user.id,
      });
      audit(req, 'org.grantor_assigned', 'organisation', req.params.id,
        { userId: Number(userId), org: org.rows[0].name,
          contactPhone: out.contactPhone, contactEmail: out.contactEmail,
          affiliated: out.affiliated });
      res.status(201).json({ ok: true, seat: out.seat, affiliated: out.affiliated });
    } catch (e) {
      if (/relation .* does not exist|undefined_table/.test(String(e.message))) {
        return res.status(400).json({ message: 'Grantor seats need a migration — run npm run migrate' });
      }
      res.status(e.status || 400).json({ message: e.message });
    }
  })
);

router.delete(
  '/:id/grantors/:userId',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ message: 'Only admins can remove union grantors' });
    const { rows } = await query(
      'DELETE FROM org_grantors WHERE org_id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.params.userId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Grantor seat not found' });
    // Drop the grantor role only if they hold no other union seat.
    const other = await query('SELECT COUNT(*) FROM org_grantors WHERE user_id = $1', [req.params.userId]);
    if (Number(other.rows[0].count) === 0) {
      await query(`UPDATE users SET role = 'member', updated_at = NOW() WHERE id = $1 AND role = 'grantor'`, [req.params.userId]);
    }
    audit(req, 'org.grantor_removed', 'organisation', req.params.id, { userId: Number(req.params.userId) });
    res.json({ ok: true });
  })
);

// Edit a seated grantor's official contact (phone required, email optional).
router.patch(
  '/:id/grantors/:userId',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ message: 'Only admins can edit union grantors' });
    const { phone, email } = req.body || {};
    const sets = [];
    const params = [];
    if (phone !== undefined) {
      const clean = String(phone).trim();
      if (!clean) return res.status(400).json({ message: 'Contact phone cannot be empty' });
      params.push(clean);
      sets.push(`contact_phone = $${params.length}`);
    }
    if (email !== undefined) {
      const clean = String(email).trim() || null;
      if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
        return res.status(400).json({ message: 'Contact email is invalid' });
      params.push(clean);
      sets.push(`contact_email = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ message: 'Nothing to update' });
    try {
      params.push(req.params.id, req.params.userId);
      const { rows } = await query(
        `UPDATE org_grantors SET ${sets.join(', ')} WHERE org_id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ message: 'Grantor seat not found' });
      audit(req, 'org.grantor_updated', 'organisation', req.params.id, { userId: Number(req.params.userId) });
      res.json({ ok: true, seat: rows[0] });
    } catch (e) {
      if (/column .* does not exist|undefined_column|relation .* does not exist|undefined_table/.test(String(e.message))) {
        return res.status(400).json({ message: 'Grantor contacts need a migration — run npm run migrate' });
      }
      throw e;
    }
  })
);

// Move a member between unions (e.g. Trader Union → Cloth Union).
// Admin / super-admin only. The new union issues a fresh member number
// (IDs encode affiliation); the old row stays as inactive history.
// Grantor seats in the OLD union are released automatically (a leader who
// leaves can't keep voting there); wallet, savings, loans and KYC travel
// with the user untouched. Loans already in flight keep recorded votes;
// further votes come from the new union's grantors.
router.patch(
  '/members/:userId/move',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ message: 'Only admins can move members between unions' });
    const { orgId } = req.body || {};
    if (!orgId) return res.status(400).json({ message: 'orgId is required' });
    try {
      const result = await withTransaction(async (client) => {
        const target = await client.query(
          'SELECT id, name, code FROM organisations WHERE id = $1 AND status = $2',
          [orgId, 'active']
        );
        if (!target.rows[0]) throw Object.assign(new Error('Target organisation not found or inactive'), { status: 404 });
        const cur = await client.query(
          `SELECT m.*, o.name AS org_name FROM organisation_members m
           JOIN organisations o ON o.id = m.org_id
           WHERE m.user_id = $1 AND m.is_primary AND m.status = 'active'`,
          [req.params.userId]
        );
        const current = cur.rows[0];
        if (!current) throw Object.assign(new Error('Member has no active primary union'), { status: 404 });
        if (Number(current.org_id) === Number(orgId)) {
          throw Object.assign(new Error('Member is already in this union'), { status: 409 });
        }
        const already = await client.query(
          'SELECT id FROM organisation_members WHERE user_id = $1 AND org_id = $2',
          [req.params.userId, orgId]
        );
        const memberNo = await nextMemberNo(client, orgId);
        if (already.rows[0]) {
          await client.query(
            `UPDATE organisation_members SET is_primary = true, status = 'active', member_no = $1 WHERE id = $2`,
            [memberNo, already.rows[0].id]
          );
        } else {
          await client.query(
            `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary)
             VALUES ($1,$2,$3,true)`,
            [req.params.userId, orgId, memberNo]
          );
        }
        await client.query(
          `UPDATE organisation_members SET is_primary = false, status = 'transferred' WHERE id = $1`,
          [current.id]
        );
        await client.query('UPDATE users SET member_no = $1, updated_at = NOW() WHERE id = $2', [
          memberNo, req.params.userId,
        ]);
        // Release grantor seats in the union they left.
        const released = await client.query(
          'DELETE FROM org_grantors WHERE org_id = $1 AND user_id = $2 RETURNING *',
          [current.org_id, req.params.userId]
        );
        const seatsLeft = await client.query('SELECT COUNT(*) FROM org_grantors WHERE user_id = $1', [req.params.userId]);
        if (released.rows.length && Number(seatsLeft.rows[0].count) === 0) {
          await client.query(`UPDATE users SET role = 'member', updated_at = NOW() WHERE id = $1 AND role = 'grantor'`, [req.params.userId]);
        }
        await auditTx(client, req, 'org.member_moved', 'organisation', orgId,
          { userId: Number(req.params.userId), from: current.org_name, to: target.rows[0].name,
            oldMemberNo: current.member_no, newMemberNo: memberNo,
            grantorSeatReleased: released.rows.length > 0 });
        return {
          userId: Number(req.params.userId), from: current.org_name, to: target.rows[0].name,
          oldMemberNo: current.member_no, newMemberNo: memberNo,
          grantorSeatReleased: released.rows.length > 0,
        };
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(e.status || 400).json({ message: e.message });
    }
  })
);

router.post(
  '/',
  authenticate,
  requirePerm('orgs.manage'),
  asyncHandler(async (req, res) => {
    // Optional `grantors: [{ userId, phone, email }]` seats up to 3 union
    // leaders atomically with creation — each with official contact phone
    // (required) + email (optional). Non-member leaders are affiliated
    // (secondary) without moving their primary union.
    const { name, code, type = 'branch', parentId, contactName, contactPhone, address, grantors = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Organisation name is required' });
    const clean = cleanCode(code);
    if (!clean) return res.status(400).json({ message: 'Code is required (letters/numbers, e.g. LAG-MKT)' });
    if (!ORG_TYPES.includes(type)) {
      return res.status(400).json({ message: `Type must be one of: ${ORG_TYPES.join(', ')}` });
    }
    if (!Array.isArray(grantors)) return res.status(400).json({ message: 'grantors must be an array' });
    if (grantors.length > 3) return res.status(400).json({ message: 'Maximum of 3 grantors' });
    const seen = new Set();
    for (const g of grantors) {
      if (!g || !g.userId) return res.status(400).json({ message: 'Each grantor needs a userId' });
      if (seen.has(Number(g.userId))) return res.status(400).json({ message: 'Duplicate grantor in the list' });
      seen.add(Number(g.userId));
    }
    if (parentId) {
      const p = await query('SELECT id FROM organisations WHERE id = $1', [parentId]);
      if (!p.rows[0]) return res.status(400).json({ message: 'Parent organisation not found' });
    }
    try {
      const out = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO organisations (name, code, type, parent_id, contact_name, contact_phone, address, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [name.trim(), clean, type, parentId || null, contactName || null, contactPhone || null,
           address || null, req.user.id]
        );
        const org = rows[0];
        const seated = [];
        for (const g of grantors) {
          const s = await seatGrantor(client, {
            orgId: org.id, orgName: org.name, userId: g.userId,
            phone: g.phone, email: g.email, assignedBy: req.user.id,
          });
          seated.push({ userId: Number(g.userId), ...s });
          await auditTx(client, req, 'org.grantor_assigned', 'organisation', org.id,
            { userId: Number(g.userId), org: org.name, atCreation: true,
              contactPhone: s.contactPhone, contactEmail: s.contactEmail });
        }
        await auditTx(client, req, 'org.created', 'organisation', org.id,
          { name, code: clean, type, grantors: seated.length }, { after: org });
        return { org, seated };
      });
      res.status(201).json({ ...out.org, grantors: out.seated });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ message: 'An organisation with that code exists' });
      if (/relation .* does not exist|undefined_table/.test(String(e.message))) {
        return res.status(400).json({ message: 'Grantor seats need a migration — run npm run migrate' });
      }
      res.status(e.status || 400).json({ message: e.message });
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

// Delete an organisation (or union). Deliberately narrow, like member
// delete: only orgs with ZERO membership history and ZERO grantor seats
// (mistyped/empty rows, never lived-in unions). Member numbers embed the
// code and journals carry org attribution, so anything ever used is
// blocked — deactivate it instead. Admin / super-admin only, audited.
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ message: 'Only admins can delete organisations' });
    try {
      const o = await query('SELECT id, name, code FROM organisations WHERE id = $1', [req.params.id]);
      const org = o.rows[0];
      if (!org) return res.status(404).json({ message: 'Organisation not found' });
      if (org.code === 'GEN')
        return res.status(400).json({ message: 'The General Members group cannot be deleted' });
      const mem = await query('SELECT COUNT(*) FROM organisation_members WHERE org_id = $1', [req.params.id]);
      if (Number(mem.rows[0].count) > 0) {
        return res.status(409).json({
          message: `${org.name} has membership history and cannot be deleted — set it inactive instead`,
        });
      }
      let seats = 0;
      try {
        const g = await query('SELECT COUNT(*) FROM org_grantors WHERE org_id = $1', [req.params.id]);
        seats = Number(g.rows[0].count);
      } catch (e) {
        if (!/relation .* does not exist|undefined_table/.test(String(e.message))) throw e;
      }
      if (seats > 0) {
        return res.status(409).json({
          message: `${org.name} still seats grantors — remove them first`,
        });
      }
      const kids = await query('SELECT COUNT(*) FROM organisations WHERE parent_id = $1', [req.params.id]);
      if (Number(kids.rows[0].count) > 0) {
        return res.status(409).json({
          message: `${org.name} still has unions under it — delete or re-parent them first`,
        });
      }
      await query('DELETE FROM organisations WHERE id = $1', [req.params.id]);
      audit(req, 'org.deleted', 'organisation', req.params.id, { name: org.name, code: org.code });
      res.json({ ok: true, id: Number(req.params.id), name: org.name });
    } catch (e) {
      res.status(e.status || 400).json({ message: e.message });
    }
  })
);

export default router;
