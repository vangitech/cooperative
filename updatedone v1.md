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
| L3 | Reconciliation engine + suspense | ✅ done | 2026-10-14 | — | Trial-balance/wallets-control/negative-guard/float-vs-statement checks; suspense upsert + auto-clear; manual resolve with note; Reconcile console; mismatch + auto-clear live-verified |

## Dividends

| # | Item | Status | Date | Commit | Notes |
|---|------|--------|------|--------|-------|
| D1 | Approve flow + batch pay + idempotency | ✅ done | 2026-10-14 | — | UNIQUE(period,user); proposed→approved→paid; admin-only approve; atomic pay-period; retry returns 409; pay-before-approve rejected — all live-verified |
| D2 | Surplus computation + policy cap | ✅ done | 2026-10-14 | — | surplusForMonth from journals; 60% default ratio; cap enforced both paths; surplus preview in console — live-verified |

Legend: ⬜ pending · 🟡 in progress · ✅ done
