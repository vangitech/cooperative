# Audit Trail Upgrade — Updatedone v1

Tracks implementation of `update v1.md`. Mark items done with date + commit.

| # | Item | Status | Date | Commit | Notes |
|---|------|--------|------|--------|-------|
| 1 | Append-only hardening + richer columns | ✅ done | 2026-10-13 | — | Columns live; anon UPDATE/DELETE/INSERT denied (42501); helper auto-captures role+UA+outcome, scrubs secrets; auth routes pass role; role/outcome in report + Activity UI |
| 2 | Money-event audits inside DB transaction | ✅ done | 2026-10-13 | — | auditTx() helper; 14 money paths atomic (savings, deposit, withdraw, transfer, repay, fixed lock/claim/break, store repay/review, loan approve/reject, dividends, fund, webhooks, plans, auto-debit); rollback proven orphan-free |
| 3 | Failure + config-change logging | ✅ done | 2026-10-13 | — | login failures, 403 denials, fund/transfer/webhook failures, export downloads, product config before/after — all live-verified |
| 4 | Hash-chain tamper evidence | ⬜ pending | — | — | — |

Legend: ⬜ pending · 🟡 in progress · ✅ done
