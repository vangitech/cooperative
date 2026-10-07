import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

// POST /api/loans — apply
router.post('/', async (req, res) => {
  try {
    const { amount, durationMonths, purpose } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    if (!durationMonths || durationMonths < 1)
      return res.status(400).json({ message: 'Duration must be at least 1 month' });

    const rate = 10; // flat annual %
    const amt = toMoney(amount);
    const total = toMoney(amt * (1 + (rate / 100) * (durationMonths / 12)));

    const { rows } = await query(
      `INSERT INTO loans (user_id, amount, interest_rate, duration_months, purpose, total_repayable)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, amt, rate, durationMonths, purpose || null, total]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/loans — my loans
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM loans WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// POST /api/loans/:id/repay
router.post('/:id/repay', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    const amt = toMoney(amount);

    const result = await withTransaction(async (client) => {
      const l = await client.query('SELECT * FROM loans WHERE id = $1 AND user_id = $2 FOR UPDATE', [
        req.params.id, req.user.id,
      ]);
      const loan = l.rows[0];
      if (!loan) throw new Error('Loan not found');
      if (!['disbursed', 'approved'].includes(loan.status)) throw new Error('Loan is not active');

      const outstanding = toMoney(Number(loan.total_repayable) - Number(loan.amount_paid));
      if (amt > outstanding) throw new Error(`Amount exceeds outstanding balance of ${outstanding}`);

      const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (Number(w.rows[0].balance) < amt) throw new Error('Insufficient wallet balance');

      const newBalance = toMoney(Number(w.rows[0].balance) - amt);
      await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
        newBalance, req.user.id,
      ]);

      const tx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'loan_repayment',$3,$4,$5,$6) RETURNING *`,
        [req.user.id, w.rows[0].id, amt, newBalance, generateRef('LRP'), `Loan #${loan.id} repayment`]
      );

      const newPaid = toMoney(Number(loan.amount_paid) + amt);
      const newStatus = newPaid >= Number(loan.total_repayable) ? 'repaid' : 'disbursed';

      await client.query('UPDATE loans SET amount_paid = $1, status = $2 WHERE id = $3', [
        newPaid, newStatus, loan.id,
      ]);
      await client.query(
        `INSERT INTO loan_repayments (loan_id, user_id, amount, transaction_id) VALUES ($1,$2,$3,$4)`,
        [loan.id, req.user.id, amt, tx.rows[0].id]
      );

      return { transaction: tx.rows[0], amountPaid: newPaid, status: newStatus, balance: newBalance };
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default router;