# WUA1-PLAN-CODE — BK01 plan definitions as code and documentation

Work unit: `H1-WUA1-PLANS` (repaired under `H1-WUA1-R2-REPAIR`) · correlation id `house-swarm-1-wua1-r2-20260926`
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wua1`
Branch: `feature/house-swarm-1-wua1-plans`
Base revision: `37053d35cd7392419c341eeae03a9c1193ed41b7`
Author: swarm-builder (Hermes Native Swarm worker, role class implementation)

Status of this note: COMPLETE.
Nothing in this note is self-approved; the commander verifies.

---

## 1. Owner-approved plan definitions (the only authority for numbers here)

Source: `BRIEF-HOUSE-SWARM-1-ADDENDUM-A-FREE-SIGNUP-2026-09-26.md` §คำตัดสินของ Owner ข้อ 1
(Owner decision 2026-09-26, referenced as "A-2").

| Plan | Approved value |
|---|---|
| Free | forever, **50 bookings / month**, **1 shop**, **3 services** |
| Basic | **฿390 / month** or **$11 / month** |
| Pro | exists in the product but **must not be presented anywhere as purchasable** |

Anything not in that list (provider/staff counts, trial length, message allowances,
add-on prices, annual pricing, Pro's future price) is **NOT approved by this work unit**
and is therefore left untouched and reported as an open item.

---

## 2. IMPLEMENTED (in this worktree, reviewable code + docs)

### 2.1 The plan contract — `apps/booking-admin/src/lib/commercial-contract.ts`
- `FREE_PLAN_BOOKINGS_PER_MONTH = 50`, `FREE_PLAN_SHOPS = 1`, `FREE_PLAN_SERVICES = 3`,
  `BASIC_PLAN_PRICE_THB = 390`, `BASIC_PLAN_PRICE_USD = 11`, all exported so UI and tests
  read the same constants.
- `PLAN_PRICE_STATUS = 'owner-approved-2026-09-26'` records the provenance of every number.
- `pro_990` carries `priceThb: null`, `priceUsd: null`, `isPurchasable: false` and
  `priceEnvName: null`, so no caller can derive a saleable Pro price from the legacy
  identifier.
- `resolveMonthlyPlan()` — the gate the Stripe checkout route uses — returns non-null only
  for Basic. Pro, Free, annual identifiers and `undefined` all return `null`.
- `evaluatePlanLimit(plan, metric, usage)` — a pure, database-free mirror of the
  entitlement gate. `allowed` is true only while `usage < limit`; a `null` limit is never a
  wall. This is the function the two boundary tests exercise.

### 2.2 Admin surfaces no longer sell or preselect Pro
- **Dashboard plan card** (`apps/booking-admin/src/app/dashboard/page.tsx`): the Pro card
  shows no `฿990`, shows a "not on sale" badge instead, and its Stripe Checkout button was
  removed and replaced with a non-interactive "not on sale" panel. `handleUpgrade` is typed
  to `'basic_490'`, so `handleUpgrade('pro_990')` no longer compiles.
- **Platform-admin plan selector** (`apps/booking-admin/src/app/platform-admin/page.tsx`):
  the `pro_990` `<option>` is `disabled`, labels no longer print `990/ด.` or `490/ด.`,
  Basic reads `฿390` from the contract constant, and the MRR tile counts only Basic
  (a Pro shop contributes 0 rather than the retired ฿990).
- **Registration plan step** (`apps/booking-admin/src/app/register/page.tsx`): the Pro
  card is non-clickable (`aria-disabled`), carries no price and no select handler, so
  `?plan=pro_990` can never preselect it. The Free and Basic cards state the approved
  limits and the `฿390` price.
- **Billing client** (`apps/booking-admin/src/lib/admin-service.ts`):
  `startBillingCheckout(plan: 'basic_490')` — the `| 'pro_990'` arm was removed.
- **Message catalogues** (`apps/booking-admin/messages/th.json`, `en.json`): every
  `490`/`990` reference is gone (verified by test); Free is described as forever with
  50/1/3, Basic as `฿390`/`$11`, Pro as "not on sale" with no price.

### 2.3 Documentation
- `docs/04_PRICING_ENTITLEMENTS.md` now states Free forever at 50 bookings/month, 1 shop,
  3 services and Basic at ฿390 / $11, with the Owner decision of 2026-09-26 (A-2) recorded
  as the source. Everything A-2 did not approve is explicitly marked **PENDING** rather
  than silently re-asserted.

### 2.4 Tests
- The two required boundaries are covered by named tests in
  `tests/commercial-contract.test.ts`:
  - `booking-limit boundary: a Free shop books while under 50 and is blocked at 50 or above`
    (49 → allowed; 50 → `BOOKING_QUOTA_EXCEEDED`; 51 → blocked; Basic unlimited).
  - `service-limit boundary: a Free shop adds a 3rd service but not a 4th`
    (usage 2 → allowed; usage 3 → `SERVICE_LIMIT_EXCEEDED`; usage 4 → blocked).
  - plus a shop-limit boundary (1 allowed, 2nd blocked).
- Source-level guards assert that no admin surface can call
  `handleUpgrade('pro_990')`, `setSelectedPlan('pro_990')` or start a Pro checkout, and
  that no admin code or catalogue still contains `490`/`990` as a plan price.

---

## 3. PROPOSED only — written down, deliberately NOT activated

These were considered so the boundary stays reviewable, but nothing here is turned on:

1. **Wiring the limit warning into the dashboard UI.** The catalogue already carries
   `usageLimitTitle` / `usageLimitBookings` / `usageLimitServices` / `usageLimitUpgrade`,
   but no component renders them yet, because the dashboard does not yet fetch an
   authoritative monthly booking count or a service count that the server has gated.
   Showing a wall the server does not enforce would be a cosmetic lie (LOCKED rule L-11),
   so this stays proposed until §5 exists.
2. **Surfacing Free-plan usage against 50/1/3 in the admin UI** in the same way.
3. **A `/pricing` comparison page** for TH/EN (WU-A2 of Addendum A). Not started here;
   this work unit only brought the existing surfaces in line.
4. **Renaming the legacy plan identifiers.** Keeping `free_trial` / `basic_490` /
   `pro_990` as storage keys is a deliberate decision, not an oversight — see §5.

---

## 4. Files changed

| File | One-line reason |
|---|---|
| `apps/booking-admin/src/lib/commercial-contract.ts` | Owner-approved plan identity, prices (Free 50/1/3, Basic ฿390/$11), Pro not purchasable, and the pure `evaluatePlanLimit` boundary helper. |
| `apps/booking-admin/src/app/dashboard/page.tsx` | Imports `BASIC_PLAN_PRICE_THB`; Pro card loses the ฿990 price and the Stripe Checkout button; `handleUpgrade` restricted to Basic. |
| `apps/booking-admin/src/app/platform-admin/page.tsx` | Plan labels show ฿390 / "not on sale"; MRR counts only Basic; the `pro_990` selector option is disabled. |
| `apps/booking-admin/src/app/register/page.tsx` | Free/Basic cards state approved values; Pro card is non-selectable and unpriced; `?plan=pro_990` cannot preselect Pro. |
| `apps/booking-admin/src/lib/admin-service.ts` | `startBillingCheckout` accepts only `'basic_490'`, so Pro checkout no longer typechecks. |
| `apps/booking-admin/messages/th.json` | Thai copy updated to Free forever 50/1/3 and Basic ฿390/$11; all 490/990 references removed; Pro marked not on sale. |
| `apps/booking-admin/messages/en.json` | English copy updated for the same approved values; all 490/990 references removed. |
| `tests/commercial-contract.test.ts` | Asserts the approved values, the Pro-not-purchasable rule, and the booking/service/shop boundary decisions. |
| `tests/public-contract.test.ts` | Replaces the retired pilot-pricing assertion with the approved Free/Basic values and a Pro-preselect guard. |
| `docs/04_PRICING_ENTITLEMENTS.md` | Approved Free and Basic values with the Owner decision (A-2) as the recorded source; unapproved values marked PENDING. |
| `docs/house-swarm-1/WUA1-PLAN-CODE.md` | This note. |

No file was created or modified outside `apps/booking-admin/src/`, `apps/booking-admin/messages/`,
`tests/` and `docs/`.

---

## 5. NOT APPLIED — server-side / SQL enforcement still required

This is the most important section of the note. **The plan limits exist in TypeScript only;
nothing in this work unit enforces them against real data.** No SQL was written, no
migration was run, no database connection was opened.

Required before the Free plan can be described as enforced:

1. **Booking quota (50/month).** Needs an authoritative count of non-cancelled bookings per
   shop per calendar month and a transactional refusal at insert/hold time — the same shape
   as the existing `create_booking_hold` gate. The booking path must raise
   `BOOKING_QUOTA_EXCEEDED` and the customer UI must explain it and how to upgrade.
   A client-side or render-time check would be bypassable and is explicitly not acceptable.
2. **Service limit (3).** Needs a check inside the service-creation SQL path (and the
   reactivation path, per the existing entitlement convention) so a 4th active service
   cannot be created by a direct API call.
3. **Shop limit (1).** Needs the same transactional treatment for a second shop on a Free
   owner.
4. **SQL error code contract.** The codes the TypeScript mirrors
   (`BOOKING_QUOTA_EXCEEDED`, `SHOP_LIMIT_EXCEEDED`, `SERVICE_LIMIT_EXCEEDED`) must be the
   codes the server actually raises, or `evaluatePlanLimit` is documentation rather than a
   mirror.
5. **Pro unpurchasability at the data layer.** The UI and the checkout route now refuse Pro,
   but the `plan` CHECK constraint still permits `pro_990`, and `platform_admin_update_plan`
   can still be called with it directly. A server-side rejection belongs in that RPC.
6. **Plan identifier rename (optional).** `free_trial` now means "Free forever", which is a
   misleading storage key, and `basic_490` / `pro_990` embed retired prices in identifiers.
   Renaming them is a migration and is therefore out of scope for this unit.
7. **Stripe webhook mapping.** `mapPriceIdToPlan` still maps `STRIPE_PRICE_PRO` → `pro_990`.
   That is harmless for a subscription that cannot be created, but the env var should be
   removed/ignored as part of the Pro-not-on-sale work.

Because of items 1–3, the dashboard limit messaging described in §3 stays proposed.

---

## 6. Open questions with recommendation

Both below affect money or the offer, so **they are Owner decisions, not worker decisions.**
Neither was actioned; the recommendations are proposals only.

### 6.1 May a Free-plan shop take PromptPay deposits? — ⚑ OWNER FLAG
- **Current state:** nothing forbids it. A Free shop can configure a PromptPay recipient
  and generate deposit QR codes today.
- **Recommendation:** **No** — reserve PromptPay deposits for Basic, and make that the
  concrete reason to upgrade. It is a clean, visible upgrade driver, and deposit handling is
  the workflow that creates support load.
- **Why the worker did not decide:** it is an entitlement change that alters what the Free
  plan is worth, and Addendum A lists deposit entitlement under the "ask the Owner" set.
- **Cost of guessing wrong:** if Free keeps deposits, a later removal takes a capability away
  from shops already using it; if Free loses them, shops that already rely on deposit QR
  codes would be forced to upgrade.

### 6.2 Is the 14-day Basic trial still needed? — ⚑ OWNER FLAG
- **Current state:** the plan selector now offers Free and Basic only. The trial machinery
  (`trialing` status, `extendShopTrial`, the platform-admin "Trialing" tile) still exists in
  the codebase and is untouched.
- **Recommendation:** **Retire the separate Basic trial.** The Free plan is a genuinely
  permanent free tier with 50 bookings/month, so a time-boxed Basic trial no longer adds
  anything a prospect cannot already do for free — it only adds a conversion deadline the
  product then has to enforce.
- **Why the worker did not decide:** removing trial semantics touches billing/entitlement
  behaviour and existing shops' `trialing` state; Addendum A explicitly asks the Owner.
- **Cost of guessing wrong:** removing the trial changes the offer and may strand shops
  currently `trialing`; keeping it leaves two overlapping onboarding paths to maintain.

---

## 7. Evidence statements

- The admin typecheck was clean after the repair: `npx tsc --noEmit -p apps/booking-admin/tsconfig.json` → exit 0.
- Before the repair it reported 4 errors, 3 of them introduced by the previous attempt and 1 a pre-existing codegen artifact (see below).
- `npx next typegen` was run inside `apps/booking-admin` (and `apps/booking-consumer`) to generate the
  `.next/types` route types that `LayoutProps` comes from. Both apps' tsconfigs already declare
  `.next/types/**/*.ts` in `include`, and `.next/` / `next-env.d.ts` are gitignored build artifacts.
  The identical `LayoutProps` error reproduces in the untouched consumer app, so it is a
  missing-codegen artifact of this worktree, not damage from the previous attempt.
- The full test suite passed: `npm run test` → exit 0, 130 tests, 130 pass, 0 fail.
- Lint passed: `npm run lint` → exit 0, 0 errors, 6 warnings (all pre-existing;
  `planLabel` in `platform-admin/page.tsx` was already unused at the base revision).
- The two boundary tests exist by name and passed — see §2.4.
- **No database connection was opened, no migration was run, no deploy occurred, no `.env`
  file was read, created or modified, and no commit or push was made.** No command that
  could reach Postgres or Supabase was executed. No file under `supabase/` or any `.sql`
  file was touched.
