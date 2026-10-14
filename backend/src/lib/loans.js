import { toMoney, generateRef } from '../utils/helpers.js';
import { auditTx, systemReq, SYSTEM_CHANNEL } from './audit.js';
import { postJournal } from './ledger.js';

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

// Receipt split across principal / interest / penalty pro-rata
// (exact in aggregate on full repayment; the caller absorbs rounding on the
// last leg). Shared by manual repayments and the auto-debit sweep so both
// post identical journal legs.
export function repaymentSplit(loan, amt) {
  const pBase = Number(loan.amount);
  const iBase = Math.max(0, Number(loan.total_repayable) - pBase);
  const fBase = Number(loan.penalty_accrued || 0);
  const base = pBase + iBase + fBase;
  let principal = base > 0 ? toMoney((amt * pBase) / base) : amt;
  let interest = base > 0 ? toMoney((amt * iBase) / base) : 0;
  let penalty = toMoney(amt - principal - interest);
  if (penalty < 0) {
    interest = toMoney(interest + penalty); // absorb sub-kobo rounding
    penalty = 0;
  }
  if (interest < 0) {
    principal = toMoney(principal + interest);
    interest = 0;
  }
  return { principal, interest, penalty };
}

// Build the monthly repayment schedule once (at disbursement), splitting
// every installment into principal_due / interest_due pro-rata. Last
// installment absorbs rounding on both legs. No-op if schedules exist.
export async function ensureSchedules(client, loan, startFrom) {
  const existing = await client.query('SELECT COUNT(*) FROM loan_schedules WHERE loan_id = $1', [loan.id]);
  if (Number(existing.rows[0].count) > 0) return;

  const n = Number(loan.duration_months);
  const total = Number(loan.total_repayable);
  const principal = Number(loan.amount);
  const base = toMoney(total / n);
  const start = new Date(startFrom || loan.reviewed_at || loan.created_at || Date.now());

  let assigned = 0;
  let assignedP = 0;
  for (let i = 1; i <= n; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    const amount = i === n ? toMoney(total - assigned) : base;
    assigned = toMoney(assigned + amount);
    // Principal leg pro-rata; interest is the remainder so both legs always
    // sum exactly to amount_due on every row.
    const pDue = i === n ? toMoney(principal - assignedP) : toMoney((amount * principal) / total);
    assignedP = toMoney(assignedP + pDue);
    await client.query(
      `INSERT INTO loan_schedules (loan_id, due_number, due_date, amount_due, principal_due, interest_due)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [loan.id, i, due.toISOString().slice(0, 10), amount, pDue, toMoney(amount - pDue)]
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

// Spread a repayment across the oldest unpaid schedule entries first,
// splitting each row's share pro-rata across its principal/interest legs
// (same math as the journal split, so books and schedule agree).
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
    const pLeft = toMoney(Number(s.principal_due) - Number(s.principal_paid || 0));
    const iLeft = toMoney(Number(s.interest_due) - Number(s.interest_paid || 0));
    const legBase = toMoney(pLeft + iLeft);
    const pPay = legBase > 0 ? Math.min(pLeft, toMoney((pay * pLeft) / legBase)) : pay;
    const iPay = toMoney(pay - pPay);
    await client.query(
      `UPDATE loan_schedules SET amount_paid = amount_paid + $1,
        principal_paid = principal_paid + $2, interest_paid = interest_paid + $3 WHERE id = $4`,
      [pay, pPay, iPay, s.id]
    );
    left = toMoney(left - pay);
  }
  return toMoney(amount - left);
}

// Close-out: stamp closed_at + celebrate. Called by every payoff path once
// the loan flips to repaid. Idempotent.
export async function closeLoanIfPaid(client, req, loan) {
  if (loan.status !== 'repaid' || loan.closed_at) return false;
  await client.query('UPDATE loans SET closed_at = NOW() WHERE id = $1', [loan.id]);
  await auditTx(client, req || systemReq, 'loan.closed', 'loan', loan.id,
    { amount: Number(loan.amount), totalRepaid: Number(loan.amount_paid) },
    { before: { status: 'repaid', closed: false }, after: { closed: true },
      channel: (req && req.headers) ? 'web' : SYSTEM_CHANNEL });
  const { query } = await import('../db.js');
  await query(
    `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
    [loan.user_id, 'Loan fully repaid — closed out',
     `Congratulations! Loan #${loan.id} (${loan.amount}) is fully repaid and closed. Thank you for borrowing responsibly.`, '/loans']
  );
  return true;
}

// Direct-debit sweep: whenever money lands in the wallet, settle overdue
// loan installments first (oldest loan first) — but only for loans with
// auto_debit consent. Partial payment allowed (pays min(balance, due now)).
// Best-effort: never throws. Mirrors settleDueCollections.
export async function settleDueLoans(withTransaction, userId) {
  try {
    await withTransaction(async (client) => {
      const due = await client.query(
        `SELECT * FROM loans
         WHERE user_id = $1 AND status = 'disbursed' AND auto_debit = true
         ORDER BY created_at FOR UPDATE`,
        [userId]
      );
      for (const row of due.rows) {
        const fresh = await client.query('SELECT * FROM loans WHERE id = $1', [row.id]);
        const loan = fresh.rows[0];
        await ensureSchedules(client, loan);
        await assessPenalties(client, loan);

        // Only take what is actually due now (overdue installments +
        // accrued penalties) — future installments stay in the wallet.
        const dueNow = await client.query(
          `SELECT COALESCE(SUM(amount_due - amount_paid),0) AS due
           FROM loan_schedules
           WHERE loan_id = $1 AND due_date <= CURRENT_DATE AND amount_paid < amount_due`,
          [loan.id]
        );
        const owing = toMoney(Math.min(
          Number(dueNow.rows[0].due) + Number(loan.penalty_accrued || 0),
          loanOutstanding(loan)
        ));
        if (owing <= 0) continue;

        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
        const balance = Number(w.rows[0]?.balance || 0);
        if (balance <= 0) break;
        const pay = toMoney(Math.min(balance, owing));

        const newBalance = toMoney(balance - pay);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
          newBalance, w.rows[0].id,
        ]);
        const tx = await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'loan_repayment',$3,$4,$5,$6) RETURNING *`,
          [userId, w.rows[0].id, pay, newBalance, generateRef('LRP'), `Auto-debit: loan #${loan.id} repayment`]
        );
        const split = repaymentSplit(loan, pay);
        await postJournal(client, systemReq, { type: 'loan_repayment', transactionId: tx.rows[0].id,
          reference: tx.rows[0].reference, amount: pay,
          lines: [
            { code: '1100', debit: pay, credit: 0 },
            { code: '1200', debit: 0, credit: split.principal },
            { code: '4001', debit: 0, credit: split.interest },
            { code: '4002', debit: 0, credit: split.penalty },
          ].filter((l) => l.debit > 0 || l.credit > 0), channel: SYSTEM_CHANNEL });

        await allocateRepayment(client, loan.id, pay);
        const newPaid = toMoney(Number(loan.amount_paid) + pay);
        const finalOutstanding = toMoney(
          Number(loan.total_repayable) + Number(loan.penalty_accrued || 0) - newPaid
        );
        const newStatus = finalOutstanding <= 0 ? 'repaid' : 'disbursed';
        const updated = await client.query(
          'UPDATE loans SET amount_paid = $1, status = $2 WHERE id = $3 RETURNING *',
          [newPaid, newStatus, loan.id]
        );
        await client.query(
          `INSERT INTO loan_repayments (loan_id, user_id, amount, transaction_id) VALUES ($1,$2,$3,$4)`,
          [loan.id, userId, pay, tx.rows[0].id]
        );
        await auditTx(client, systemReq, 'loan.auto_debited', 'loan', loan.id,
          { amount: pay },
          { before: { status: loan.status, amount_paid: Number(loan.amount_paid), balance },
            after: { status: newStatus, amount_paid: newPaid, balance: newBalance },
            channel: SYSTEM_CHANNEL });
        if (newStatus === 'repaid') await closeLoanIfPaid(client, null, updated.rows[0]);
        else {
          const { query } = await import('../db.js');
          await query(
            `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
            [userId, 'Loan auto-debit', `${pay} NGN auto-debited towards loan #${loan.id}. Outstanding: ${finalOutstanding} NGN.`, '/loans']
          );
        }
      }
    });
  } catch (e) {
    console.error('loan sweep failed:', e.message);
  }
}
