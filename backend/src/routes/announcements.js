import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';

const router = express.Router();

// Members see 'all' + their audience; staff see everything.
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const staff = req.user.role !== 'member';
    const { rows } = staff
      ? await query('SELECT a.*, u.first_name, u.last_name FROM announcements a LEFT JOIN users u ON u.id = a.published_by ORDER BY a.created_at DESC LIMIT 50')
      : await query(
          `SELECT a.*, u.first_name, u.last_name FROM announcements a
           LEFT JOIN users u ON u.id = a.published_by
           WHERE a.audience IN ('all','members') ORDER BY a.created_at DESC LIMIT 50`
        );
    res.json(rows);
  })
);

router.post(
  '/',
  authenticate,
  requirePerm('announcements.manage'),
  asyncHandler(async (req, res) => {
    const { title, body, audience } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'Title and body are required' });
    if (audience && !['all', 'members', 'staff'].includes(audience))
      return res.status(400).json({ message: 'Invalid audience' });

    const aud = audience || 'all';
    const { rows } = await query(
      `INSERT INTO announcements (title, body, audience, published_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [title, body, aud, req.user.id]
    );

    // Fan out to in-app notifications in one query.
    const targets =
      aud === 'all' ? `role IN ('member','officer','accountant')`
      : aud === 'members' ? `role = 'member'`
      : `role IN ('officer','accountant','admin')`;
    await query(
      `INSERT INTO notifications (user_id, title, body, link)
       SELECT id, $1, $2, '/dashboard' FROM users WHERE ${targets} AND status = 'active'`,
      [`Notice: ${title}`, body.slice(0, 200)]
    );

    audit(req, 'announcement.published', 'announcement', rows[0].id, { audience: aud });
    res.status(201).json(rows[0]);
  })
);

router.delete(
  '/:id',
  authenticate,
  requirePerm('announcements.manage'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM announcements WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Not found' });
    audit(req, 'announcement.deleted', 'announcement', req.params.id, {});
    res.json({ ok: true });
  })
);

export default router;
