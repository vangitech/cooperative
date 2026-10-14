import { query } from '../db.js';
import { periodOf } from './ledger.js';

// L3 reconciliation engine. Compares independent sources of truth and files
// every mismatch as a suspense item — books are NEVER auto-adjusted.
//   internal: trial balance nets zero · wallets == control 1100 ·
//             no negative receivable/payable/float balances
//   external: settlement floats (1001/1002/…) vs submitted provider
//             statement balances [{ code, balance }]
// Passing checks auto-clear matching open suspense items.
export async function runReconciliation(client, { actorId = null, channel = 'web', statements = [] } = {}) {
  const period = periodOf();
  const checks = [];
  const fail = (kind, label, expected, actual, detail = null) => {
    checks.push({ kind, label, passed: false, expected, actual, detail });
  };
  const pass = (kind, label, expected, actual) => {
    checks.push({ kind, label, passed: true, expected, actual });
  };

  // 1. Trial balance nets to zero.
  const tb = await client.query(
    'SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM journal_lines'
  );
  const dr = Number(tb.rows[0].dr);
  const cr = Number(tb.rows[0].cr);
  if (Math.abs(dr - cr) < 0.005) pass('trial_balance', 'Debits equal credits', dr, cr);
  else fail('trial_balance', 'Debits equal credits', dr, cr, { dr, cr });

  // 2. Member wallets tie to the control account.
  const w = await client.query('SELECT COALESCE(SUM(balance),0) AS s FROM wallets');
  const c = await client.query(
    `SELECT COALESCE(SUM(l.credit) - SUM(l.debit),0) AS s
     FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100'`
  );
  const wallets = Number(w.rows[0].s);
  const control = Number(c.rows[0].s);
  if (Math.abs(wallets - control) < 0.005) pass('wallets_control', 'Wallets tie to control 1100', wallets, control);
  else fail('wallets_control', 'Wallets tie to control 1100', control, wallets, { wallets, control });

  // 3. No negative asset/receivable/float balances (payables live on the credit side).
  const neg = await client.query(
    `SELECT a.code, COALESCE(SUM(l.debit) - SUM(l.credit),0) AS bal
     FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
     WHERE a.type IN ('asset') AND a.code NOT IN ('1100')
     GROUP BY a.code HAVING COALESCE(SUM(l.debit) - SUM(l.credit),0) < -0.005`
  );
  if (!neg.rows.length) pass('no_negative_assets', 'No negative asset balances', 0, 0);
  else {
    for (const n of neg.rows) {
      fail(`negative_asset:${n.code}`, `Account ${n.code} not negative`, 0, Number(n.bal), { code: n.code });
    }
  }

  // 4. Settlement floats vs provider statements (only for submitted accounts).
  const stmtMap = new Map((statements || []).map((s) => [s.code, Number(s.balance)]));
  if (stmtMap.size) {
    for (const [code, stmtBal] of stmtMap) {
      if (!(stmtBal >= 0)) continue;
      const f = await client.query(
        `SELECT COALESCE(SUM(l.debit) - SUM(l.credit),0) AS s
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = $1`,
        [code]
      );
      const float = Number(f.rows[0].s);
      if (Math.abs(float - stmtBal) < 0.005) pass(`float:${code}`, `Float ${code} matches statement`, stmtBal, float);
      else fail(`float:${code}`, `Float ${code} matches statement`, stmtBal, float, { ledger: float, statement: stmtBal });
    }
  }

  // 5. Per-member proof: every wallet must equal its implied transaction
  // history. This is what guarantees every member exists correctly in the
  // books — any drift (deleted rows, manual edits, missed postings) files here.
  const IN_TYPES = ['deposit', 'savings', 'dividend', 'loan_disbursement', 'fixed_maturity', 'refund', 'fixed_break', 'transfer_in'];
  const OUT_TYPES = ['withdrawal', 'loan_repayment', 'fixed_deposit', 'transfer_out', 'collection_repayment', 'collection_down'];
  const ALL_TYPES = [...IN_TYPES, ...OUT_TYPES];
  const members = await client.query(
    `SELECT u.id, u.email, COALESCE(w.balance,0) AS wallet,
            COALESCE(SUM(CASE WHEN t.type IN (${IN_TYPES.map((_, i) => `$${i + 1}`).join(',')}) THEN t.amount
                              WHEN t.type IN (${OUT_TYPES.map((_, i) => `$${IN_TYPES.length + i + 1}`).join(',')}) THEN -t.amount
                              ELSE 0 END),0) AS implied,
            COALESCE(array_agg(DISTINCT t.type) FILTER (WHERE t.type NOT IN (${ALL_TYPES.map((_, i) => `$${IN_TYPES.length + OUT_TYPES.length + i + 1}`).join(',')})), '{}') AS unknown_types
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     LEFT JOIN transactions t ON t.user_id = u.id
     GROUP BY u.id, u.email, w.balance`,
    [...IN_TYPES, ...OUT_TYPES, ...ALL_TYPES]
  );
  for (const mrow of members.rows) {
    const wallet = Number(mrow.wallet);
    const implied = Number(mrow.implied);
    if (mrow.unknown_types.length) {
      fail(`member_unknown_tx#${mrow.id}`, `Member #${mrow.id} has no unmapped movements`,
        0, mrow.unknown_types.length, { user_id: mrow.id, email: mrow.email, types: mrow.unknown_types });
    } else if (Math.abs(wallet - implied) > 0.005) {
      fail(`member_drift#${mrow.id}`, `Member #${mrow.id} wallet ties to history`,
        implied, wallet, { user_id: mrow.id, email: mrow.email });
    } else {
      pass(`member_drift#${mrow.id}`, `Member #${mrow.id} wallet ties to history`, implied, wallet);
    }
  }

  const passed = checks.every((c) => c.passed);
  const run = await client.query(
    `INSERT INTO reconciliation_runs (run_by, channel, checks, passed)
     VALUES ($1,$2,$3,$4) RETURNING id, run_at`,
    [actorId, channel, JSON.stringify(checks), passed]
  );

  // Suspense queue: raise/update open items for failures, auto-clear passes.
  for (const chk of checks) {
    if (!chk.passed) {
      const open = await client.query(
        `SELECT id FROM suspense_items WHERE kind = $1 AND COALESCE(period,'') = COALESCE($2,'') AND status = 'open'`,
        [chk.kind, period]
      );
      if (open.rows[0]) {
        await client.query(
          `UPDATE suspense_items SET expected = $1, actual = $2, detail = $3 WHERE id = $4`,
          [chk.expected ?? 0, chk.actual ?? 0, chk.detail ? JSON.stringify(chk.detail) : null, open.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO suspense_items (kind, period, expected, actual, detail)
           VALUES ($1,$2,$3,$4,$5)`,
          [chk.kind, period, chk.expected ?? 0, chk.actual ?? 0, chk.detail ? JSON.stringify(chk.detail) : null]
        );
      }
    } else {
      await client.query(
        `UPDATE suspense_items SET status = 'resolved', resolution = 'auto-cleared on re-run',
          resolved_at = NOW() WHERE kind = $1 AND COALESCE(period,'') = COALESCE($2,'') AND status = 'open'`,
        [chk.kind, period]
      );
    }
  }

  return { runId: run.rows[0].id, runAt: run.rows[0].run_at, passed, checks };
}

export async function suspenseList(status) {
  const params = [];
  let where = '';
  if (status === 'open' || status === 'resolved') {
    params.push(status);
    where = 'WHERE s.status = $1';
  }
  const { rows } = await query(
    `SELECT s.*, u.email AS resolved_by_email FROM suspense_items s
     LEFT JOIN users u ON u.id = s.resolved_by
     ${where} ORDER BY s.created_at DESC LIMIT 200`,
    params
  );
  return rows;
}
