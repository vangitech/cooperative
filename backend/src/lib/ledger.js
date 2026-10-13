import { query } from '../db.js';

// Double-entry core. Two modes:
//   Simple mirror (L1): { direction: 'in'|'out', settlement }
//     wallet credited → Dr Settlement Float / Cr Wallets Control
//     wallet debited  → Dr Wallets Control / Cr Settlement Float
//   Explicit legs (L2): { lines: [{ code, debit, credit }] }
//     for earmarks (lock, plan runs), income splits (repayments),
//     receivables (disbursal, store), distributions (dividends).
//
// Rules enforced on every post: positive amounts, balanced legs
// (±0.005), active accounts, open period, idempotent source.
// Must be called with the SAME client as the money movement (atomic).

const CONTROL = '1100';

const accountCache = new Map();

async function accountId(clientOrQuery, code) {
  if (accountCache.has(code)) return accountCache.get(code);
  const run = typeof clientOrQuery === 'function' ? clientOrQuery : (t, p) => clientOrQuery.query(t, p);
  const { rows } = await run('SELECT id FROM accounts WHERE code = $1 AND status = $2', [code, 'active']);
  if (!rows[0]) throw new Error(`Ledger account ${code} missing or inactive`);
  accountCache.set(code, rows[0].id);
  return rows[0].id;
}

export function periodOf(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function assertOpenPeriod(client, period) {
  const { rows } = await client.query('SELECT period FROM close_periods WHERE period = $1', [period]);
  if (rows[0]) throw new Error(`Accounting period ${period} is closed`);
}

export async function postJournal(client, req, {
  type, transactionId = null, reference = null, amount,
  direction, settlement = '1001', lines = null, orgId = null,
  channel = null, postedAt = null, reversalOf = null,
}) {
  let legs;
  if (lines) {
    if (!Array.isArray(lines) || lines.length < 2) throw new Error('Journal needs at least 2 lines');
    legs = [];
    for (const l of lines) {
      const dr = Number(l.debit || 0);
      const cr = Number(l.credit || 0);
      if (!(dr > 0) && !(cr > 0)) throw new Error('Each journal line needs a debit or credit');
      if (dr > 0 && cr > 0) throw new Error('A journal line cannot debit and credit');
      legs.push({ accountId: await accountId(client, l.code), dr, cr });
    }
  } else {
    const amt = Number(amount);
    if (!(amt > 0)) throw new Error('Journal amount must be positive');
    if (direction !== 'in' && direction !== 'out') throw new Error('Journal direction must be in|out');
    const debitCode = direction === 'in' ? settlement : CONTROL;
    const creditCode = direction === 'in' ? CONTROL : settlement;
    const [debitId, creditId] = await Promise.all([
      accountId(client, debitCode), accountId(client, creditCode),
    ]);
    legs = [
      { accountId: debitId, dr: amt, cr: 0 },
      { accountId: creditId, dr: 0, cr: amt },
    ];
  }

  // Invariant: legs must sum to zero or the whole money movement aborts.
  const dr = legs.reduce((s, l) => s + l.dr, 0);
  const cr = legs.reduce((s, l) => s + l.cr, 0);
  if (Math.abs(dr - cr) > 0.005) throw new Error('Unbalanced journal legs rejected');

  const period = periodOf(postedAt || new Date());
  await assertOpenPeriod(client, period);

  // Org slicing for branch/sector reporting: default to the actor's
  // primary organisation so every entry is attributable going forward.
  let entryOrg = orgId;
  const actorUserId = req?.user?.id ?? null;
  if (!entryOrg && actorUserId) {
    const m = await client.query(
      `SELECT org_id FROM organisation_members
       WHERE user_id = $1 AND is_primary AND status = 'active' LIMIT 1`,
      [actorUserId]
    );
    entryOrg = m.rows[0]?.org_id ?? null;
  }

  // Idempotency: a replay returns the original entry, no duplicate.
  if (transactionId) {
    const dup = await client.query('SELECT id, entry_no FROM journal_entries WHERE source_transaction_id = $1', [
      transactionId,
    ]);
    if (dup.rows[0]) return { ...dup.rows[0], duplicate: true };
  }

  const h = await client.query(
    `INSERT INTO journal_entries
       (period, source_type, source_transaction_id, currency, org_id,
        actor_id, actor_role, channel, narration, reversal_of, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, NOW()))
     RETURNING id, entry_no`,
    [
      period, type, transactionId, 'NGN', entryOrg,
      req?.user?.id ?? null, req?.user?.role ?? null,
      channel || (req?.user ? 'web' : 'system'),
      reference ? `${type} ${reference}` : type, reversalOf || null, postedAt || null,
    ]
  );
  const entryId = h.rows[0].id;
  for (const l of legs) {
    await client.query(
      'INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4)',
      [entryId, l.accountId, l.dr, l.cr]
    );
  }
  return { ...h.rows[0], duplicate: false };
}

// Linked reversal of a posted entry (for corrections via maker-checker).
// Flips every leg; original stays immutable.
export async function reverseJournal(client, req, entryNo, reason) {
  const head = await client.query('SELECT id, source_type, reversal_of FROM journal_entries WHERE entry_no = $1', [
    entryNo,
  ]);
  if (!head.rows[0]) throw new Error('Original entry not found');
  if (head.rows[0].reversal_of) throw new Error('Entry is itself a reversal');
  const already = await client.query('SELECT id FROM journal_entries WHERE reversal_of = $1', [head.rows[0].id]);
  if (already.rows[0]) throw new Error('Entry already reversed');
  const orig = await client.query(
    `SELECT l.account_id, a.code, l.debit, l.credit
     FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.entry_id = $1`,
    [head.rows[0].id]
  );
  return postJournal(client, req, {
    type: `reversal:${head.rows[0].source_type}`,
    reference: `${entryNo} (${reason || 'correction'})`,
    reversalOf: head.rows[0].id,
    lines: orig.rows.map((l) => ({ code: l.code, debit: Number(l.credit), credit: Number(l.debit) })),
  });
}

// Trial balance: every account with total debits/credits. Must net to zero.
export async function trialBalance() {
  const { rows } = await query(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
     GROUP BY a.code, a.name, a.type ORDER BY a.code`
  );
  return rows;
}

// D2 surplus: income minus expenses for a YYYY-MM journal period.
// The dividend policy cap is computed from this — declarations cannot
// exceed surplus × payout ratio.
export const DEFAULT_PAYOUT_RATIO = 0.6;

export async function surplusForMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    const err = new Error('Month must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  const { rows } = await query(
    `SELECT a.type, COALESCE(SUM(l.credit - l.debit),0) AS net
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.period = $1 AND a.type IN ('income','expense')
     GROUP BY a.type`,
    [month]
  );
  let income = 0;
  let expenses = 0;
  for (const r of rows) {
    if (r.type === 'income') income = Number(r.net);
    else expenses = -Number(r.net);
  }
  return { month, income, expenses, surplus: income - expenses };
}

// L5 profit & loss for a YYYY-MM journal period (per-account detail).
export async function profitAndLoss(month) {
  const s = await surplusForMonth(month); // validates YYYY-MM
  const { rows } = await query(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.credit - l.debit),0) AS net
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = l.account_id
     WHERE e.period = $1 AND a.type IN ('income','expense')
     GROUP BY a.code, a.name, a.type ORDER BY a.code`,
    [month]
  );
  const income = rows.filter((r) => r.type === 'income').map((r) => ({ code: r.code, name: r.name, amount: Number(r.net) }));
  const expenses = rows.filter((r) => r.type === 'expense').map((r) => ({ code: r.code, name: r.name, amount: -Number(r.net) }));
  return { ...s, income, expenses };
}

// L5 balance sheet: cumulative balances by class (point-in-time).
export async function balanceSheet() {
  const { rows } = await query(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit - l.credit),0) AS debitbal,
            COALESCE(SUM(l.credit - l.debit),0) AS creditbal
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
     GROUP BY a.code, a.name, a.type ORDER BY a.code`
  );
  const bal = (r) => (['asset', 'expense'].includes(r.type) ? Number(r.debitbal) : Number(r.creditbal));
  const groups = { asset: [], liability: [], equity: [] };
  for (const r of rows) {
    if (groups[r.type]) groups[r.type].push({ code: r.code, name: r.name, balance: bal(r) });
  }
  const sum = (xs) => xs.reduce((s, x) => s + x.balance, 0);
  return {
    asOf: new Date().toISOString(),
    assets: groups.asset, liabilities: groups.liability, equity: groups.equity,
    totalAssets: sum(groups.asset),
    totalLiabEquity: sum(groups.liability) + sum(groups.equity),
  };
}
