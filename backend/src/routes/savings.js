import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

// POST /api/savings — make a savings deposit (daily/monthly/etc.)
router.post('/', async (req, res) => {
  try {
    const { amount, savingsType = 'daily', note } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    const amt = toMoney(amount);

    const result = await withTransaction(async (client) => {
      const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (!w.rows[0]) throw new Error('Wallet not found');

      const newBalance = toMoney(Number(w.rows[0].balance) + amt);
      await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
        newBalance, req.user.id,
      ]);

      const tx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'savings',$3,$4,$5,$6) RETURNING *`,
        [req.user.id, w.rows[0].id, amt, newBalance, generateRef('SAV'),
         `Savings deposit (${savingsType})`]
      );

      const s = await client.query(
        `INSERT INTO savings (user_id, amount, savings_type, note, transaction_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, amt, savingsType, note || null, tx.rows[0].id]
      );

      return { savings: s.rows[0], transaction: tx.rows[0], balance: newBalance };
    });

    res.status(201).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

// GET /api/savings — list my savings
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM savings WHERE user_id = $1 ORDER BY savings_date DESC, created_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json(rows);
}));

// GET /api/savings/summary
router.get('/summary', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE savings_date = CURRENT_DATE), 0) AS today,
       COALESCE(SUM(amount) FILTER (WHERE savings_date >= DATE_TRUNC('week', CURRENT_DATE)), 0) AS this_week,
       COALESCE(SUM(amount) FILTER (WHERE savings_date >= DATE_TRUNC('month', CURRENT_DATE)), 0) AS this_month,
       COALESCE(SUM(amount), 0) AS total,
       COUNT(*) AS count
      FROM savings WHERE user_id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
}));

export default router;