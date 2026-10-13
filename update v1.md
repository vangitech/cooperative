# Audit Trail Upgrade — Update v1

Goal: make the cooperative's audit trail immutable, tamper-evident and
regulator-exportable.

## Priority 1 — Append-only hardening + richer columns
- `REVOKE UPDATE, DELETE ON audit_logs` from every human-held role (inserts only, by the app).
- Add columns: `actor_role` (role at time of action), `before` + `after`
  (JSONB state snapshots for money fields), `user_agent`, `channel`, `outcome`
  (success / failure).
- Acceptance: old rows cannot be edited; every new entry carries role + outcome.

## Priority 2 — Money-event audits inside the DB transaction
- Move audit writes for wallet/loan/dividend/fund flows into the same
  transaction as the money movement (guaranteed, never silently dropped).
- Keep fire-and-forget only for low-stakes events.
- Acceptance: crash/load test loses zero money-event entries.

## Priority 3 — Failure + config-change logging
- Log failed logins, permission denials, rejected payments.
- Log loan-product / rate / fee config changes (currently invisible).
- Log bulk export downloads (who pulled the member list / ledgers).
- Acceptance: red-team walkthrough shows attacker + treasurer traces.

## Priority 4 — Hash-chain tamper evidence
- Each row stores `row_hash = sha256(prev_hash + payload)`; verify endpoint/job.
- Acceptance: editing any historical row breaks the chain detectably.

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
