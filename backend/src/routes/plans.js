import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { nextRunDate, runDuePlans } from '../lib/plans.js';

const router = express.Router();
router.use(authenticate);

// Create a monthly recurring savings plan (debited from wallet).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { amount, dayOfMonth, savingsType, note } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    const day = Number(dayOfMonth);
    if (!day || day < 1 || day > 28)
      return res.status(400).json({ message: 'Day of month must be 1–28' });

    const { rows } = await query(
      `INSERT INTO savings_plans (user_id, amount, day_of_month, savings_type, note, next_run)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, toMoney(amount), day, savingsType || 'monthly', note || null, nextRunDate(day)]
    );
    audit(req, 'savings.plan_created', 'savings_plan', rows[0].id, { amount: Number(rows[0].amount) });
    res.status(201).json(rows[0]);
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM savings_plans WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['active', 'paused', 'cancelled'].includes(status))
      return res.status(400).json({ message: 'Status must be active, paused or cancelled' });
    const { rows } = await query(
      `UPDATE savings_plans SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Plan not found' });
    audit(req, `savings.plan_${status}`, 'savings_plan', rows[0].id, {});
    res.json(rows[0]);
  })
);

// Manual/cron trigger: run every due plan now. Point any scheduler
// (Vercel Cron, cron-job.org, GitHub Actions) at this endpoint.
router.post(
  '/run-due',
  requirePerm('*'),
  asyncHandler(async (req, res) => {
    res.json(await runDuePlans());
  })
);

export default router;
