# REPORT — Codex BK01 R4 Independent Source Re-Review R9

**Date:** 2026-09-22 (Asia/Bangkok)  
**Repository:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`  
**Review worktree:** `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`  
**Branch:** `feature/bk01-real-shop-hardening-r4`  
**Reviewed HEAD / origin:** `3b3a3338de029a058aa5763c806be42f8a5205ca`  
**Mode:** independent source/security review; product source read only; no browser/mobile acceptance; no DB/runtime mutation  
**Authority:** `D:\AI-Workspace\runtime\handoffs\BRIEF-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md`

## 1. Verdict

**`SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME`**

NEW-F18 is source-closed. The anonymous Consumer services and staff queries select only their customer-facing fields and neither select, filter, order by nor otherwise depend on `is_active`. They continue to use the ordinary browser anon client and retain truthful error-versus-empty behavior.

Canonical migrations keep RLS enabled on both tables. Anonymous row visibility is constrained by `USING (is_active = true)` for services and staff, so removing the redundant browser filter does not expose inactive rows. No service-role bypass, grant expansion, alternate read, fake fallback or DB/runtime change was introduced.

No new HIGH/MEDIUM source, security or correctness finding was found. NEW-F12 through NEW-F17 and previously accepted R4 contracts show no regression.

This verdict only authorizes resuming browser/mobile proof at the exact reviewed revision. It does not assert that browser acceptance has passed and does not authorize Junction A, shared-runtime mutation, runtime R7, merge, deploy, Order live or Claim live.

## 2. NEW-F18 public-query proof

### Consumer services

- `apps/booking-consumer/src/lib/booking-service.ts:105-113` selects only `id, shop_id, name, description, duration_minutes, price, deposit_amount`.
- The only predicate is tenant scoping by `shop_id`.
- There is no `is_active` projection, filter, ordering or client-side active-row policy.

### Consumer staff

- `apps/booking-consumer/src/lib/booking-service.ts:116-124` selects only `id, shop_id, name, nickname`.
- The only predicate is tenant scoping by `shop_id`.
- There is no `is_active`, `user_id`, phone or internal metadata projection/filter/order dependency.

Both functions return through `rowsOrThrow`. Therefore a query/network/authorization failure remains a thrown load error, while a healthy zero-row result remains an empty services/staff state. No unsafe fallback was added.

The Consumer Supabase module still constructs a normal browser client from the public URL and anon key against schema `local_service`; no service-role credential or RLS bypass exists in this path.

## 3. Canonical RLS authority proof

- `20260807051615_local_service_initial_schema.sql:103-104` enables RLS on `local_service.services` and `local_service.staff`.
- The canonical services public SELECT policy at `:121` is `USING (is_active = true)`.
- The original staff public policy at `:122` has the same condition. The later BK-A migration drops/replaces it with an explicit anon policy at `20260829105155_bk_a_v1_contract_remediation.sql:109-113`, also `USING (is_active = true)`.
- The current anon column grants at `20260829105155_bk_a_v1_contract_remediation.sql:116-122` are column-level. They do not override RLS row filtering. The R9 query uses a strict subset and does not request `is_active`.
- Broader member/management paths are authenticated policies, not anon alternatives. No later migration disables RLS or adds a permissive anon services/staff policy.

For an anonymous request, column privilege answers which projected columns may be read; RLS answers which rows may be returned. Since both public row policies require active rows, removing the client predicate cannot broaden the canonical anonymous result to inactive rows.

The historical KMO 401/42501 evidence is consistent with a downstream runtime whose public column grant is narrower than the canonical migration. R9 no longer requires privilege on `is_active`, without broadening grants. That historical observation is corroboration only; post-fix runtime success still requires a new browser run.

## 4. Browser-evidence boundary

The browser run at `7349c54` is valid discovery evidence for the old services/staff failure, not acceptance evidence for `3b3a333`.

The separate `staff_schedules` and `shop_holidays` 401 observations were not folded into NEW-F18: the reviewed source does not show the same private-column-filter root cause. They remain explicit runtime items for the resumed browser proof. This review performed no browser/mobile action and no KMO DB/runtime mutation.

## 5. Regression review

| Contract | Source result | Evidence summary |
|---|---|---|
| NEW-F12 | `PASS_SOURCE` | Admin canonical current-shop selector and its consumers are outside the two-file R9 delta and remain intact. |
| NEW-F13 | `PASS_SOURCE` | Preview exact non-empty layout/page identity fail-closed contract is unchanged. |
| NEW-F14 | `PASS_SOURCE` | Shared latest-request generation gate and stale response/error/finalizer rejection are unchanged. |
| NEW-F15 | `PASS_SOURCE` | Stale tenant snapshot, navigation, mutation and dirty-buffer gating are unchanged. |
| NEW-F16 | `PASS_SOURCE` | Stale mutation continuation cannot mint authority for a no-longer-current layout; unchanged by R9. |
| NEW-F17 | `PASS_SOURCE` | Commit-synchronous `useLayoutEffect` authority revocation/setup remains unchanged. |
| NEW-F11 | `PASS_SOURCE` | Consumer slug-keyed remount and request-generation gate remain intact. |
| F1/F2/F3/F4/F6 | `PASS_SOURCE` | Payment identity/amount truth, readiness truth, no invented deposit and service-selection gating are unchanged. |
| NEW-F7/F8/F9/F10 | `PASS_SOURCE` | Readiness truth/error separation, required Preview surfaces and positive-integer duration contract are unchanged. |
| Public privacy | `PASS_SOURCE` | Public profile remains minimal; public staff query omits auth linkage and private/internal fields. |
| PromptPay | `PASS_SOURCE` | Admin/Consumer semantic parity is unchanged. |
| Prior R4 contracts | `PASS_SOURCE` | R9 changes only the two public reads and their source contract test; no accepted contract regression found. |

The active search found no new HIGH/MEDIUM defect caused by leaving active-row truth to RLS.

## 6. Preflight and scope audit

- Review-start branch/worktree: exact expected branch and clean.
- Local HEAD = origin = expected `3b3a3338de029a058aa5763c806be42f8a5205ca`.
- Base `7349c54390370a075a7dda78ca9e5c3f781b59ef` is an ancestor.
- R9 is one bounded commit: `3b3a333 fix(booking-consumer): rely on public RLS for active rows (NEW-F18)`.
- R9 changed exactly `apps/booking-consumer/src/lib/booking-service.ts` and `tests/public-contract.test.ts` (+11/-4).
- Protected-scope scan: 0 hits. No migration/SQL/env/dependency/lockfile/shared-runtime/Junction A/runtime R7/Order/Claim change.
- Frozen authority local/origin remains `520bb082af7cab3cf19eec47094daea5760d4f3e`.
- Amended authority local/origin remains `4d352ad495824db5c5b421506b2891112fef6fe0`.

## 7. Fresh mandatory gates

| Gate | Result |
|---|---|
| `npm test` | **PASS — 118/118**, 0 failed |
| `npm run lint` | **PASS — 0 errors, 12 warnings** (6 Consumer + 6 Admin) |
| Admin production build | **PASS** — compile, TypeScript and 16/16 page generation |
| Consumer production build | **PASS** — compile, TypeScript and 8/8 page generation |
| Admin `tsc --noEmit` | **PASS** |
| Consumer `tsc --noEmit` | **PASS** |
| `git diff --check 4d352ad..HEAD` | **PASS** |
| focused public-query/RLS scan | **PASS** |
| cumulative added-line secret scan | **PASS — 3,766 added lines, 0 pattern hits** |
| R9 protected-scope scan | **PASS — 2 changed paths, 0 hits** |
| browser/mobile acceptance | **NOT RUN — prohibited; must resume separately** |

Builds used process-local non-secret public placeholders only. No persistent env file or dependency was modified.

## 8. Final boundary

No product source, tests, repository docs, branch history, runtime, database, deployment, KMO repository or environment was modified by this review. The only created artifact is this independent report under `D:\AI-Workspace\runtime\reviews`.

Final disposition: **`SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME`**
