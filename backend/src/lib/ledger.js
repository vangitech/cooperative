import { query } from '../db.js';

// L1 double-entry core. Every member-wallet movement posts one balanced
// header + two mirror lines (control ↔ settlement float):
//   wallet credited (money in)  → Dr Settlement Float / Cr Wallets Control
//   wallet debited (money out)  → Dr Wallets Control / Cr Settlement Float
// L2 adds earmark/income-split legs on top; this schema already supports
// N lines per entry, so no migration is needed for that.
//
// Must be called with the SAME client as the money movement (atomic).
// Idempotent: UNIQUE(source_transaction_id) means retries and webhook
// replays return the existing entry instead of double-posting.

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

export async function postJournal(client, req, {
  type, transactionId = null, reference = null, amount,
  direction, settlement = '1001', orgId = null, channel = null, postedAt = null,
}) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Journal amount must be positive');
  if (direction !== 'in' && direction !== 'out') throw new Error('Journal direction must be in|out');

  // Idempotency first: a replay returns the original entry, no duplicate.
  if (transactionId) {
    const dup = await client.query('SELECT id, entry_no FROM journal_entries WHERE source_transaction_id = $1', [
      transactionId,
    ]);
    if (dup.rows[0]) return { ...dup.rows[0], duplicate: true };
  }

  const debitCode = direction === 'in' ? settlement : CONTROL;
  const creditCode = direction === 'in' ? CONTROL : settlement;
  const [debitId, creditId] = await Promise.all([
    accountId(client, debitCode), accountId(client, creditCode),
  ]);

  // Invariant: legs must sum to zero or the whole money movement aborts.
  const legs = [
    { account: debitId, dr: amt, cr: 0 },
    { account: creditId, dr: 0, cr: amt },
  ];
  const dr = legs.reduce((s, l) => s + l.dr, 0);
  const cr = legs.reduce((s, l) => s + l.cr, 0);
  if (Math.abs(dr - cr) > 0.005) throw new Error('Unbalanced journal legs rejected');

  const h = await client.query(
    `INSERT INTO journal_entries
       (period, source_type, source_transaction_id, currency, org_id,
        actor_id, actor_role, channel, narration, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, NOW()))
     RETURNING id, entry_no`,
    [
      periodOf(postedAt || new Date()), type, transactionId, 'NGN', orgId,
      req?.user?.id ?? null, req?.user?.role ?? null,
      channel || (req?.user ? 'web' : 'system'),
      reference ? `${type} ${reference}` : type, postedAt || null,
    ]
  );
  const entryId = h.rows[0].id;
  await client.query(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,0), ($1,$4,0,$3)`,
    [entryId, debitId, amt, creditId]
  );
  return { ...h.rows[0], duplicate: false };
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
