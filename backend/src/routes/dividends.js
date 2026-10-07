import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM dividends WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE status='paid'),0) AS total_paid,
       COALESCE(SUM(amount) FILTER (WHERE status='pending'),0) AS total_pending,
       COUNT(*) AS count
      FROM dividends WHERE user_id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
}));

export default router;