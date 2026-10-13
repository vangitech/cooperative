# Audit Trail Upgrade — Update v1

Goal: make the cooperative's audit trail immutable, tamper-evident and
regulator-exportable.

> Done and moved to `updatedone v1.md`: Priority 1 (append-only + columns),
> Priority 2 (transactional money audits), Priority 3 (failure/config/export
> logging).

## Priority 4 — Hash-chain tamper evidence
- Each row stores `row_hash = sha256(prev_hash + payload)`; verify endpoint/job.
- Acceptance: editing any historical row breaks the chain detectably.

---

# Ledger Todo — Double-Entry Financial Ledger

Goal: transparent, regulator-grade books — a double-entry journal layer under
the existing wallet ledger. Members see no change; accountants gain real
financial statements. Own ledger stays the system of record; bank/MFB CBS
connections are settlement rails, not replacements.

> Done and moved to `updatedone v1.md`: L1 (chart + journals core, live),
> L2 (posting templates, maker-checker, period locks, live), Migration
> (history backfilled + disclosed ₦1,500 opening adjustment).

## L3 — Reconciliation engine + suspense
- Nightly internal check (Σ wallets = control account; Σ debits = Σ credits) and external check (settlement float = provider statement).
- Mismatches → suspense queue for accountants, never auto-adjusted.
- Acceptance: drift detected within 24h with an actionable queue.

## L4 — Provider adapters (CBS/MFB/bank connectivity)
- One adapter interface (`initiate, verify, parseWebhook, fetchStatement`); Flutterwave becomes adapter #1, MFB/CBS adapter #2 on their API docs.
- One settlement-float account per provider; reserve-first debit, idempotent confirm/refund.
- Acceptance: new rail plugs in with zero ledger changes.

## L5 — Financial statements in the reports pack
- Trial balance, P&L, balance sheet (plus existing 7 reports), org/branch slicing.
- Acceptance: trial balance zeroes; wallet sums match control account at go-live.

---

# Dividends Todo — Surplus-Backed, Pro-Rata, Approved

Goal: dividends paid out of real computed surplus, shared fairly by
contribution, under maker-checker control. Kills the current flaws: unbacked
declarations, equal-split unfairness, single-actor declare-and-pay, double
declaration of a period.

## D1 — Guards on the current flow (small, no schema drama)
- `UNIQUE(period, user_id)` on `dividends`; idempotent declare per period.
- New `approved` status + approver columns: `proposed → approved → paid`.
- Accountant proposes, admin approves, batch-pay whole period atomically.
- Acceptance: same period can't pay twice; no half-paid periods; single actor can't declare-and-pay.

## D2 — Surplus computation + policy cap (needs ledger L1/L2)
- Surplus(period) = interest + fees + penalties + markup − expenses − provisions, straight from journal income/expense accounts.
- Enforce: total declared ≤ surplus × payout ratio (e.g. 60% members / 40% statutory + general reserves).
- Acceptance: over-surplus declaration rejected in code, not convention.

## D3 — Pro-rata engine + shares path
- Basis per declaration: `savings` (member balance ÷ total savings × pool); keep `equal` as explicit override only.
- Later: `shares` module for classic share-capital coops.
- Member-facing projected share for the open period (savings incentive loop).
- Acceptance: payout matches contribution share to the kobo; projection visible.

## D4 — Lifecycle hygiene
- Pending/unclaimed follow-up report after X days; reversal path for erroneous declarations (linked entries, never edits).
- Acceptance: no dividend row sits unexplained; errors correctable with trail.

---

# Appendix — Original Product Feedback (preserved)

# MPCS Project Feedback — Update v1

Product-level analysis of the multi-purpose cooperative society app
(frontend + backend reviewed end-to-end).

## Where we stand

A solid **ledger core** is in place: auth, wallet, savings deposits,
loan apply → approve → disburse → repay, dividends declare → pay, and a
full admin console. Money math is race-safe (DB transactions + row
locks) and roles are enforced. What is missing falls into three tiers.

## Tier 1 — Trust-critical (before real members)

1. **Real money movement.** Deposit/withdraw currently just edit numbers
   in Postgres. Integrate **Paystack or Flutterwave** (Node SDKs +
   webhooks): funding via bank transfer/card, withdrawals to bank
   accounts, webhook-verified before crediting. Without this, every
   balance is fictional.
2. **Forgot/reset password.** Register + login + change-password exist,
   but there is no recovery flow. First forgotten password becomes a
   support ticket that can only be resolved by hand-editing a hash.
3. **Member approval + basic KYC.** Anyone who registers is instantly
   `active` with full access. Real cooperatives admit members:
   application → admin approval → membership fee/share purchase. Minimum:
   new signups default to `pending`, admin approves, plus phone
   verification — later BVN/NIN + guarantor details.
4. **Audit trail.** Admins can approve loans, suspend users, and pay out
   money — none of it is logged. A simple
   `audit_logs(admin_id, action, entity, entity_id, metadata)` table +
   middleware turns "who moved this money?" from impossible to trivial.
   Non-negotiable for a financial org.

## Tier 2 — Core cooperative mechanics

5. **Configurable loan products.** The 10% flat rate is hardcoded —
   changing it needs a code deploy. Loan types table (e.g. emergency
   5%/30 days, business 10%/6 months), eligibility rules (must have
   saved ≥ 30% of requested amount, minimum membership months),
   guarantor requirement (1–2 existing members vouch).
6. **Repayment schedules + penalties.** Currently "pay any amount
   anytime." Members expect an EMI schedule (monthly due dates, amounts)
   and late fees. This also makes the loan book auditable.
7. **Interest-bearing savings / fixed deposits.** Savings currently earn
   nothing. Fixed deposit with tenure + rate and automatic maturity
   payout is the classic reason members keep money in a coop instead of
   a bank.
8. **Statements & exports.** Members cannot download a transaction
   statement; admins cannot export books to CSV/PDF. Needed for member
   trust and treasurer audits. The `transactions` table already has
   everything required — mostly a presentational feature.
9. **Notifications.** The Sonner Toaster exists but nothing feeds it from
   outside the page. Loan approved, dividend paid, repayment due — via
   in-app notification center first, then SMS (Termii / Africa's Talking)
   for money events.

## Tier 3 — Growth

10. **Member-to-member transfers** (wallet-to-wallet by email/phone/wallet account number).
11. **Announcements board** (AGM notices, dividend declarations —
    cooperatives run on meetings).
12. **Finer admin roles** — loan officer vs. accountant vs. super-admin,
    instead of one all-powerful `admin`.
13. **Recurring auto-deduction** for monthly savings (needs Tier 1
    payments first).

## Suggested order

Payments (#1) → approval/KYC (#3) → audit trail (#4) → forgot-password
(#2, quick win) → loan products (#5). That sequence turns a well-built
demo ledger into something that can hold real members' money.
