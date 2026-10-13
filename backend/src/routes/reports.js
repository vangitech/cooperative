import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler, sendCsv } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';

// Regulatory compliance reporting: on-demand period reports
// (monthly / quarterly / yearly / custom range) as JSON preview
// or CSV download. Every generation is written to the audit trail.
//
//   GET /admin/reports/:type?period=monthly&year=2026&month=10&format=json
//   GET /admin/reports/loan-book?period=quarterly&year=2026&quarter=3&format=csv

const router = express.Router();
router.use(authenticate);

const TYPES = [
  'financial-summary',
  'member-register',
  'savings-ledger',
  'loan-book',
  'dividend-register',
  'transaction-ledger',
  'audit-trail',
];

const pad = (n) => String(n).padStart(2, '0');

function resolveRange(q) {
  const now = new Date();
  const year = Number.parseInt(q.year, 10) || now.getUTCFullYear();
  if (year < 2000 || year > 2100) {
    const err = new Error('Invalid year');
    err.status = 400;
    throw err;
  }
  const period = ['monthly', 'quarterly', 'yearly', 'custom'].includes(q.period) ? q.period : 'monthly';

  if (period === 'yearly') {
    return { period, label: `${year}`, from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  if (period === 'quarterly') {
    const quarter = Math.min(4, Math.max(1, Number.parseInt(q.quarter, 10) || 1));
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 3;
    const endYear = endMonth > 12 ? year + 1 : year;
    const endM = endMonth > 12 ? endMonth - 12 : endMonth;
    return {
      period, label: `${year} Q${quarter}`,
      from: `${year}-${pad(startMonth)}-01`, to: `${endYear}-${pad(endM)}-01`,
    };
  }
  if (period === 'custom') {
    if (!q.from || !q.to) {
      const err = new Error('Custom range needs ?from=YYYY-MM-DD&to=YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
      const err = new Error('Dates must be YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    if (q.from > q.to) {
      const err = new Error('Range start must be before range end');
      err.status = 400;
      throw err;
    }
    // `to` is inclusive for the caller, exclusive for SQL — add a day.
    const end = new Date(`${q.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const to = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
    return { period, label: `${q.from} → ${q.to}`, from: q.from, to };
  }
  // monthly (default)
  const month = Math.min(12, Math.max(1, Number.parseInt(q.month, 10) || now.getUTCMonth() + 1));
  const endMonth = month + 1;
  const endYear = endMonth > 12 ? year + 1 : year;
  const endM = endMonth > 12 ? endMonth - 12 : endMonth;
  return {
    period, label: `${year}-${pad(month)}`,
    from: `${year}-${pad(month)}-01`, to: `${endYear}-${pad(endM)}-01`,
  };
}

const num = (v) => Number(v || 0);

async function buildReport(type, from, to) {
  switch (type) {
    case 'financial-summary': {
      const { rows } = await query(
        `SELECT
          (SELECT COALESCE(SUM(amount),0) FROM savings WHERE savings_date >= $1 AND savings_date < $2) AS savings_in,
          (SELECT COALESCE(SUM(amount),0) FROM loans WHERE created_at >= $1 AND created_at < $2 AND status IN ('approved','disbursed','repaid')) AS loans_disbursed,
          (SELECT COALESCE(SUM(amount),0) FROM loan_repayments WHERE created_at >= $1 AND created_at < $2) AS loans_repaid,
          (SELECT COALESCE(SUM(amount),0) FROM dividends WHERE created_at >= $1 AND created_at < $2 AND status = 'paid') AS dividends_paid,
          (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE created_at >= $1 AND created_at < $2 AND type IN ('deposit','fund','savings')) AS deposits,
          (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE created_at >= $1 AND created_at < $2 AND type IN ('withdrawal','transfer_out')) AS withdrawals,
          (SELECT COUNT(*) FROM users WHERE role = 'member' AND created_at >= $1 AND created_at < $2) AS new_members,
          (SELECT COUNT(*) FROM transactions WHERE created_at >= $1 AND created_at < $2) AS tx_count,
          (SELECT COALESCE(SUM(balance),0) FROM wallets) AS wallet_balances_now,
          (SELECT COALESCE(SUM(amount),0) FROM fixed_deposits WHERE status = 'active') AS fixed_locked_now`,
        [from, to]
      );
      const r = rows[0];
      const metrics = [
        ['Savings mobilised', num(r.savings_in)],
        ['Loans disbursed', num(r.loans_disbursed)],
        ['Loan repayments collected', num(r.loans_repaid)],
        ['Dividends paid out', num(r.dividends_paid)],
        ['Wallet deposits', num(r.deposits)],
        ['Withdrawals / payouts', num(r.withdrawals)],
        ['New members admitted', Number(r.new_members)],
        ['Transactions processed', Number(r.tx_count)],
        ['Wallet balances (now)', num(r.wallet_balances_now)],
        ['Fixed deposits locked (now)', num(r.fixed_locked_now)],
      ];
      return { columns: ['Metric', 'Value'], rows: metrics, summary: { metrics: metrics.length } };
    }

    case 'member-register': {
      const { rows } = await query(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.email, u.phone,
                u.role, u.status, u.created_at AS joined,
                COALESCE(w.balance, 0) AS wallet,
                (SELECT COALESCE(SUM(amount),0) FROM savings s WHERE s.user_id = u.id) AS total_savings
         FROM users u LEFT JOIN wallets w ON w.user_id = u.id
         WHERE u.created_at < $1::timestamptz
         ORDER BY u.created_at`,
        [to]
      );
      return {
        columns: ['ID', 'Name', 'Email', 'Phone', 'Role', 'Status', 'Joined', 'Wallet', 'Total savings'],
        rows: rows.map((u) => [u.id, u.name, u.email, u.phone, u.role, u.status, u.joined, u.wallet, u.total_savings]),
        summary: { members: rows.length },
      };
    }

    case 'savings-ledger': {
      const { rows } = await query(
        `SELECT s.savings_date AS date, u.first_name || ' ' || u.last_name AS member,
                u.email, s.savings_type AS type, s.amount, s.note
         FROM savings s JOIN users u ON u.id = s.user_id
         WHERE s.savings_date >= $1 AND s.savings_date < $2
         ORDER BY s.savings_date, s.id`,
        [from, to]
      );
      const total = rows.reduce((a, r) => a + num(r.amount), 0);
      return {
        columns: ['Date', 'Member', 'Email', 'Type', 'Amount', 'Note'],
        rows: rows.map((r) => [r.date, r.member, r.email, r.type, r.amount, r.note]),
        summary: { entries: rows.length, total },
      };
    }

    case 'loan-book': {
      const { rows } = await query(
        `SELECT l.id, u.first_name || ' ' || u.last_name AS member, u.email,
                l.amount, l.interest_rate, l.duration_months, l.status,
                l.total_repayable, l.amount_paid, l.created_at AS booked
         FROM loans l JOIN users u ON u.id = l.user_id
         WHERE l.created_at < $1::timestamptz
         ORDER BY l.created_at`,
        [to]
      );
      const disbursed = rows
        .filter((l) => ['approved', 'disbursed', 'repaid'].includes(l.status))
        .reduce((a, l) => a + num(l.amount), 0);
      const outstanding = rows.reduce((a, l) => a + num(l.total_repayable) - num(l.amount_paid), 0);
      return {
        columns: ['ID', 'Member', 'Email', 'Amount', 'Rate %', 'Months', 'Status', 'Repayable', 'Paid', 'Booked'],
        rows: rows.map((l) => [l.id, l.member, l.email, l.amount, l.interest_rate, l.duration_months, l.status, l.total_repayable, l.amount_paid, l.booked]),
        summary: { loans: rows.length, disbursed, outstanding },
      };
    }

    case 'dividend-register': {
      const { rows } = await query(
        `SELECT d.period, u.first_name || ' ' || u.last_name AS member,
                u.email, d.amount, d.status, d.created_at AS recorded
         FROM dividends d JOIN users u ON u.id = d.user_id
         WHERE d.created_at >= $1 AND d.created_at < $2
         ORDER BY d.created_at`,
        [from, to]
      );
      const total = rows.reduce((a, r) => a + num(r.amount), 0);
      return {
        columns: ['Period', 'Member', 'Email', 'Amount', 'Status', 'Recorded'],
        rows: rows.map((r) => [r.period, r.member, r.email, r.amount, r.status, r.recorded]),
        summary: { entries: rows.length, total },
      };
    }

    case 'transaction-ledger': {
      const { rows } = await query(
        `SELECT t.created_at AS date, t.reference, u.first_name || ' ' || u.last_name AS member,
                u.email, t.type, t.amount, t.balance_after, t.status
         FROM transactions t JOIN users u ON u.id = t.user_id
         WHERE t.created_at >= $1 AND t.created_at < $2
         ORDER BY t.created_at`,
        [from, to]
      );
      return {
        columns: ['Date', 'Reference', 'Member', 'Email', 'Type', 'Amount', 'Balance after', 'Status'],
        rows: rows.map((t) => [t.date, t.reference, t.member, t.email, t.type, t.amount, t.balance_after, t.status]),
        summary: { entries: rows.length },
      };
    }

    case 'audit-trail': {
      const { rows } = await query(
        `SELECT a.created_at AS time, u.email AS actor, a.action, a.entity, a.entity_id, a.ip
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.created_at >= $1 AND a.created_at < $2
         ORDER BY a.created_at`,
        [from, to]
      );
      return {
        columns: ['Time', 'Actor', 'Action', 'Entity', 'Entity ID', 'IP'],
        rows: rows.map((a) => [a.time, a.actor, a.action, a.entity, a.entity_id, a.ip]),
        summary: { entries: rows.length },
      };
    }

    default:
      return null;
  }
}

router.get('/:type', requirePerm('reports.read'), asyncHandler(async (req, res) => {
  const { type } = req.params;
  if (!TYPES.includes(type)) {
    return res.status(400).json({ message: `Unknown report (one of: ${TYPES.join(', ')})` });
  }
  let range;
  try {
    range = resolveRange(req.query);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  const report = await buildReport(type, range.from, range.to);
  const meta = {
    type,
    period: range.period,
    label: range.label,
    from: range.from,
    to: range.to,
    generatedAt: new Date().toISOString(),
    generatedBy: req.user.email,
  };

  audit(req, 'report.generated', 'report', null, { ...meta, format: req.query.format || 'json' });

  if ((req.query.format || 'json') === 'csv') {
    const safeLabel = range.label.replace(/[^0-9A-Za-z]+/g, '-');
    return sendCsv(res, `mpcs-${type}-${safeLabel}.csv`, report.columns, report.rows);
  }
  res.json({ ...meta, ...report });
}));

export default router;
