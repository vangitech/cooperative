import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT id, user_id, balance, created_at, updated_at FROM wallets WHERE user_id = $1',
    [req.user.id]
  );
  res.json(rows[0]);
}));

router.get('/transactions', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await query(
    `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, limit]
  );
  res.json(rows);
}));

router.post('/deposit', async (req, res) => {
  try {
    const { amount, description } = req.body;
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
         VALUES ($1,$2,'deposit',$3,$4,$5,$6) RETURNING *`,
        [req.user.id, w.rows[0].id, amt, newBalance, generateRef('DEP'), description || 'Wallet deposit']
      );
      return { wallet: { ...w.rows[0], balance: newBalance }, transaction: tx.rows[0] };
    });

    res.status(201).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message || 'Server error' });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    const amt = toMoney(amount);

    const result = await withTransaction(async (client) => {
      const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (!w.rows[0]) throw new Error('Wallet not found');
      if (Number(w.rows[0].balance) < amt) throw new Error('Insufficient wallet balance');

      const newBalance = toMoney(Number(w.rows[0].balance) - amt);
      await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
        newBalance, req.user.id,
      ]);
      const tx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'withdrawal',$3,$4,$5,$6) RETURNING *`,
        [req.user.id, w.rows[0].id, amt, newBalance, generateRef('WDR'), description || 'Wallet withdrawal']
      );
      return { wallet: { ...w.rows[0], balance: newBalance }, transaction: tx.rows[0] };
    });

    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default router;