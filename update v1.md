# Pending Work — Update v1

> Done items live in `updatedone v1.md` with date + commit. This file is
> pending work only: P4 (audit hash-chain) · D3/D4 (dividend specs,
> implementation pending) · A1–A5 (audit gaps) · G1–G10 (ledger 2026 gaps).

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

# Dividends Todo — Surplus-Backed, Pro-Rata, Approved

Goal: dividends paid out of real computed surplus, shared fairly by
contribution, under maker-checker control. Kills the current flaws: unbacked
declarations, equal-split unfairness, single-actor declare-and-pay, double
declaration of a period.

> Done and moved to `updatedone v1.md`: D1 (approve flow + batch pay, live),
> D2 (surplus computation + policy cap, live).

## D3 — Pro-rata engine + shares path (spec, senior review)

**Problem.** `POST /admin/dividends` splits `totalAmount` equally
(`per = total / N`). Equal-split punishes the members who funded the
surplus and rewards zero-balance accounts — including dusty and
just-joined rows. D1/D2 (maker-checker + surplus cap) made payouts *safe*;
D3 makes them *fair*.

**Design decisions (and why).**
1. **Basis is per-declaration, snapshotted, immutable.** A declaration
   stores `basis` + the weight table it used. Re-running later (after new
   savings land) must NOT silently change history — D1's
   `(period, user_id)` uniqueness already guarantees one row per member;
   the snapshot guarantees the *amounts* stay explainable years later.
2. **Default stays `equal`.** Every existing product, test and treasurer
   habit keeps working. `savings` is opt-in per declaration until the
   board adopts it as policy — then flip the default in one place.
3. **Kobo-exact pools via largest remainder.** `toMoney()` rounds each
   share independently, so naive rounding leaks ±₦0.01×N against the
   declared pool — an auditor's first question. Floor every share to the
   kobo, then distribute the leftover kobo one-by-one to the largest
   fractional remainders. Pool in = pool out, to the kobo, provably.
4. **Zero-weight members are reported, not silently enriched.**
   `savings` basis with no savings ⇒ weight 0 ⇒ ₦0 row *skipped* (not
   inserted), listed in the response as `excluded`. No dust rows, no
   surprise windfalls, full disclosure.
5. **Same ledger accounts, same journal pattern.** Declaration still posts
   per member `Dr 3002 / Cr 2002`; only the *amount computation* changes.
   No chart changes, no migration risk to the books.

**Algorithm (`distributePool`, pure function — unit-testable).**
```
inputs : pool (kobo integer), weights[] (non-negative numbers)
1. total = Σ weights; if total == 0 → every share ₦0 (caller excludes all)
2. raw[i]    = pool * weights[i] / total        (float kobo)
3. share[i]  = floor(raw[i])                     (integer kobo)
4. leftover  = pool - Σ share[i]                 (0 ≤ leftover < N)
5. order by (raw[i] - share[i]) desc, tie-break by member id asc
6. share[first leftover members] += 1
invariant: Σ share[i] == pool  (assert before posting; abort if violated)
```
Weights use **kobo integers** (`Math.round(savings*100)`) — never floats
— so `total == 0` is exact and dust is exact.

**Weight definition (`savings` basis).**
`weight(member) = Σ savings.amount WHERE user_id = member`
(all-time contribution balance at declaration time; fixed deposits and
wallets excluded — they are not surplus-generating thrift). Members with
`status <> 'active'` or `role <> 'member'` are out of scope entirely
(staff never earn member dividends — current behaviour, preserved).

**Schema (additive, backward-compatible).**
```sql
ALTER TABLE dividends
  ADD COLUMN IF NOT EXISTS basis VARCHAR(20) NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS weight NUMERIC(20,2) NOT NULL DEFAULT 0;
-- per-declaration snapshot lives in audit_logs metadata (existing P2
-- pattern): { basis, pool, totalWeight, excluded[] }. No new tables.
```

**API delta (`POST /admin/dividends`).**
- New optional `basis: 'equal' | 'savings'` (default `'equal'`).
  Single-member path (`userId + amount`) ignores basis (explicit award).
- Pool path (`totalAmount + basis`) returns
  `{ count, excluded[], basis, pool, totalWeight, dividends }`.
- Cap check (D2) unchanged, applied to `totalAmount` before distribution.
- 409 semantics unchanged: any member already declared for the period
  aborts the *whole* declaration (atomic — no half-declared pools). The
  response names the conflicting member(s) so the treasurer knows why.

**Edge cases (decided, not deferred).**
- Pool smaller than headcount (e.g. ₦100 over 500 members): largest
  remainder pays the top-100 weights ₦1 each; rest excluded with reason
  `weight too small for pool`. Documented in response, not an error.
- Mid-period joiners: included iff active at declaration time, weighted
  by actual savings (possibly 0 ⇒ excluded). No proration by join date
  in v1 — declared policy, not an oversight; date-proration is a
  board decision for later.
- Re-declare after correction: void the bad declaration first (D4) —
  never "top up" a declared period.
- **Shares path (later, sketched):** `share_classes(par_value)` +
  `share_holdings(member, qty)`; weight = qty × par; purchase posts
  `Dr 1100 / Cr 3001`-style equity (new `3100 Share Capital` account).
  Projection endpoint (`GET /dividends/projection`) reuses
  `distributePool` read-only against the open period — the savings
  incentive loop falls out for free.

**Test plan.** Unit: exact-pool property test (random pools/weights,
assert Σ == pool); tie-break determinism; zero-total; single-member.
Integration: declare → assert per-member journals sum to pool; re-declare
→ 409 with zero new rows; void (D4) → payable returns to zero.
**Acceptance:** pool in = pool out to the kobo on 1,000 randomized cases;
projection visible to members; zero-weight members listed, never paid.

## D4 — Lifecycle hygiene (spec, senior review)

**Problem.** Declared dividends can sit in `pending`/`approved` forever,
and an erroneous declaration has no correction path except hand-editing
rows — which the append-only audit trail (P1) rightly treats as
tampering. Two mechanisms, one principle: **rows are never edited or
deleted; state only moves forward with a linked trail.**

**State machine (enforced server-side, not by convention).**
```
pending → approved → paid          (existing D1 happy path)
pending → voided                   (treasurer error, before approval)
approved → voided                  (error caught after approval, before pay)
paid → (terminal; corrections via adjustment only — see below)
approved → expired  → voided       (unclaimed past EXPIRY_DAYS)
pending  → expired  → voided       (same)
```
`voided` and `expired` are terminal. Any other transition → 409 with the
legal transitions listed (clients can render honest buttons).

**The money rule (this is where juniors get it wrong).** Declaration
posted `Dr 3002 Surplus Distribution / Cr 2002 Dividends Payable` *per
member at declare time*. Voiding must therefore **reverse the money**,
not just flip a status — otherwise the payable stays on the books while
the row claims otherwise, and the next trial balance is a lie. So:
- `voided` from `pending`/`approved` posts a linked reversal
  (`Dr 2002 / Cr 3002`, `reversal_of` → original entry, existing
  `reverseJournal` pattern), maker-checker approved, reason mandatory.
- `paid` rows are **never voided**: the member already holds the money.
  Correction = a compensating declaration through the *existing*
  `adjustments` module (propose → different admin approves → posts),
  or recovery recorded as a receivable + repayment. Clawing a wallet by
  hand is forbidden — it breaks the member-proof invariant (R1).
- `expired`: a nightly/cron sweep moves `approved` (and stale `pending`)
  older than `EXPIRY_DAYS` (default 90, treasurer-configurable) to
  `expired` with `expired_at`; a *separate* void step (with reversal,
  above) clears the payable. Expiry is a flag for follow-up, not a
  write-off — Lüthi's rule: unclaimed money stays a liability until the
  board formally resolves otherwise, with the resolution attached.

**Schema (additive).**
```sql
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS status … -- extend check:
-- pending | approved | paid | expired | voided
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS reversal_entry_no VARCHAR(20);
-- expires_at defaults at declaration: NOW() + EXPIRY_DAYS (keeps the
-- sweep a pure function of the row; backfill: existing rows get
-- created_at + 90 days).
```

**Follow-up report (the "hygiene" in lifecycle hygiene).**
- `GET /admin/dividends/attention` — every row in `pending`/`approved`/
  `expired`, aged, grouped by period, with `days_waiting`. One query,
  treasurer's Monday morning.
- Member nudge: unclaimed (`approved`, >30 days) members get a
  notification + email ("₦X approved for {period} is waiting").
- Treasurer digest: weekly notification while any item is >EXPIRY_DAYS.
- Sweep endpoint (`POST /admin/dividends/sweep`, super-admin/cron):
  expire-only, idempotent, audited per row. Expiry never posts journals.

**Edge cases (decided).**
- Batch pay (`pay-period`) skips `expired`/`voided` rows by construction
  (it selects `status = 'approved'`); a period containing voided rows
  still pays the rest — partial batches are legal, half-*declarations*
  are not.
- Void of a period with some members already `paid`: allowed per-row
  for the unpaid; paid rows keep their terminal state and are listed in
  the response (`paid_untouched[]`).
- Re-declaration after void: legal (voided rows don't trip the
  `(period, user_id)` unique conflict — the voided row *is* the history;
  alternatively keep the row and insert a superseding one linked by
  `reversal_entry_no`. Chosen: keep the voided row, new declaration
  references it in audit metadata. No unique-index surgery.)
- Race: sweep vs pay on the same row — both run in transactions with
  `SELECT … FOR UPDATE`; pay wins if it commits first (status no longer
  `approved`), sweep wins otherwise. Either outcome is a legal state.

**Test plan.** Unit: transition matrix (every from→to, legal and
illegal). Integration: declare → void → assert payable back to zero and
reversal linked; declare → approve → pay → void attempt → 409; sweep run
twice → idempotent; pay-period with mixed states → only approved pay.
**Acceptance:** no dividend row older than EXPIRY_DAYS sits unexplained;
every correction has a linked reversal or adjustment; the attention
report is empty on a healthy book.

---

# Audit Log Review — Coverage Analysis (2026-10-14, live data)

Question: does the system log who logged in, when, and who did what with money?
Verdict: logins and money actions covered; tamper-proofing and session tracking are not.

## What exists (verified live: 13 columns, 40 distinct actions)
- Logins: 78× `auth.login` with actor, role, timestamp, user-agent, IP, channel — plus register, password resets, `auth.login_failed`.
- Money: savings/loans/wallet/fixed/store/dividends/fund actions with actor + role + before/after + outcome, committed atomically (P2).
- Governance: role grants, KYC reviews, product config diffs, `report.generated` (11×), `export.downloaded`, `recon.run`, adjustments, period closes.
- Failures: logged (4 rows) but unwatched.

## Gaps (follow-up work)
1. **A1 — Session tracking:** add `session_id` (set at login, carried per event) — logout is client-side only today.
2. **A2 — Journal↔audit cross-link:** one linking column so money ↔ books ↔ who is one query.
3. **A3 — Two-era history:** pre-2026-10-13 rows lack role/before-after; 132 rows lack user-agent (old + system/webhook rows).
4. **A4 — Tamper evidence:** P4 hash-chain still pending; DB-password holders could rewrite undetected.
5. **A5 — Retention + watcher:** no retention policy (suggest 7 years, yearly archives); no alerts (≥5 failed logins/10 min, off-hours exports, role grants); monthly treasurer review of failures + exports.
- Acceptance: session chains queryable; audit↔journal join works; retention documented; first monthly review done.

---

# Ledger 2026 Review — Bank/MFB/Fintech Readiness, Gaps & Roadmap (2026-10-14)

Question: will the ledger speak to banks, MFBs and fintechs, and what must
be added to keep it robust for 2026+?
Verdict: fintech rails yes (live adapter); MFB half-ready (stub + float,
unwired); commercial banks correctly reached via NIP/NPS rails, not direct
APIs — but fee/levy accounting, statement automation and reference
traceability are missing for the 2026 regime (sender-side ₦50 stamp duty
on ≥₦10,000 transfers since 2026-01-01 per the Nigeria Tax Act 2025; CBN
ISO 20022 deadline Oct 2025; NPS rail live, ISO 20022-native,
multi-currency).

## What exists (verified in code)
- Double-entry core: atomic balanced-leg posting, idempotent entries
  (`source_transaction_id`), immutable books + linked reversals,
  maker-checker adjustments (proposer ≠ approver), period locks.
- Rail abstraction (`providers.js`): Flutterwave live (links, transfers,
  virtual accounts, verified webhooks); MFB stub + float `1003` + config
  contract documented.
- Reconciliation engine + suspense queue (never auto-adjusts), per-member
  wallet↔history proof, org-sliced entries, surplus-capped dividends,
  P&L / balance sheet / trial balance.

## Gaps, ranked by 2026 risk (fix later)
1. **G1 — No fee/levy accounting (critical).** Every payout ≥₦10,000 now
   costs ₦50 sender-side stamp duty + NIP/rail fees; no account, posting,
   or FIRS remittance flow exists. Payouts are misstated from 2026-01-01.
   Acceptance: fee schedule table + `Stamp Duty Payable` account +
   per-transfer postings + FIRS remittance report (salary/self-transfer
   exemptions per the Act).
2. **G2 — Plain-BVN storage (NDPA 2023 liability).** `kyc_profiles.bvn`
   in cleartext. Acceptance: hashed at rest, reads restricted + logged.
3. **G3 — No outbox/DLQ for rail money.** Crash between rail success and
   ledger commit (or a missed webhook) diverges money vs books with only
   a `console.error` behind. Acceptance: transactional outbox + stale
   `payment_intents` sweeper vs the rail.
4. **G4 — Statement ingestion unwired.** `fetchStatement()` throws
   `NotImplemented`; recon is manual-balance only. Acceptance: CSV now,
   camt.054 next, with amount+ref+date auto-match in Reconcile console.
5. **G5 — Reference poverty.** Internal refs only; provider end-to-end
   IDs not stored on journal entries. Acceptance: rail refs on every
   money entry for traceability.
6. **G6 — Currency hardcoded.** `postJournal` stamps `'NGN'` literally;
   currency column/adapter field unused. Acceptance: currency plumbed
   through + FX revaluation path (NPS is multi-currency).
7. **G7 — Cash accounting vs accrual expectations.** FD interest computed
   once as "expected payout"; no IFRS 9 loan staging/provisioning, PAR
   aging, or write-off flow. Acceptance: daily accrual postings +
   provisioning stages + PAR 30/90 + write-offs.
8. **G8 — Settlement treated as instant.** No T+0/T+1 float aging, per-rail
   caps, or health-based failover (single `DEFAULT_RAIL`, silent mock
   fallback can mask live outages). Acceptance: float aging + caps +
   failover routing.
9. **G9 — No payout velocity controls.** No daily limits or large-amount
   maker-checker on member withdrawals/transfers. Acceptance: limits +
   large-transfer approvals.
10. **G10 — Reporting/scale/observability.** No cash-flow statement; flat
    account chart (no versioning/budgets); full-table recon scans;
    `console.error`-only alerting. Acceptance: cash-flow report +
    suspense/float/webhook alerts + paged recon.

## Recommended roadmap
- **Phase 1 — 2026 compliance:** G1 fee/stamp-duty engine, G2 BVN hashing,
  G3 outbox + sweeper, G4 ingestion + auto-match, G5 rail refs.
- **Phase 2 — accounting depth:** G6 currency/FX, G7 accruals +
  provisioning, G8 float management, G9 payout limits, G10 cash-flow.
- **Phase 3 — ride the new rails:** NPS participation via licensed
  sponsor (ISO 20022 end-to-end), AfriGO collections, request-to-pay
  invoicing, open-banking data for credit scoring.

