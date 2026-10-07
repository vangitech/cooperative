import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

// Latest first, unread on top.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM notifications WHERE user_id = $1
       ORDER BY is_read, created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  })
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    res.json({ unread: Number(rows[0].count) });
  })
);

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  })
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [
      req.params.id, req.user.id,
    ]);
    res.json({ ok: true });
  })
);

export default router;
