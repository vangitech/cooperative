import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';

const router = express.Router();
router.use(authenticate);

// Published fixed-deposit rates.
router.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM deposit_rates WHERE status = 'active' ORDER BY tenure_months`
    );
    res.json(rows);
  })
);

// Lock funds into a fixed deposit (debits the spendable wallet).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const { amount, tenureMonths } = req.body;
      if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });

      const r = await query(
        `SELECT * FROM deposit_rates WHERE tenure_months = $1 AND status = 'active'`,
        [Number(tenureMonths)]
      );
      const rate = r.rows[0];
      if (!rate) return res.status(400).json({ message: 'Tenure not available' });

      const amt = toMoney(amount);
      if (amt < Number(rate.min_amount))
        return res.status(400).json({ message: `Minimum for ${rate.tenure_months} months is ${rate.min_amount}` });

      const annual = Number(rate.annual_rate);
      const tenure = Number(rate.tenure_months);
      const payout = toMoney(amt * (1 + (annual / 100) * (tenure / 12)));
      const maturesAt = new Date();
      maturesAt.setMonth(maturesAt.getMonth() + tenure);

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
           VALUES ($1,$2,'fixed_deposit',$3,$4,$5,$6) RETURNING *`,
          [req.user.id, w.rows[0].id, amt, newBalance, generateRef('FXD'), `Fixed deposit ${rate.tenure_months}mo @ ${annual}%`]
        );
        const fd = await client.query(
          `INSERT INTO fixed_deposits (user_id, amount, tenure_months, annual_rate, expected_payout, matures_at, transaction_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [req.user.id, amt, tenure, annual, payout, maturesAt.toISOString(), tx.rows[0].id]
        );
        return { fixed: fd.rows[0], transaction: tx.rows[0], balance: newBalance };
      });

      audit(req, 'fixed.locked', 'fixed_deposit', result.fixed.id, { amount: amt });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

// My fixed deposits (with live claimable state).
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT *, (status = 'active' AND matures_at <= NOW()) AS claimable
       FROM fixed_deposits WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Claim a matured deposit: principal + interest back to wallet.
router.post(
  '/:id/claim',
  asyncHandler(async (req, res) => {
    try {
      const result = await withTransaction(async (client) => {
        const f = await client.query(
          'SELECT * FROM fixed_deposits WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [req.params.id, req.user.id]
        );
        const fd = f.rows[0];
        if (!fd) throw new Error('Fixed deposit not found');
        if (fd.status !== 'active') throw new Error(`Already ${fd.status}`);
        if (new Date(fd.matures_at) > new Date()) throw new Error('Not yet matured');

        const payout = toMoney(fd.expected_payout);
        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
        const newBalance = toMoney(Number(w.rows[0].balance) + payout);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
          newBalance, req.user.id,
        ]);
        const tx = await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'fixed_maturity',$3,$4,$5,$6) RETURNING *`,
          [req.user.id, w.rows[0].id, payout, newBalance, generateRef('FXM'), `Fixed deposit #${fd.id} matured`]
        );
        await client.query(`UPDATE fixed_deposits SET status = 'matured' WHERE id = $1`, [fd.id]);
        return { transaction: tx.rows[0], payout, balance: newBalance };
      });
      audit(req, 'fixed.matured', 'fixed_deposit', req.params.id, { payout: result.payout });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

// Break early: principal back, interest forfeited.
router.post(
  '/:id/break',
  asyncHandler(async (req, res) => {
    try {
      const result = await withTransaction(async (client) => {
        const f = await client.query(
          'SELECT * FROM fixed_deposits WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [req.params.id, req.user.id]
        );
        const fd = f.rows[0];
        if (!fd) throw new Error('Fixed deposit not found');
        if (fd.status !== 'active') throw new Error(`Already ${fd.status}`);

        const amt = toMoney(fd.amount);
        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
        const newBalance = toMoney(Number(w.rows[0].balance) + amt);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
          newBalance, req.user.id,
        ]);
        const tx = await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'fixed_break',$3,$4,$5,$6) RETURNING *`,
          [req.user.id, w.rows[0].id, amt, newBalance, generateRef('FXB'), `Fixed deposit #${fd.id} broken early (interest forfeited)`]
        );
        await client.query(`UPDATE fixed_deposits SET status = 'broken' WHERE id = $1`, [fd.id]);
        return { transaction: tx.rows[0], refunded: amt, balance: newBalance };
      });
      audit(req, 'fixed.broken', 'fixed_deposit', req.params.id, { refunded: result.refunded });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

export default router;
