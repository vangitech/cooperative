import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import {
  ensureSchedules,
  assessPenalties,
  allocateRepayment,
  loanOutstanding,
} from '../lib/loans.js';

const router = express.Router();
router.use(authenticate);

// Active loan products members can apply for.
router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM loan_products WHERE status = 'active' ORDER BY min_amount`
    );
    res.json(rows);
  })
);

// POST /api/loans — apply under a product (eligibility enforced).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const { amount, durationMonths, purpose, productId } = req.body;
      if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
      if (!productId) return res.status(400).json({ message: 'Loan product is required' });

      const p = await query(`SELECT * FROM loan_products WHERE id = $1 AND status = 'active'`, [productId]);
      const product = p.rows[0];
      if (!product) return res.status(400).json({ message: 'Loan product not available' });

      const amt = toMoney(amount);
      const months = Number(durationMonths);
      if (amt < Number(product.min_amount))
        return res.status(400).json({ message: `Minimum for ${product.name} is ${product.min_amount}` });
      if (product.max_amount && amt > Number(product.max_amount))
        return res.status(400).json({ message: `Maximum for ${product.name} is ${product.max_amount}` });
      if (!months || months < Number(product.min_duration_months) || months > Number(product.max_duration_months))
        return res.status(400).json({
          message: `Duration for ${product.name} must be ${product.min_duration_months}–${product.max_duration_months} months`,
        });

      // Savings multiple: member must have saved enough.
      if (Number(product.required_savings_multiple) > 0) {
        const s = await query('SELECT COALESCE(SUM(amount),0) AS total FROM savings WHERE user_id = $1', [
          req.user.id,
        ]);
        const required = toMoney(amt * Number(product.required_savings_multiple));
        if (Number(s.rows[0].total) < required)
          return res.status(400).json({
            message: `Requires at least ${required} in savings (${product.required_savings_multiple}× of amount)`,
          });
      }

      // Membership age.
      if (Number(product.min_membership_months) > 0) {
        const u = await query(
          `SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 2592000 AS months FROM users WHERE id = $1`,
          [req.user.id]
        );
        if (Number(u.rows[0].months) < Number(product.min_membership_months))
          return res.status(400).json({
            message: `Requires ${product.min_membership_months} months of membership for ${product.name}`,
          });
      }

      // Guarantors.
      if (product.requires_guarantors && Number(product.guarantor_count) > 0) {
        const g = await query('SELECT COUNT(*) FROM guarantors WHERE user_id = $1', [req.user.id]);
        if (Number(g.rows[0].count) < Number(product.guarantor_count))
          return res.status(400).json({
            message: `${product.name} requires ${product.guarantor_count} guarantor(s) — add them under Profile → KYC`,
          });
      }

      const rate = Number(product.interest_rate);
      const total = toMoney(amt * (1 + (rate / 100) * (months / 12)));

      const { rows } = await query(
        `INSERT INTO loans (user_id, amount, interest_rate, duration_months, purpose, total_repayable, product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, amt, rate, months, purpose || null, total, product.id]
      );
      audit(req, 'loan.applied', 'loan', rows[0].id, { amount: amt, product: product.name });
      res.status(201).json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Server error' });
    }
  })
);

// GET /api/loans — my loans (with live outstanding incl. penalties).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT l.*, p.name AS product_name
       FROM loans l LEFT JOIN loan_products p ON p.id = l.product_id
       WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map((l) => ({ ...l, outstanding: loanOutstanding(l) })));
  })
);

// GET /api/loans/:id/schedule — repayment schedule with due/overdue state.
router.get(
  '/:id/schedule',
  asyncHandler(async (req, res) => {
    const found = await query('SELECT * FROM loans WHERE id = $1 AND user_id = $2', [
      req.params.id, req.user.id,
    ]);
    const loan = found.rows[0];
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    await withTransaction(async (client) => {
      await ensureSchedules(client, loan);
      const fresh = await client.query('SELECT * FROM loans WHERE id = $1', [loan.id]);
      await assessPenalties(client, fresh.rows[0]);
    });

    const { rows } = await query(
      `SELECT *, CASE WHEN due_date < CURRENT_DATE AND amount_paid < amount_due THEN true ELSE false END AS overdue
       FROM loan_schedules WHERE loan_id = $1 ORDER BY due_number`,
      [loan.id]
    );
    const updated = await query('SELECT * FROM loans WHERE id = $1', [loan.id]);
    res.json({ loan: { ...updated.rows[0], outstanding: loanOutstanding(updated.rows[0]) }, schedule: rows });
  })
);

// POST /api/loans/:id/repay
router.post(
  '/:id/repay',
  asyncHandler(async (req, res) => {
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

        await ensureSchedules(client, loan);
        await assessPenalties(client, loan);

        const outstanding = loanOutstanding(loan);
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

        await allocateRepayment(client, loan.id, amt);

        const newPaid = toMoney(Number(loan.amount_paid) + amt);
        const finalOutstanding = toMoney(
          Number(loan.total_repayable) + Number(loan.penalty_accrued || 0) - newPaid
        );
        const newStatus = finalOutstanding <= 0 ? 'repaid' : 'disbursed';

        await client.query('UPDATE loans SET amount_paid = $1, status = $2 WHERE id = $3', [
          newPaid, newStatus, loan.id,
        ]);
        await client.query(
          `INSERT INTO loan_repayments (loan_id, user_id, amount, transaction_id) VALUES ($1,$2,$3,$4)`,
          [loan.id, req.user.id, amt, tx.rows[0].id]
        );

        return { transaction: tx.rows[0], amountPaid: newPaid, status: newStatus, balance: newBalance };
      });

      audit(req, 'loan.repaid', 'loan', req.params.id, { amount: amt });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

export default router;
