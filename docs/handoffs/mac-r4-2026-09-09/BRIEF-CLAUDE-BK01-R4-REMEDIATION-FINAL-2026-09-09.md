# BRIEF — Claude BK01 R4 Final Source Remediation

**Date:** 2026-09-09 (Asia/Bangkok)
**Repository:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Starting branch:** `feature/bk01-real-shop-hardening-r4`
**Expected starting SHA:** `b0f7353033f3ca0778fcadb7ed491ed0429af890`
**Authority:** `D:\AI-Workspace\runtime\reviews\REPORT-CODEX-BK01-R4-INDEPENDENT-REVIEW-2026-09-09.md`

## Mission

Remediate every verified R4 source defect below. Continue on `feature/bk01-real-shop-hardening-r4`; no new branch is required unless the expected branch/SHA or cleanliness check fails. This is source-only remediation before independent re-review. It does not authorize R7, runtime mutation, deploy, merge or browser acceptance claims.

## Source-of-Truth References

- `docs/BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
- `docs/BK01-REAL-SHOP-HARDENING-R0-R6-HANDOFF-2026-09-09.md`
- `docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md` at amended-doc tip `4d352ad495824db5c5b421506b2891112fef6fe0`
- `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`
- `docs/audit/R6-SECURITY-NEGATIVE-TEST-MATRIX-2026-09-09.md`
- Independent evidence report above, reviewed at `b0f7353033f3ca0778fcadb7ed491ed0429af890`

Amendment 1 overrides frozen contract text on conflict. Frozen `520bb082af7cab3cf19eec47094daea5760d4f3e` and amended-doc tip `4d352ad...` must not be modified.

## Mandatory preflight

Before editing:

1. Run `git status -sb`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/feature/bk01-real-shop-hardening-r4`.
2. Stop if the worktree is dirty, branch differs, HEAD differs from expected, origin parity differs, or unknown concurrent changes appear.
3. Re-read the independent report and the Amendment A1/B1 blocks.
4. Confirm the diff from `4d352ad` contains no migration, SQL, env, script, dependency or shared-runtime delta.

No history rewrite, rebase, reset, force push, merge, deploy or production credential use.

## Remediation R4-F1 — one fail-closed payment-instruction gate

**Files/functions:**

- `apps/booking-consumer/src/app/book/[slug]/page.tsx`: payment derivation near current lines 182-212; awaiting-hold branch near 337-348; step-3 payment/slip UI near 715-829.
- `apps/booking-consumer/src/lib/deposit-display.ts` (rename/reshape if a clearer payment-instruction helper is warranted).
- `tests/deposit-display.test.ts` plus new focused helper/component-source contract tests as appropriate.
- Consumer messages in both locales.

**Before:** awaiting flow checks only PromptPay number, invents account name from shop/fallback name, tolerates missing/non-positive hold amount, renders a broken card and leaves slip submission reachable.

**After:** an awaiting-deposit instruction exists only when all are true:

- configured/valid PromptPay recipient exists;
- configured non-empty account-holder name exists (never shop-name/fallback derivation);
- server `holdResult.deposit_amount` is finite and strictly positive.

If any is missing, show a dedicated `paymentNotConfigured` state/error and render **none** of: QR, amount, account identity, recipient copy, QR download, slip picker or submit button. Remove every awaiting-path `?? 0`. Do not weaken server-error handling. Pre-hold data must never be treated as authoritative after hold.

**Tests:** missing number, missing name, blank name, null/zero/negative/NaN hold amount, valid complete tuple, and assertion that incomplete tuples cannot enable QR or submission controls.

## Remediation R4-F2 — remove shop-default amount derivation from consumer

**Files/functions:**

- `apps/booking-consumer/src/lib/deposit-display.ts:10-33`
- `apps/booking-consumer/src/app/book/[slug]/page.tsx` current call site near 199-203 and service card near 558-560
- `tests/deposit-display.test.ts`

**Before:** helper and service card resolve service deposit → shop default before hold.

**After:**

- Before hold: show explicit `service.deposit_amount` when present; otherwise show the merchant-defined/unconfigured placeholder. Never derive a number from `shop.default_deposit_amount` client-side.
- After hold: use only `holdResult.deposit_amount` for an awaiting instruction.
- Preserve `null` versus explicit `0`; explicit zero means no service deposit, not missing.

Remove `shopDefaultDepositAmount` from the helper interface and all consumer call sites. Rewrite the test that currently approves shop-default fallback into a rejection/non-derivation test.

## Remediation R4-F3 — policy-aware Admin readiness

**Files/functions:**

- `apps/booking-admin/src/lib/admin-service.ts`: `RawShop`, dashboard shop mapping, shop select.
- `apps/booking-admin/src/lib/readiness.ts`: `ReadinessInput`, `computeReadiness`.
- `apps/booking-admin/src/app/dashboard/page.tsx`: loaded state and readiness call.
- `tests/readiness.test.ts`.
- Admin messages if readiness needs a distinct attention explanation.

Use existing readable fields only; do not add schema/RPC/migration. Fetch/map the current deposit policy required to compute honest client readiness.

**After:**

- `require_deposit=false`: payment row is ready without PromptPay onboarding.
- `require_deposit=true`: payment row is ready only if a resolvable configured amount and complete PromptPay number/account name exist.
- `NULL` is never treated as zero.
- No-deposit shop contributes no false overall-unready state.
- Any authoritative public-booking readiness not available from current source remains explicitly `BLOCKED_R7`, not guessed.

Add tests for no-deposit/no-PromptPay ready; deposit-required missing number/name/amount unready; complete deposit config ready; null versus explicit zero per amended semantics.

## Remediation R4-F4 — remove invented service-deposit seed

**Files/functions:**

- `apps/booking-admin/src/app/dashboard/page.tsx`: service state near current lines 152-161; `handleOpenAddService`; `handleOpenEditService`; `handleSaveService`; deposit input.
- `apps/booking-admin/src/lib/admin-service.ts`: `CreateServiceInput` / `UpdateServiceInput` and RPC payload typing only if required to preserve null.
- `apps/booking-admin/src/lib/numeric-field.ts` only if an optional numeric commit mode is needed.
- Tests for form/domain helper behavior.

**Before:** Add Service pre-populates `100`, requires the numeric input and passes the value as merchant policy.

**After:** new service deposit starts unset/empty and stays distinct from explicit zero. The merchant must explicitly enter a value to set one. Persist `null` when the current RPC contract safely supports it. If the existing RPC cannot accept null without SQL/schema change, stop this item at the client-safe boundary, document the exact signature evidence as `BLOCKED_R7`, and do not substitute `0` or `100`.

Editing an existing service must preserve its actual deposit; changing price must not overwrite it. Add tests for unset, explicit zero, explicit positive amount, edit preservation and price-only edit.

## Remediation R4-F5 — positive-minute UI without invented 5/15 rule

**Files/functions:**

- `apps/booking-admin/src/app/dashboard/page.tsx`: `handleSaveService` and duration input.
- `apps/booking-admin/messages/en.json`, `th.json`.
- Numeric/domain tests.

Set client validation and HTML minimum to 1 positive integer minute. `step={5}` may remain only as keyboard/spinner convenience; it must not be validated as a business rule. Remove the client `% 15` rejection.

The pre-R7 RPC is known to reject non-multiples of 15. Preserve the raw RPC error or translate only the exact known server error into a transparent compatibility message stating persistence is temporarily blocked pending R7. Do not claim arbitrary-minute persistence passes. Add client tests for 1, 5, 15, 37 and invalid 0/fractional values; label server persistence for non-multiples `BLOCKED_R7`.

## Remediation R4-F6 — truthful payment-incomplete customer state

**Files/functions:**

- `apps/booking-consumer/src/lib/booking-state.ts`
- `apps/booking-consumer/src/app/book/[slug]/page.tsx`
- `tests/booking-state.test.ts`
- Consumer messages in both locales.

Add a distinct payment-configuration negative state where current public contract data proves the selected/requested deposit flow cannot be completed. Do not globally block a no-deposit shop. Do not block an explicit-zero service. Do not guess amount resolution. Retain the authoritative post-hold gate from R4-F1 for cases only the server result can decide.

Add precedence tests so load error/not-found/booking-disabled/configuration states remain distinguishable, plus no-deposit and explicit-zero cases.

## Required source-only acceptance gates

All must pass before returning for Codex re-review:

- `npm test`
- `npm run lint` with zero errors; list warnings exactly
- Admin production build using non-secret placeholder public env only if required
- Consumer production build using non-secret placeholder public env only if required
- `git diff --check 4d352ad..HEAD`
- focused search proves no payment recipient/name/amount fallback and no admin deposit seed `100`
- focused search proves no client duration `min 5` or `%15` guard
- migration/shared-runtime diff from `4d352ad` remains empty
- secret-pattern scan of the complete remediation diff
- final `git status -sb`

Do not use production `.env.local`, print secrets, or write placeholder env files.

## Logical commit requirement

Create small logical commits, not one bulk commit. Recommended partition:

1. consumer payment authority + negative-state tests (F1, F2, F6);
2. admin policy-aware readiness + unset deposit tests (F3, F4);
3. duration positive-minute client remediation + tests/messages (F5).

If dependencies make a different partition safer, explain it. Do not amend or squash prior history. Push only the existing feature branch after all gates pass and only if the existing workflow already authorizes normal branch push; never force push.

## Browser/mobile proof matrix — KMO pilot after source re-review passes

Do not execute or claim this matrix in the source-remediation turn. Hand it forward unchanged for an approved actual target:

- R4-1: change service price; existing merchant deposit remains unchanged.
- R4-2: clear numeric field; it stays visually empty; invalid save is rejected clearly.
- R4-3: type valid HH:MM using keyboard on mobile; arrow-step works; break can be cleared.
- R4-4: edit Staff A and B; save A; B unsaved values survive; reload shows A persisted; leaving while dirty warns.
- R4-5: half-configured shop shows truthful readiness; Preview remains available; no-deposit shop is not payment-blocked.
- R4-6: no services, no staff, no schedule, payment incomplete, not-found and runtime-load errors are distinguishable.
- R4-7: deposit-required incomplete payment config shows no QR or guessed identity/amount/upload path; complete config uses the authoritative hold amount.
- R4-8: countdown follows server expiry rather than a local hardcoded duration.
- R4-9: UI does not invent a 5/15-minute minimum; current RPC compatibility limitation is communicated until R7.
- Customer E2E: shop → service → staff/provider → date → valid slot → hold/create.

## Residuals that must remain `BLOCKED_R7`

- SQL/RPC removal of the duration multiple-of-15 rule and runtime proof of arbitrary minutes.
- Server-authoritative deposit resolution and `PAYMENT_NOT_CONFIGURED` enforcement.
- Scheduling/availability primitive, reschedule collision parity and concurrency proof.
- Authoritative readiness/config RPC/schema work.
- WSTERA LAB migrations, DB/RPC authorization/tenant/negative tests, rollback proof.
- Shared runtime, Order/Claim, PS01/MT01 or platform deltas.

## Stop and escalation conditions

Stop without improvising if:

- branch/SHA/origin/cleanliness differs from preflight;
- an unknown concurrent source change appears;
- a fix requires migration, SQL, RPC, schema, shared-runtime, dependency or environment-file change;
- null service deposit cannot be preserved by the existing RPC contract;
- payment truth cannot be proven without guessing recipient, name or amount;
- contract documents conflict after applying Amendment 1 precedence;
- any required test/lint/build/security/diff gate fails.

## Prohibited actions

- Do not touch frozen `520bb08` or amended-doc tip `4d352ad`.
- Do not rewrite R0/R1 evidence or history.
- Do not add migration/RPC/schema/runtime changes.
- Do not weaken fail-closed behavior.
- Do not use guessed merchant/payment data as production truth.
- Do not merge to coordinator/main, deploy, or claim browser/mobile acceptance.

## Required return evidence

Return all of the following:

- branch and final HEAD;
- ordered logical commit list;
- changed-file and diff-stat summary;
- per-remediation before/after result;
- full test count/result;
- lint exit and warning list;
- both build results and exact placeholder-env method (values may be described generically, never secrets);
- `git diff --check` result;
- secret scan result;
- final `git status -sb`;
- exact command/result proving migration/SQL/env/script/dependency/shared-runtime diff remains empty;
- explicit `BLOCKED_R7` residual list;
- statement that no merge/deploy/runtime/browser proof occurred.

Final disposition must be: **`IMPLEMENTATION REMEDIATION COMPLETE — READY FOR INDEPENDENT CODEX SOURCE RE-REVIEW`**. Claude must not declare R4 source PASS itself.
