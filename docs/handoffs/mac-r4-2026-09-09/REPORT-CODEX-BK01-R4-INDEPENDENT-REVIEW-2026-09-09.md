# REPORT — Codex BK01 R4 Independent Review

**Date:** 2026-09-09 (Asia/Bangkok)
**Repository:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Reviewed branch:** `feature/bk01-real-shop-hardening-r4`
**Reviewed HEAD:** `b0f7353033f3ca0778fcadb7ed491ed0429af890`
**Mode:** independent source/security review; no product-source mutation

## 1. Overall verdict

**`REMEDIATE_SOURCE`**

R4 cannot be promoted to `SOURCE_REVIEW_PASS / BROWSER_PROOF_OWED`. Five source defects remain, including payment-integrity failures that can display or accept guessed/incomplete payment truth. R4-1, R4-2, R4-3, R4-4 and R4-8 are source-level passes subject to browser proof; R4-5, R4-6, R4-7 and R4-9 require source remediation. R7/runtime work remains blocked.

## 2. Findings (highest severity first)

### F1 — HIGH — awaiting-deposit flow does not require a verified account name or authoritative positive amount

- Evidence: `apps/booking-consumer/src/app/book/[slug]/page.tsx:186` manufactures `promptpayName` from `shop.name` or `fallbackShopName`; `:337-348` checks only `promptpayNumber` before entering step 3; `:745-784` renders the payment card even when the payload is null; `:768` falls back to `0`; `:769` displays the manufactured name; `:786-825` still permits slip upload/submission.
- Contract: Amendment B1 requires a deposit-required instruction to fail closed when recipient or amount is unresolved; the mission additionally forbids inventing account-holder identity.
- Impact: a customer can be shown an incomplete/misidentified payment instruction and can submit a slip even though the authoritative payment tuple is invalid.
- Required fix: define one fail-closed payment-instruction guard requiring (a) a valid recipient number, (b) a non-empty configured account-holder name, and (c) the **server hold** amount to be finite and `> 0`. Do not render step 3, QR, amount, identity, copy/download, or upload controls unless all three pass. Show the explicit payment-not-configured state instead. Never use `?? 0` for awaiting payment.

### F2 — HIGH — pre-hold consumer UI derives deposit from shop default contrary to amended R4-7

- Evidence: `apps/booking-consumer/src/lib/deposit-display.ts:26-33` resolves hold → service → shop default; call site `apps/booking-consumer/src/app/book/[slug]/page.tsx:199-203` supplies `shop.default_deposit_amount`; service cards repeat the same default derivation at `:558-560`. `tests/deposit-display.test.ts:17-34` explicitly approves the invalid fallback.
- Contract: amended R4-7 permits explicit service deposit before hold; otherwise the consumer must show an unconfigured/merchant-defined placeholder. After hold, amount is server-authoritative.
- Impact: client-side preview can state a monetary amount that the server may not select, violating no-invented-money truth.
- Required fix: remove `shopDefaultDepositAmount` from `resolveDepositDisplay` and its call sites. Pre-hold: explicit service amount only; absent service amount: placeholder. Post-hold awaiting: hold amount only. Rewrite tests so shop default can never create a displayed amount or QR.

### F3 — MEDIUM — readiness treats PromptPay as mandatory for every shop and cannot express actual deposit policy

- Evidence: `apps/booking-admin/src/lib/readiness.ts:21-40` has no `requireDeposit` input and sets payment readiness solely from PromptPay presence. `apps/booking-admin/src/lib/admin-service.ts:224` does not fetch `require_deposit` or `default_deposit_amount`. `tests/readiness.test.ts:43-49` codifies this behavior.
- Contract: Amendment B1 says new shops opt out of deposit; a no-deposit merchant must not be payment-blocked. If deposit is required, amount and verified payment identity must be complete.
- Impact: truthful no-deposit shops are shown unready; deposit-required shops may be shown ready with only a number while amount/name are missing.
- Required fix: fetch and map the existing payment-policy fields needed by the client; compute payment readiness conditionally. `require_deposit=false` is ready without payment onboarding. When true, require a resolvable configured amount plus complete PromptPay number/name. Keep any unavailable server-owned readiness capability labelled `BLOCKED_R7`, not guessed.

### F4 — MEDIUM — Add Service still seeds an invented deposit of 100

- Evidence: `apps/booking-admin/src/app/dashboard/page.tsx:159-161` initializes `serviceDeposit` to `100`; `:588-595` resets Add Service to `100`; `:1491-1499` requires a numeric deposit, so the invented value is naturally saved.
- Contract: Amendment B1 explicitly requires removal of the admin `100` seed; `NULL` means not set and must remain distinct from explicit zero.
- Impact: creating a service can silently establish merchant payment policy the merchant did not choose.
- Required fix: make new-service deposit empty/nullable with explicit merchant choice. Preserve `null` through form state and the RPC input when unset; do not silently convert it to zero. If the current client/RPC typing cannot accept null, record that exact dependency as `BLOCKED_R7` and do not substitute a guessed number.

### F5 — MEDIUM — duration UI still invents 5/15-minute policy

- Evidence: `apps/booking-admin/src/app/dashboard/page.tsx:612` validates `min: 5`; `:628-635` blocks non-multiples of 15; `:1467-1474` uses `min={5}` and `step={5}`. The message at `apps/booking-admin/messages/en.json:322` presents the server limitation as a client rule.
- Contract: Amendment A1 says duration is any positive integer minute, R4 input `min={1}`, while the pre-R7 RPC's multiple-of-15 constraint remains a separately disclosed compatibility limitation until R7.
- Impact: valid merchant durations below 5 are rejected, and the client independently enforces a withdrawn business rule.
- Required fix: set validation/input minimum to 1; `step` may be 5 only as non-binding convenience. Do not encode `%15` as merchant validation. Because the existing RPC will reject non-multiples until R7, surface the server compatibility limitation transparently and keep actual free-minute persistence acceptance `BLOCKED_R7`; do not claim it works before R7.

### F6 — MEDIUM — customer page has no first-class payment-incomplete page state

- Evidence: `apps/booking-consumer/src/lib/booking-state.ts:13-40` has no `PAYMENT_NOT_CONFIGURED` state even though `Shop` exposes `require_deposit` and payment fields in `apps/booking-consumer/src/lib/booking-service.ts:6-16,91-95`. Current behavior only sets a generic inline error after a hold, at `page.tsx:337-343`, and checks only the recipient number.
- Contract: R4-6 requires payment-incomplete to be distinguishable from other customer negative/error states; Amendment B1 requires fail-closed readiness.
- Impact: a deterministically unbookable deposit flow is presented as available until after the customer completes the earlier steps and creates a hold.
- Required fix: add an explicit payment-configuration negative state/guard based only on contract-authorized public fields. It must not block no-deposit shops or explicit-zero services. Where final truth depends on server resolution, retain the post-hold authoritative guard from F1.

## 3. Branch, ancestry, origin and scope evidence

- `git status -sb`: clean; branch tracks `origin/feature/bk01-real-shop-hardening-r4` with no ahead/behind marker.
- Local HEAD and origin branch both resolve to `b0f7353033f3ca0778fcadb7ed491ed0429af890`.
- `520bb08` is an ancestor of `4d352ad`; `4d352ad` is an ancestor of `b0f7353`.
- Local and origin frozen audit branches both resolve to `520bb082af7cab3cf19eec47094daea5760d4f3e`; diff from `520bb08` to the frozen branch is empty.
- `4d352ad..b0f7353` contains 10 commits and exactly 19 changed files: Admin/Consumer UI, helper modules, messages and pure tests.
- Targeted name/diff checks found no migration, SQL, env, script, dependency, lockfile or shared-runtime delta.
- `git diff --check 4d352ad..b0f7353`: pass.
- Security diff scan found no added credential, token, private key, service-role value, environment file or dependency.

## 4. Authority and precedence used

Reviewed directly:

1. `docs/BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
2. `docs/BK01-REAL-SHOP-HARDENING-R0-R6-HANDOFF-2026-09-09.md`
3. `docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`
4. `docs/architecture/R2-SCHEDULING-CONTRACT-V2-2026-09-09.md`
5. `docs/architecture/R3-MERCHANT-CONFIG-ARCHITECTURE-2026-09-09.md`
6. `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`
7. `docs/architecture/R5-SERVICE-SCHEDULING-MODEL-2026-09-09.md`
8. `docs/audit/R6-SECURITY-NEGATIVE-TEST-MATRIX-2026-09-09.md`

Amendment 1 at `4d352ad` overrides frozen text on conflict. In particular: free positive integer minutes; no client/shop-default invented deposit amount; new shops deposit opt-in with `NULL` not equal to zero; fail closed on incomplete payment authority.

## 5. Per-item source verdict

| Item | Verdict | Evidence / boundary |
|---|---|---|
| R4-1 deposit survives price change | `PASS_SOURCE` | Save path sends the current deposit value independently; no `price * 0.3` remains. Browser/reload proof still owed. |
| R4-2 empty numeric editing | `PASS_SOURCE` | String draft + `commitNumericField`; empty is editable and rejected at save. Tests cover parse/commit. Browser clarity owed. |
| R4-3 practical time entry | `PASS_SOURCE` | `TimeField` accepts keyboard text, arrows and break clearing without changing `HH:MM` RPC values. Browser/mobile proof owed. |
| R4-4 multi-staff dirty survival | `PASS_SOURCE` | Dirty staff are preserved across refetch; single-save avoids global refetch; Save All clears only successful rows; before-unload warning exists. Concurrency/reload browser proof owed. |
| R4-5 preview/readiness | `REMEDIATE_SOURCE` | Preview is always available, but readiness is payment-policy false truth (F3) and public availability remains R7-dependent. |
| R4-6 truthful customer states | `REMEDIATE_SOURCE` | Load/not-found/disabled/no-services/no-staff/no-schedule are distinct; payment-incomplete is missing (F6). Runtime/browser proof owed. |
| R4-7 no invented payment truth | `REMEDIATE_SOURCE` | F1/F2 violate amount and identity authority. |
| R4-8 server expiry countdown | `PASS_SOURCE` | Countdown seeds and recomputes from `holdResult.expires_at`; no local 15-minute duration remains in timer logic. Dedicated boundary tests are missing; browser proof owed. |
| R4-9 positive-minute duration | `REMEDIATE_SOURCE` + `BLOCKED_R7` | Client still enforces 5/15 (F5); RPC removal is explicitly R7. |

## 6. Secretary claims disposition

- **S1 confirmed and sharpened:** min 5 and `%15` both conflict with Amendment A1. Client-safe remediation is required; successful arbitrary-minute persistence remains `BLOCKED_R7`.
- **S2 confirmed:** shop-default derivation is present in helper, call site, service card and tests; it conflicts with amended R4-7.
- **S3 confirmed and expanded:** the awaiting path checks only number. It also invents account name, admits missing/non-positive amount, renders a broken payment card and leaves slip submission reachable.
- **S4 confirmed:** readiness ignores `require_deposit`, and Add Service seeds literal 100.

## 7. Test-quality analysis

- `npm test`: **59/59 pass**, but this is not acceptance.
- Strong focused source coverage exists for R4-2 helpers, basic R4-3 parsing, R4-4 merge behavior, and several R4-6 negative-state precedences.
- Contract-conflicting tests:
  - `tests/deposit-display.test.ts` approves service → shop-default fallback.
  - `tests/readiness.test.ts` approves PromptPay as universally mandatory.
- Missing required cases:
  - Payment instruction requires number + configured account name + authoritative positive hold amount.
  - Incomplete payment renders no QR, amount, identity, download/copy or slip-upload/submit controls.
  - No-deposit merchant is payment-ready without PromptPay.
  - Deposit-required merchant is unready when amount/name/number is incomplete.
  - New service does not seed 100 and preserves unset distinct from zero.
  - Duration 1 is accepted by client; 5/15 are not business constraints; pre-R7 server rejection is explained.
  - Countdown malformed/past/future expiry boundaries and tick behavior.
  - Component/call-site tests for schedule Save A preserving dirty B and partial Save All failure.
- Pure helper tests do not prove page wiring or browser interaction. No browser/mobile target was used; therefore every applicable item retains `PROOF_OWED_BROWSER`.

## 8. Verification evidence

| Check | Result |
|---|---|
| `npm test` | PASS — 59 tests, 59 pass, 0 fail |
| `npm run lint` | PASS exit 0 — 13 warnings, 0 errors; warnings are non-blocking and include existing unused icons / `<img>` advisories |
| Admin `next build` with non-secret placeholder public env | PASS — compile, TypeScript, page generation |
| Consumer `next build` with non-secret placeholder public env | PASS — compile, TypeScript, page generation |
| `git diff --check 4d352ad..b0f7353` | PASS |
| Browser/mobile/E2E | NOT RUN — no approved actual target; `PROOF_OWED_BROWSER` |
| LAB/RPC/DB/tenant/concurrency | NOT RUN — `BLOCKED_R7` / Junction A |

## 9. Exact R7 residuals

These are not authorized for R4 remediation:

- remove the RPC duration multiple-of-15 restriction and prove arbitrary positive minutes;
- add/lock server-authoritative payment resolution and `PAYMENT_NOT_CONFIGURED` for missing amount or recipient;
- implement the R2 scheduling primitive and collision/reschedule parity;
- implement authoritative readiness/config RPCs or schema additions described by R3;
- any WSTERA LAB migration, SQL/RPC/schema, shared-runtime, Order/Claim, PS01/MT01 or platform delta;
- DB/RPC authorization, tenant isolation, concurrency, rollback and runtime negative-test execution.

## 10. Source-vs-browser boundary and stop boundary

This review proves only repository state, source behavior, unit/static gates and production compilation. It does not prove mobile typing, real refetch/save behavior, customer E2E, PromptPay rendering on a real merchant target, deployment, or runtime server enforcement.

No product source, history, migration, runtime, deployment, branch, merge or remote state was changed. The sole authorized next action is Claude source remediation under the companion brief.
