import { toMoney, generateRef } from '../utils/helpers.js';

// Outstanding across financed total + accrued late penalties.
export const collectionOutstanding = (c) =>
  toMoney(Number(c.total_repayable) + Number(c.penalty_accrued || 0) - Number(c.amount_paid));

// Monthly schedule built at collection (approval). Last row absorbs rounding.
export async function ensureCollectionSchedules(client, collection) {
  const existing = await client.query('SELECT COUNT(*) FROM collection_schedules WHERE collection_id = $1', [
    collection.id,
  ]);
  if (Number(existing.rows[0].count) > 0) return;

  const n = Number(collection.duration_months);
  const total = toMoney(Number(collection.total_repayable) - Number(collection.down_payment));
  const base = toMoney(total / n);
  const start = new Date(collection.reviewed_at || collection.created_at || Date.now());

  let assigned = 0;
  for (let i = 1; i <= n; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    const amount = i === n ? toMoney(total - assigned) : base;
    assigned = toMoney(assigned + amount);
    await client.query(
      `INSERT INTO collection_schedules (collection_id, due_number, due_date, amount_due)
       VALUES ($1,$2,$3,$4)`,
      [collection.id, i, due.toISOString().slice(0, 10), amount]
    );
  }
}

// One-time late penalty per overdue schedule row. Idempotent.
export async function assessCollectionPenalties(client, collection) {
  const rate = Number(collection.penalty_rate || 0);
  if (!rate) return 0;

  const { rows } = await client.query(
    `SELECT * FROM collection_schedules
     WHERE collection_id = $1 AND due_date < CURRENT_DATE
       AND amount_paid < amount_due AND penalty_applied = false
     ORDER BY due_number`,
    [collection.id]
  );
  let added = 0;
  for (const s of rows) {
    const unpaid = toMoney(Number(s.amount_due) - Number(s.amount_paid));
    const penalty = toMoney((unpaid * rate) / 100);
    if (penalty > 0) {
      await client.query('UPDATE collection_schedules SET penalty_applied = true WHERE id = $1', [s.id]);
      added = toMoney(added + penalty);
    }
  }
  if (added > 0) {
    await client.query('UPDATE collections SET penalty_accrued = penalty_accrued + $1 WHERE id = $2', [
      added, collection.id,
    ]);
    collection.penalty_accrued = toMoney(Number(collection.penalty_accrued || 0) + added);
  }
  return added;
}

// Oldest-unpaid-first allocation within one collection.
export async function allocateCollectionPayment(client, collectionId, amount) {
  let left = toMoney(amount);
  const { rows } = await client.query(
    `SELECT * FROM collection_schedules WHERE collection_id = $1 AND amount_paid < amount_due
     ORDER BY due_number FOR UPDATE`,
    [collectionId]
  );
  for (const s of rows) {
    if (left <= 0) break;
    const owed = toMoney(Number(s.amount_due) - Number(s.amount_paid));
    const pay = Math.min(owed, left);
    await client.query('UPDATE collection_schedules SET amount_paid = amount_paid + $1 WHERE id = $2', [pay, s.id]);
    left = toMoney(left - pay);
  }
  return toMoney(amount - left);
}

// Direct-debit sweep: whenever money lands in the wallet, settle due
// collection installments first (oldest collection first) — but only for
// plans with auto_debit consent. Best-effort: never throws.
export async function settleDueCollections(withTransaction, userId) {
  try {
    await withTransaction(async (client) => {
      const due = await client.query(
        `SELECT c.* FROM collections c
         WHERE c.user_id = $1 AND c.status = 'collected' AND c.auto_debit = true
         ORDER BY c.created_at FOR UPDATE`,
        [userId]
      );
      for (const row of due.rows) {
        const fresh = await client.query('SELECT * FROM collections WHERE id = $1', [row.id]);
        const c = fresh.rows[0];
        await assessCollectionPenalties(client, c);

        // Only take what is actually due now (overdue installments +
        // accrued penalties) — future installments stay in the wallet.
        const dueNow = await client.query(
          `SELECT COALESCE(SUM(amount_due - amount_paid),0) AS due
           FROM collection_schedules
           WHERE collection_id = $1 AND due_date <= CURRENT_DATE AND amount_paid < amount_due`,
          [c.id]
        );
        const owing = toMoney(Number(dueNow.rows[0].due) + Number(c.penalty_accrued || 0));
        if (owing <= 0) continue;

        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
        const balance = Number(w.rows[0]?.balance || 0);
        if (balance <= 0) break;
        const pay = toMoney(Math.min(balance, owing));

        const newBalance = toMoney(balance - pay);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
          newBalance, w.rows[0].id,
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'collection_repayment',$3,$4,$5,$6)`,
          [userId, w.rows[0].id, pay, newBalance, generateRef('CLP'), `Auto-debit: collection #${c.id}`]
        );
        await allocateCollectionPayment(client, c.id, pay);

        const newPaid = toMoney(Number(c.amount_paid) + pay);
        const left = toMoney(Number(c.total_repayable) + Number(c.penalty_accrued || 0) - newPaid);
        await client.query('UPDATE collections SET amount_paid = $1, status = $2 WHERE id = $3', [
          newPaid, left <= 0 ? 'completed' : 'collected', c.id,
        ]);
      }
    });
  } catch (e) {
    console.error('collection sweep failed:', e.message);
  }
}
