import { toMoney } from '../utils/helpers.js';

// Outstanding across principal + accrued late penalties.
export const loanOutstanding = (loan) =>
  toMoney(Number(loan.total_repayable) + Number(loan.penalty_accrued || 0) - Number(loan.amount_paid));

// Product rate for a loan (falls back to legacy 10% flat / 5% penalty).
export async function loanProduct(client, loan) {
  if (!loan.product_id) return { interest_rate: 10, penalty_rate: 5 };
  const { rows } = await client.query('SELECT interest_rate, penalty_rate FROM loan_products WHERE id = $1', [
    loan.product_id,
  ]);
  return rows[0] || { interest_rate: 10, penalty_rate: 5 };
}

// Build the monthly repayment schedule once (at disbursement). Last
// installment absorbs rounding. No-op if schedules already exist.
export async function ensureSchedules(client, loan, startFrom) {
  const existing = await client.query('SELECT COUNT(*) FROM loan_schedules WHERE loan_id = $1', [loan.id]);
  if (Number(existing.rows[0].count) > 0) return;

  const n = Number(loan.duration_months);
  const total = Number(loan.total_repayable);
  const base = toMoney(total / n);
  const start = new Date(startFrom || loan.reviewed_at || loan.created_at || Date.now());

  let assigned = 0;
  for (let i = 1; i <= n; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    const amount = i === n ? toMoney(total - assigned) : base;
    assigned = toMoney(assigned + amount);
    await client.query(
      `INSERT INTO loan_schedules (loan_id, due_number, due_date, amount_due)
       VALUES ($1,$2,$3,$4)`,
      [loan.id, i, due.toISOString().slice(0, 10), amount]
    );
  }
}

// One-time late penalty per overdue schedule: penalty_rate % of the
// unpaid installment. Accrues into loans.penalty_accrued. Idempotent.
export async function assessPenalties(client, loan) {
  const product = await loanProduct(client, loan);
  const rate = Number(product.penalty_rate || 0);
  if (!rate) return 0;

  const { rows } = await client.query(
    `SELECT * FROM loan_schedules
     WHERE loan_id = $1 AND due_date < CURRENT_DATE
       AND amount_paid < amount_due AND penalty_applied = false
     ORDER BY due_number`,
    [loan.id]
  );
  let added = 0;
  for (const s of rows) {
    const unpaid = toMoney(Number(s.amount_due) - Number(s.amount_paid));
    const penalty = toMoney((unpaid * rate) / 100);
    if (penalty > 0) {
      await client.query('UPDATE loan_schedules SET penalty_applied = true WHERE id = $1', [s.id]);
      added = toMoney(added + penalty);
    }
  }
  if (added > 0) {
    await client.query('UPDATE loans SET penalty_accrued = penalty_accrued + $1 WHERE id = $2', [added, loan.id]);
    loan.penalty_accrued = toMoney(Number(loan.penalty_accrued || 0) + added);
  }
  return added;
}

// Spread a repayment across the oldest unpaid schedule entries first.
export async function allocateRepayment(client, loanId, amount) {
  let left = toMoney(amount);
  const { rows } = await client.query(
    `SELECT * FROM loan_schedules WHERE loan_id = $1 AND amount_paid < amount_due
     ORDER BY due_number FOR UPDATE`,
    [loanId]
  );
  for (const s of rows) {
    if (left <= 0) break;
    const owed = toMoney(Number(s.amount_due) - Number(s.amount_paid));
    const pay = Math.min(owed, left);
    await client.query('UPDATE loan_schedules SET amount_paid = amount_paid + $1 WHERE id = $2', [pay, s.id]);
    left = toMoney(left - pay);
  }
  return toMoney(amount - left);
}
