import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler, sendCsv } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { settleDueCollections } from '../lib/collections.js';

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

// Analytics: monthly inflow/outflow plus totals by type (?months=3|6|12).
router.get('/analytics', asyncHandler(async (req, res) => {
  const months = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;

  const monthly = await query(
    `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
            SUM(CASE WHEN type IN
              ('deposit','savings','dividend','loan_disbursement','fixed_maturity','refund','fixed_break')
              THEN amount ELSE 0 END)::float AS inflow,
            SUM(CASE WHEN type IN ('withdrawal','loan_repayment','fixed_deposit')
              THEN amount ELSE 0 END)::float AS outflow,
            COUNT(*) AS count
     FROM transactions
     WHERE user_id = $1
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE) - (CAST($2 AS INTEGER) * INTERVAL '1 month')
     GROUP BY DATE_TRUNC('month', created_at)
     ORDER BY DATE_TRUNC('month', created_at)`,
    [req.user.id, months]
  );

  const byType = await query(
    `SELECT type, SUM(amount)::float AS total, COUNT(*) AS count
     FROM transactions
     WHERE user_id = $1
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE) - (CAST($2 AS INTEGER) * INTERVAL '1 month')
     GROUP BY type ORDER BY total DESC`,
    [req.user.id, months]
  );

  const inflow = monthly.rows.reduce((s, m) => s + Number(m.inflow), 0);
  const outflow = monthly.rows.reduce((s, m) => s + Number(m.outflow), 0);
  res.json({
    months,
    monthly: monthly.rows,
    byType: byType.rows,
    summary: { inflow, outflow, net: inflow - outflow },
  });
}));

// Downloadable account statement (CSV, optional ?from=YYYY-MM-DD&to=YYYY-MM-DD).
router.get('/statement.csv', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.user.id];
  let range = '';
  if (from) {
    params.push(from);
    range += ` AND created_at >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    range += ` AND created_at <= $${params.length}`;
  }
  const { rows } = await query(
    `SELECT created_at, reference, type, description, amount, balance_after
     FROM transactions WHERE user_id = $1 ${range} ORDER BY created_at`,
    params
  );
  sendCsv(
    res,
    `mpcs-statement-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Date', 'Reference', 'Type', 'Description', 'Amount', 'Balance After'],
    rows.map((t) => [t.created_at, t.reference, t.type, t.description, t.amount, t.balance_after])
  );
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

// Look up a transfer recipient by email or 10-digit funding account number.
router.get('/resolve-recipient', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ message: 'Search value is required' });

  let user = null;
  if (/^\d{10}$/.test(q)) {
    const va = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.status
       FROM virtual_accounts v JOIN users u ON u.id = v.user_id
       WHERE v.account_number = $1`,
      [q]
    );
    user = va.rows[0];
  } else {
    const u = await query(
      'SELECT id, first_name, last_name, email, status FROM users WHERE email = $1',
      [q.toLowerCase()]
    );
    user = u.rows[0];
  }

  if (!user) return res.status(404).json({ message: 'No member found' });
  if (user.id === req.user.id) return res.status(400).json({ message: 'You cannot send to yourself' });
  if (user.status !== 'active') return res.status(400).json({ message: 'Recipient account is not active' });
  res.json({ id: user.id, name: `${user.first_name} ${user.last_name}`, email: user.email });
}));

// Member-to-member transfer (instant, no fee).
router.post('/transfer', asyncHandler(async (req, res) => {
  const { recipient, amount } = req.body;
  if (!recipient) return res.status(400).json({ message: 'Recipient email or account number is required' });
  if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
  const amt = toMoney(amount);

  let result;
  try {
    result = await withTransaction(async (client) => {
    const q = String(recipient).trim();
    let target = null;
    if (/^\d{10}$/.test(q)) {
      const va = await client.query(
        'SELECT u.* FROM virtual_accounts v JOIN users u ON u.id = v.user_id WHERE v.account_number = $1',
        [q]
      );
      target = va.rows[0];
    } else {
      const u = await client.query('SELECT * FROM users WHERE email = $1', [q.toLowerCase()]);
      target = u.rows[0];
    }
    if (!target) throw new Error('Recipient not found');
    if (target.id === req.user.id) throw new Error('You cannot send to yourself');
    if (target.status !== 'active') throw new Error('Recipient account is not active');

    const from = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    if (!from.rows[0]) throw new Error('Wallet not found');
    if (Number(from.rows[0].balance) < amt) throw new Error('Insufficient wallet balance');

    const to = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [target.id]);
    if (!to.rows[0]) throw new Error('Recipient wallet not found');

    const ref = generateRef('TRF');
    const fromBalance = toMoney(Number(from.rows[0].balance) - amt);
    const toBalance = toMoney(Number(to.rows[0].balance) + amt);
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
      fromBalance, from.rows[0].id,
    ]);
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
      toBalance, to.rows[0].id,
    ]);
    await client.query(
      `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
       VALUES ($1,$2,'transfer_out',$3,$4,$5,$6)`,
      [req.user.id, from.rows[0].id, amt, fromBalance, ref, `Transfer to ${target.first_name} ${target.last_name}`]
    );
    await client.query(
      `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
       VALUES ($1,$2,'transfer_in',$3,$4,$5,$6)`,
      [target.id, to.rows[0].id, amt, toBalance, `${ref}-IN`, `Transfer from ${req.user.first_name} ${req.user.last_name}`]
    );
    await client.query(
      `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
      [target.id, 'Money received', `${req.user.first_name} ${req.user.last_name} sent you ${amt} NGN.`, '/wallet']
    );
    return { reference: ref, recipientId: target.id, recipient: `${target.first_name} ${target.last_name}`, amount: amt, balance: fromBalance };
  });
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  audit(req, 'wallet.transfer_sent', 'user', req.user.id, { reference: result.reference, amount: amt });
  await settleDueCollections(withTransaction, result.recipientId);
  res.status(201).json(result);
}));

export default router;