# Updatedone v1 — completed work tracker

Done items move here from `update v1.md` with date + commit. Pending work
stays in `update v1.md` (P4 hash-chain, L3–L5 ledger, D1–D4 dividends).

## Audit Trail Upgrade

| # | Item | Status | Date | Commit | Notes |
|---|------|--------|------|--------|-------|
| P1 | Append-only hardening + richer columns | ✅ done | 2026-10-13 | b7b9706 | Columns live; anon UPDATE/DELETE/INSERT denied (42501); helper auto-captures role+UA+outcome, scrubs secrets; auth routes pass role; role/outcome in report + Activity UI |
| P2 | Money-event audits inside DB transaction | ✅ done | 2026-10-13 | b7b9706 | auditTx() helper; 14 money paths atomic; rollback proven orphan-free |
| P3 | Failure + config-change logging | ✅ done | 2026-10-13 | b7b9706 | login failures, 403 denials, fund/transfer/webhook failures, export downloads, product config before/after — all live-verified |

## Double-Entry Ledger

| # | Item | Status | Date | Commit | Notes |
|---|------|--------|------|--------|-------|
| L1 | Chart of accounts + journals core | ✅ done | 2026-10-13 | a933089 | 13 seeded accounts; postJournal() atomic on all money paths; UNIQUE source guard; history backfilled (16 entries) + disclosed ₦1,500 opening adjustment (JE-100034); trial balance zero, control ties wallets |
| L2 | Posting templates + maker-checker + locks | ✅ done | 2026-10-13 | e5117f0 | True economic legs (receivables, payables, income splits, distributions); adjustments propose→approve API; period locks; linked reversals; all live-tested incl. self-approve denial |
| L3 | Reconciliation engine + suspense | ✅ done | 2026-10-14 | 4d30b08 | Trial-balance/wallets-control/negative-guard/float-vs-statement checks; suspense upsert + auto-clear; manual resolve with note; Reconcile console; mismatch + auto-clear live-verified |
| L4 | Provider adapters (CBS/MFB/bank) | ✅ done | 2026-10-14 | df24c83 | Adapter interface + registry (flutterwave live, mfb stub with config contract); 8 call sites rewired; settlement per rail; legacy + :provider webhooks verified; inactive 1003 seeded |
| L5 | Financial statements + org slicing | ✅ done | 2026-10-14 | df24c83 | P&L/balance-sheet libs; trial-balance/P&L/BS in 10-report pack (JSON+CSV); org auto-tag on postings; BS balances (A=L+E); alias-fold bug caught by testing |

## Dividends

| # | Item | Status | Date | Commit | Notes |
|---|------|--------|------|--------|-------|
| D1 | Approve flow + batch pay + idempotency | ✅ done | 2026-10-14 | 4d30b08 | UNIQUE(period,user); proposed→approved→paid; admin-only approve; atomic pay-period; retry returns 409; pay-before-approve rejected — all live-verified |
| D2 | Surplus computation + policy cap | ✅ done | 2026-10-14 | 4d30b08 | surplusForMonth from journals; 60% default ratio; cap enforced both paths; surplus preview in console — live-verified |

Legend: ⬜ pending · 🟡 in progress · ✅ done

## Registration

| # | Item | Status | Date | Notes |
|---|------|--------|------|-------|
| R1 | Resolve `member_drift#3` deliberately | ✅ done | 2026-10-14 | Live-investigated: plan-run savings shared the `savings` inflow type (manual deposits credit, plan runs debit) + mis-recorded balance_after on tx #29. Split `savings_plan` outflow type (code + historic migrate), backfilled missing ₦500 top-up record-only (no funds moved, no journal — pre-backfill era absorbed by JE-100034), full recon passed, wallet untouched ₦12,000, item kept as resolved history with note |
| R3 | Gate money-out on verified email | ✅ done | 2026-10-14 | `users.email_verified`; staged self-register sets true, staff-assisted starts false; gates wallet withdraw + transfer + bank payout (403 + audit); actives grandfathered true on migrate; admin can mark verified (audited); surfaced in /auth/me + Members |

## Roles & Loan maker-checker

| # | Item | Status | Date | Notes |
|---|------|--------|------|-------|
| S1 | Super-admin sole full rights | ✅ done | 2026-10-14 | New `super_admin` role holds `*` + exclusive `staff.manage`; `admin` downgraded to operational perms (no role grants); role changes restricted to super-admin (last-super_admin protected); Staff console (`/admin/staff`); seed via `SUPERADMIN_EMAIL/PASSWORD` on migrate or `npm run make-superadmin -- <email> <pass>`; Wuse Market org seeded |
| L6 | Loan maker-checker grantor→officer→accountant | ✅ done | 2026-10-14 | Statuses pending→grantor_approved→kyc_verified→disbursed (+kyc_failed retry, rejected); grantor of borrower's org approves (super_admin override); officer re-runs FULL KYC live naming failed checks, messages grantor via 1:1 chat + notification, pushes to payment; accountant disburses only after push; separation of duties enforced (super_admin override logged); legacy single-step review retired (410); every stage in `loan_reviews` + audit + notifications |
