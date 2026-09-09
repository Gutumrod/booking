# BRIEF — Codex BK01 R4 Independent Source Re-Review

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Reviewer:** Codex
**Mode:** INDEPENDENT SOURCE RE-REVIEW / EVIDENCE-FIRST / NO PRODUCT-SOURCE MUTATION
**Repository:** `/Users/wachirayachankhonkan/AI-Workspace/projects/saas-product-hub/products/booking`

## Mission

Independently re-review the R4 remediation performed after your prior `REMEDIATE_SOURCE` verdict.
Do not accept Claude's remediation report as proof. Inspect the actual branch, source, tests, contracts and diff yourself.

Primary question: did commits after `b0f7353` close F1–F6 without introducing a new contract, security, payment-integrity, readiness or state-management defect?

If all source issues are closed, return `SOURCE_REVIEW_PASS / BROWSER_PROOF_OWED` only.
If any source defect remains, return `REMEDIATE_SOURCE` with exact evidence and required correction.

Do not implement fixes during this review.

## Expected branch chain — verify, do not trust

- Frozen audit baseline: `docs/bk01-real-shop-hardening` @ `520bb08`
- Amended contract: `docs/bk01-real-shop-hardening-r2` @ `4d352ad`
- Pre-remediation R4 review target: `b0f7353`
- Source remediation tip to review: `815fb437cbe94221e68825b2f847043ba5e56cad`
- Current branch: `feature/bk01-real-shop-hardening-r4`
- The branch HEAD on Mac may be later than `815fb43` only because of this Git-tracked handoff documentation bundle.
- Required origin parity: local current HEAD == origin current HEAD.
- Required source parity: `git diff --name-only 815fb43..HEAD -- apps/ tests/ supabase/ scripts/ package.json package-lock.json` must be empty.

Mandatory preflight:
1. `git status -sb`
2. `git branch --show-current`
3. `git rev-parse HEAD`
4. `git rev-parse origin/feature/bk01-real-shop-hardening-r4`
5. verify ancestry `520bb08 -> 4d352ad -> b0f7353 -> 815fb43 -> current HEAD`
6. verify local/origin current HEAD parity
7. verify source parity after `815fb43`; only `docs/handoffs/mac-r4-2026-09-09/**` may differ after the source tip
8. verify frozen branches unchanged
9. verify worktree clean

Stop and report if branch/origin/ancestry/cleanliness differs, or if application/test/runtime/dependency source changed after `815fb43`.

## Authority to read before judging

Read directly:
- `/Users/wachirayachankhonkan/AI-Workspace/projects/saas-product-hub/products/booking/docs/handoffs/mac-r4-2026-09-09/REPORT-CODEX-BK01-R4-INDEPENDENT-REVIEW-2026-09-09.md`
- `/Users/wachirayachankhonkan/AI-Workspace/projects/saas-product-hub/products/booking/docs/handoffs/mac-r4-2026-09-09/BRIEF-CLAUDE-BK01-R4-REMEDIATION-FINAL-2026-09-09.md`
- `docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`
- `docs/architecture/R2-SCHEDULING-CONTRACT-V2-2026-09-09.md`
- `docs/architecture/R3-MERCHANT-CONFIG-ARCHITECTURE-2026-09-09.md`
- `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`
- `docs/architecture/R5-SERVICE-SCHEDULING-MODEL-2026-09-09.md`
- `docs/audit/R6-SECURITY-NEGATIVE-TEST-MATRIX-2026-09-09.md`

Precedence: Amendment 1 at `4d352ad` overrides frozen text on conflict.
The prior Codex independent report defines F1–F6 closure requirements.
Claude's return report is evidence to verify, not authority.

Review the exact remediation diff `b0f7353..815fb43` and also the cumulative R4 diff `4d352ad..815fb43`.

## Re-review F1 — payment instruction authority

Verify all of the following in actual page wiring, not only helper tests:
- awaiting payment requires configured PromptPay number;
- requires configured non-empty PromptPay account-holder name;
- account name is never derived from `shop.name`, fallback shop name or any invented identity;
- requires authoritative `holdResult.deposit_amount` finite and strictly `> 0`;
- incomplete tuple cannot enter/render an actionable payment step;
- no QR, amount, identity, recipient copy, QR download, slip picker or slip submit remains reachable when incomplete;
- no `?? 0`, guessed payment recipient, name or amount in the awaiting path;
- valid complete tuple still permits the intended payment UI.

Inspect `payment-instruction.ts`, consumer page wiring, messages and tests.
Try to falsify the claimed discriminated-union safety by following every render/action branch.

## Re-review F2 — no client shop-default deposit derivation

Verify:
- consumer no longer selects/reads `shop.default_deposit_amount` for payment display logic;
- pre-hold preview uses explicit `service.deposit_amount` only;
- absent service amount produces placeholder/unconfigured presentation, not a number;
- post-hold awaiting instruction uses server hold amount only;
- explicit `0` remains distinct from `null`;
- old `deposit-display.ts` fallback behavior and tests are removed/replaced;
- no equivalent fallback was reintroduced under a new helper/name.

Search changed consumer files and tests for `default_deposit_amount`, `?? 100`, numeric fallback chains and hidden conversion of null to zero.

## Re-review F3 — policy-aware readiness

Verify Admin readiness against actual current readable fields:
- `require_deposit=false` => payment readiness does not require PromptPay;
- `require_deposit=true` => readiness requires complete number + account name + resolvable configured amount;
- `NULL` amount is not coerced to zero;
- explicit zero semantics follow the amended contract and current server behavior honestly;
- any server-owned/public-booking truth unavailable client-side is labelled `BLOCKED_R7`, not inferred;
- overall shop readiness does not falsely fail a no-deposit merchant;
- tests cover both deposit and no-deposit shops and incomplete payment tuples.

Inspect `admin-service.ts`, `readiness.ts`, dashboard call site, messages and tests together.

## Re-review F4 — no invented service-deposit seed

Verify:
- Add Service no longer starts with literal `100` or any invented merchant deposit amount;
- unset state stays visibly unset until merchant chooses a value;
- explicit zero is distinguishable from unset/null in client state;
- editing an existing service preserves its actual value;
- changing price never mutates deposit;
- if current RPC rejects null, the UI fails honestly and records `BLOCKED_R7`; it must not silently substitute `0` or another number;
- tests do not claim null persistence succeeds unless source/RPC contract actually permits it.

Inspect service form initialization/reset, save path, Admin service typing and tests.

## Re-review F5 — duration client contract

Verify:
- client/domain minimum is exactly positive integer minute (`min=1`);
- `step={5}` if retained is only UI convenience and not a validation rule;
- no client `%15` business-rule rejection remains;
- values such as 1, 5, 15 and 37 are accepted by client validation while 0/fractional/invalid values fail;
- current RPC multiple-of-15 rejection is surfaced only as a transparent server compatibility limitation;
- arbitrary-minute persistence is explicitly `BLOCKED_R7`, never claimed as working pre-R7;
- no new 5/15 rule appears in helper, message copy or tests.

Inspect dashboard save logic, numeric helper usage, messages and tests.

## Re-review F6 — payment-incomplete customer state

Verify:
- `booking-state.ts` has a first-class payment-incomplete state;
- it is distinct from load error, not-found, booking-disabled, no-services, no-staff and no-schedule;
- no-deposit shop is never blocked by payment readiness;
- explicit-zero service is not treated as missing payment config;
- pre-hold state uses only contract-authorized public facts and does not guess server amount resolution;
- post-hold authoritative F1 gate remains the final truth when only server hold data can decide;
- page wiring actually renders the state and prevents misleading booking continuation.

Inspect state resolver, consumer Shop/service mapping, page precedence, messages and tests.

## Broad regression / new-defect search

Do not stop after F1–F6. Inspect the complete `b0f7353..815fb43` remediation diff and cumulative `4d352ad..815fb43` R4 diff for regressions.

Search specifically for:
- guessed merchant/payment identity or amount under renamed helpers;
- hidden `null -> 0`, empty -> numeric or fallback coercion;
- payment controls reachable through alternate render/state branches;
- readiness that silently conflates N/A, ready, attention and `BLOCKED_R7`;
- stale form defaults that become persisted merchant policy;
- source tests that merely encode implementation rather than amended contract;
- client/server divergence hidden behind friendly messages;
- state precedence bugs introduced by `PAYMENT_NOT_CONFIGURED`;
- security weakening, public-field expansion or secret exposure;
- mutation/refetch state loss in previously source-passing R4-1/R4-4;
- changes outside the authorized Admin/Consumer/tests source scope.

If you discover a new defect, assign a new finding ID and severity; do not force-fit it into F1–F6.

## Required verification gates — run fresh

Run and record actual results yourself:
- `npm test` — expected current report says 70/70; verify independently;
- `npm run lint` — zero errors; list warning count and whether any are newly introduced;
- Admin production build with non-secret placeholder public env only;
- Consumer production build with non-secret placeholder public env only;
- `git diff --check 4d352ad..HEAD`;
- secret-pattern scan over cumulative R4 diff;
- focused payment fallback scan;
- focused duration 5/15 policy scan;
- `git diff --stat 4d352ad HEAD -- supabase/ scripts/ *.env* package.json package-lock.json` must be empty;
- final `git status -sb` and local/origin SHA parity.

Do not use production `.env.local`, expose secrets, write persistent placeholder env files, deploy, mutate runtime or execute LAB migrations.

## Source-review acceptance boundary

A source-level PASS requires all of these:
1. F1–F6 verified closed in actual page wiring and helper/domain behavior.
2. No new HIGH/MEDIUM source defect found in changed files.
3. Tests that previously encoded invalid contract are corrected and now enforce the amended contract.
4. All fresh static/test/build/security/diff gates pass.
5. No migration/SQL/RPC/schema/env/dependency/shared-runtime delta exists.
6. `BLOCKED_R7` items remain explicitly blocked and are not simulated as complete client behavior.
7. No browser/mobile/runtime claim is made.

If these hold, verdict exactly:
`SOURCE_REVIEW_PASS / BROWSER_PROOF_OWED`

This verdict authorizes only preparation/execution of the approved KMO dark-pilot browser/mobile proof. It does NOT authorize merge, production cutover, R7, WSTERA LAB migration, Order/Claim live integration or shared-runtime changes.

## Required output

Create one evidence report outside the product branch:
`/Users/wachirayachankhonkan/AI-Workspace/runtime/reviews/REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-2026-09-09.md`

The report must contain:
- exact reviewed branch and HEAD;
- preflight/origin/ancestry/cleanliness evidence;
- F1–F6 closure table with source references and verdict per finding;
- any newly discovered findings with severity;
- per-R4-item source verdict R4-1..R4-9;
- test-quality analysis, including corrected former contract-conflicting tests;
- fresh test/lint/build/diff/security/scope evidence;
- exact `BLOCKED_R7` residuals;
- browser/mobile proof owed matrix;
- explicit statement that review mutated no product source/runtime/branch/history/deploy state;
- one final disposition only.

Do not create a remediation brief unless verdict is `REMEDIATE_SOURCE`.
If remediation remains necessary, create:
/Users/wachirayachankhonkan/AI-Workspace/runtime/handoffs/BRIEF-CLAUDE-BK01-R4-REMEDIATION-R2-2026-09-09.md
covering only independently verified remaining/new defects.

## Stop / prohibited boundary

Stop and report rather than improvising if:
- the reviewed HEAD or origin parity differs;
- unknown concurrent work appears;
- a required correction would need SQL/RPC/schema/migration/shared-runtime/dependency/env change;
- payment truth cannot be proven without guessing;
- contract precedence is ambiguous after applying Amendment 1;
- any required verification gate fails.

Prohibited during re-review:
- product source edits;
- history rewrite, reset, rebase, force-push or merge;
- deployment or browser acceptance claims;
- WSTERA LAB/runtime mutation;
- R7 implementation;
- Order/Claim live integration;
- PS01/MT01/platform/shared-surface change;
- use of production credentials.

The re-review is an independent closure gate, not implementation work.
