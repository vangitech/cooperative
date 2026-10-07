import { query, withTransaction } from '../db.js';
import { toMoney, generateRef } from '../utils/helpers.js';

// Next occurrence of a day-of-month (clamped to month length implicitly
// by rolling to the 1st when the day already passed this month).
export function nextRunDate(day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
  if (d <= now) d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Execute one plan: wallet → savings deposit. Returns 'paid' | 'skipped'.
// Skipped plans stay due (notified) until funds arrive.
export async function executePlan(client, plan) {
  const amt = toMoney(plan.amount);
  const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [plan.user_id]);
  if (!w.rows[0]) return 'skipped';
  if (Number(w.rows[0].balance) < amt) {
    await client.query(
      `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
      [plan.user_id, 'Recurring savings skipped', `Only ${w.rows[0].balance} available for your ${amt} plan. Top up to stay on track.`, '/savings']
    );
    return 'skipped';
  }

  const newBalance = toMoney(Number(w.rows[0].balance) - amt);
  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
    newBalance, plan.user_id,
  ]);
  const tx = await client.query(
    `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
     VALUES ($1,$2,'savings',$3,$4,$5,$6) RETURNING *`,
    [plan.user_id, w.rows[0].id, amt, newBalance, generateRef('SAV'), `Recurring savings (${plan.savings_type})`]
  );
  await client.query(
    `INSERT INTO savings (user_id, amount, savings_type, note, transaction_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [plan.user_id, amt, plan.savings_type, 'Recurring plan', tx.rows[0].id]
  );
  const next = new Date(plan.next_run);
  next.setMonth(next.getMonth() + 1);
  await client.query(
    `UPDATE savings_plans SET last_run = NOW(), next_run = $1 WHERE id = $2`,
    [next.toISOString().slice(0, 10), plan.id]
  );
  return 'paid';
}

// Run every due active plan. Safe to call from cron, admin action, or
// opportunistically after wallet funding. Never throws.
export async function runDuePlans() {
  try {
    const due = await query(
      `SELECT * FROM savings_plans WHERE status = 'active' AND next_run <= CURRENT_DATE ORDER BY next_run`
    );
    const results = { paid: 0, skipped: 0 };
    for (const plan of due.rows) {
      try {
        const outcome = await withTransaction((client) => executePlan(client, plan));
        results[outcome === 'paid' ? 'paid' : 'skipped'] += 1;
      } catch (e) {
        console.error(`plan ${plan.id} failed:`, e.message);
      }
    }
    return results;
  } catch (e) {
    console.error('runDuePlans failed:', e.message);
    return { paid: 0, skipped: 0 };
  }
}
