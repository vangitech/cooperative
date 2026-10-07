import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateRef, toMoney, isPositiveNumber, asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

/* ---------- Stats ---------- */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='member') AS total_members,
      (SELECT COUNT(*) FROM users WHERE status='active') AS active_members,
      (SELECT COALESCE(SUM(balance),0) FROM wallets) AS total_wallet_balance,
      (SELECT COALESCE(SUM(amount),0) FROM savings) AS total_savings,
      (SELECT COALESCE(SUM(amount),0) FROM loans WHERE status IN ('disbursed','approved')) AS active_loans_amount,
      (SELECT COUNT(*) FROM loans WHERE status='pending') AS pending_loans,
      (SELECT COALESCE(SUM(amount),0) FROM dividends WHERE status='paid') AS total_dividends_paid,
      (SELECT COUNT(*) FROM transactions) AS total_transactions
  `);

  const monthly = await query(`
    SELECT TO_CHAR(DATE_TRUNC('month', savings_date), 'Mon YYYY') AS month,
           SUM(amount)::float AS total
    FROM savings
    WHERE savings_date >= (CURRENT_DATE - INTERVAL '6 months')
    GROUP BY DATE_TRUNC('month', savings_date)
    ORDER BY DATE_TRUNC('month', savings_date)
  `);

  res.json({ stats: stats.rows[0], monthlySavings: monthly.rows });
}));

/* ---------- Members ---------- */
router.get('/users', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.created_at,
           COALESCE(w.balance,0) AS balance,
           (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id=u.id) AS total_savings
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ message: 'Invalid status' });
  const { rows } = await query(
    `UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status`,
    [status, req.params.id]
  );
  res.json(rows[0]);
}));

router.patch('/users/:id/role', asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['member', 'admin'].includes(role))
    return res.status(400).json({ message: 'Invalid role' });
  const { rows } = await query(
    `UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING id, role`,
    [role, req.params.id]
  );
  res.json(rows[0]);
}));

/* ---------- Transactions ---------- */
router.get('/transactions', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, u.first_name, u.last_name, u.email
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Savings ---------- */
router.get('/savings', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT s.*, u.first_name, u.last_name, u.email
    FROM savings s JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

/* ---------- Loans ---------- */
router.get('/loans', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT l.*, u.first_name, u.last_name, u.email
    FROM loans l JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
  `);
  res.json(rows);
}));

router.patch('/loans/:id', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    const result = await withTransaction(async (client) => {
      const l = await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [req.params.id]);
      const loan = l.rows[0];
      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'pending') throw new Error('Loan already reviewed');

      if (status === 'rejected') {
        const r = await client.query(
          `UPDATE loans SET status='rejected', reviewed_by=$1, reviewed_at=NOW(), review_note=$2
           WHERE id=$3 RETURNING *`,
          [req.user.id, note || null, loan.id]
        );
        return r.rows[0];
      }

      // approved → disburse into wallet
      const w = await client.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [loan.user_id]);
      const newBalance = toMoney(Number(w.rows[0].balance) + Number(loan.amount));
      await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [
        newBalance, loan.user_id,
      ]);
      await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'loan_disbursement',$3,$4,$5,$6)`,
        [loan.user_id, w.rows[0].id, loan.amount, newBalance, generateRef('LND'), `Loan #${loan.id} disbursement`]
      );
      const r = await client.query(
        `UPDATE loans SET status='disbursed', reviewed_by=$1, reviewed_at=NOW(), review_note=$2
         WHERE id=$3 RETURNING *`,
        [req.user.id, note || null, loan.id]
      );
      return r.rows[0];
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

/* ---------- Dividends ---------- */
router.get('/dividends', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT d.*, u.first_name, u.last_name, u.email
    FROM dividends d JOIN users u ON u.id = d.user_id
    ORDER BY d.created_at DESC LIMIT 300
  `);
  res.json(rows);
}));

// Declare a dividend. If totalAmount provided → distributed equally among active members.
// If userId + amount provided → single member.
router.post('/dividends', async (req, res) => {
  try {
    const { period, totalAmount, userId, amount } = req.body;
    if (!period) return res.status(400).json({ message: 'Period is required (e.g. "2025 Q1")' });

    const inserted = await withTransaction(async (client) => {
      if (userId) {
        if (!isPositiveNumber(amount)) throw new Error('Amount is required for single member');
        const r = await client.query(
          `INSERT INTO dividends (user_id, amount, period) VALUES ($1,$2,$3) RETURNING *`,
          [userId, toMoney(amount), period]
        );
        return [r.rows[0]];
      }

      if (!isPositiveNumber(totalAmount)) throw new Error('totalAmount or userId+amount required');
      const members = await client.query(`SELECT id FROM users WHERE role='member' AND status='active'`);
      if (!members.rows.length) throw new Error('No active members');
      const per = toMoney(Number(totalAmount) / members.rows.length);

      const out = [];
      for (const m of members.rows) {
        const r = await client.query(
          `INSERT INTO dividends (user_id, amount, period) VALUES ($1,$2,$3) RETURNING *`,
          [m.id, per, period]
        );
        out.push(r.rows[0]);
      }
      return out;
    });

    res.status(201).json({ count: inserted.length, dividends: inserted });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.patch('/dividends/:id/pay', async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const d = await client.query('SELECT * FROM dividends WHERE id=$1 FOR UPDATE', [req.params.id]);
      const div = d.rows[0];
      if (!div) throw new Error('Dividend not found');
      if (div.status === 'paid') throw new Error('Already paid');

      const w = await client.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [div.user_id]);
      const newBalance = toMoney(Number(w.rows[0].balance) + Number(div.amount));
      await client.query('UPDATE wallets SET balance=$1, updated_at=NOW() WHERE user_id=$2', [
        newBalance, div.user_id,
      ]);

      const tx = await client.query(
        `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
         VALUES ($1,$2,'dividend',$3,$4,$5,$6) RETURNING *`,
        [div.user_id, w.rows[0].id, div.amount, newBalance, generateRef('DIV'), `Dividend ${div.period}`]
      );

      const r = await client.query(
        `UPDATE dividends SET status='paid', transaction_id=$1 WHERE id=$2 RETURNING *`,
        [tx.rows[0].id, div.id]
      );
      return r.rows[0];
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default router;