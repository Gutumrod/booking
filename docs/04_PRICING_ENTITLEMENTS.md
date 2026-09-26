# BK01 Pricing & Entitlements

**Status:** FREE + BASIC PRICES APPROVED / PRO NOT ON SALE
**Owner decision:** 2026-09-26 (Addendum A item 1, referenced as "A-2") — supersedes the
2026-08-28 provisional pilot price points for the BK01 plans named below.
**Public paid launch:** BLOCKED until the BK-A feature gates and the remaining
entitlements listed as PENDING below are approved.

## Source of the numbers in this document
Every price and limit marked *(A-2)* below is taken verbatim from the Owner's
decision of 2026-09-26 recorded in
`06-Agent-Logs/WSTERA-House/briefs/BRIEF-HOUSE-SWARM-1-ADDENDUM-A-FREE-SIGNUP-2026-09-26.md`
§"คำตัดสินของ Owner ที่งานนี้ต้องทำตาม" item 1. Nothing else in this document is a
new Owner approval: any cell marked **PENDING** is inherited from the earlier
lock or is still unapproved and must not be marketed as final.

## Pricing policy
BK01 does not monetize database rows. Paid packaging is based on operational value,
provider/staff scope and variable-cost automation. The legacy paid booking limits of
100/500 bookings per month stay retired as customer-facing value walls. The Free plan
introduces one deliberate, approved booking wall: **50 bookings per month** *(A-2)*.

## V1 plans
| Plan | Public price | Booking capacity | Shops | Services | Staff/providers | LINE mode | Auto-slip | Intended use |
|---|---|---:|---:|---:|---:|---|---|---|
| Free | ฿0, forever *(A-2)* | **50 bookings / month** *(A-2)* | **1** *(A-2)* | **3** *(A-2)* | **PENDING** | WSTERA Central OA onboarding mode | manual verification | prove first value at no cost |
| Basic | **฿390 / month** or **$11 / month** *(A-2)* | effectively unlimited for normal ICP / fair-use protected | effectively unlimited for normal ICP | effectively unlimited for normal ICP | up to 5 **PENDING re-confirmation** | WSTERA Central OA included; merchant OA optional add-on | manual verification | small single-location teams |
| Pro | **NOT ON SALE — no approved price** *(A-2)* | not applicable while not on sale | not applicable | not applicable | up to 10 **PENDING re-confirmation** | not applicable while not on sale | automatic verification required before sale | teams needing lower manual deposit workload |

Notes on the table:
- The database stores the legacy identifiers `free_trial`, `basic_490` and `pro_990`
  in `local_service.subscriptions.plan` and `local_service.shops.requested_plan`.
  Renaming them needs a SQL migration that this work unit did **not** apply, so the
  identifiers are unchanged and must never be read as a price.
- Pro "exists in the product" *(A-2)* but must not be presented anywhere as
  purchasable, must not be selectable in any UI and must not be reachable through
  Stripe Checkout. `resolveMonthlyPlan()` returns `null` for it.
- The retired `฿490` and `฿990` pilot reference price points are **withdrawn** for
  BK01. They must not appear in any customer-facing or admin surface.
- Free has **no approved staff/provider allowance** and Basic/Pro staff allowances
  were never re-approved by A-2. They remain PENDING and are not asserted as final.

## Billing cadence
- Public V1 supports monthly Stripe subscription billing only.
- Annual billing is POST-V1 until separate annual Stripe prices, checkout behavior, portal
  behavior and webhook evidence exist.
- Registration UI must not imply an annual discount that checkout cannot fulfill.

## Booking fair use
Free is a hard, approved wall: a Free shop takes 50 bookings per calendar month *(A-2)*.
For Basic, "effectively unlimited" means BK01 does not stop a normal primary-ICP merchant
at 50, 100 or 500 bookings. A high operational ceiling/rate guard may be enforced for abuse,
runaway automation or platform protection, but it must not be marketed as a normal paid quota
and must be documented before enforcement.

## Staff entitlement
- **PENDING (not re-approved by A-2): maximum 5 active providers (Trial/Basic), maximum 10 (Pro).**
  These figures were carried over from the earlier lock; the Owner has not confirmed them
  under the Free/Basic plan structure. Do not market them as final.
- Inactive historical providers do not consume active-provider entitlement.
- Reactivation must enforce the same limit transactionally.

## LINE entitlement and cost ownership
- Default: WSTERA Central LINE OA is the standard notification path and is bundled with the
  monthly BK01 service.
- Merchant-owned LINE OA is optional, not required. If a merchant chooses its own OA, WSTERA
  treats setup/configuration/ongoing management as a paid add-on; the merchant remains
  responsible for its own LINE OA/message-plan charges.
- Exact Central OA fair-use/message allowance and merchant-OA add-on price remain **PENDING**
  the commercial lock; do not invent or market final numbers before that gate.
- BK01 must surface notification delivery/failure evidence regardless of who owns the OA.
- Custom token configuration must use a server-side secret boundary; no raw channel access
  token is stored in ordinary shop rows or exposed in the dashboard/client.

## Auto-slip entitlement
- Pro automatic slip verification is **V1 REQUIRED before Pro public sale**.
- Free may receive a small evaluation allowance only after provider/cost controls are
  implemented. **Whether a Free shop may take PromptPay deposits at all is an open Owner
  question** — see §Open questions.
- Basic remains manual verification in V1.
- Auto-slip usage and any top-up are separate from booking capacity.
- Exact monthly Pro allowance and top-up price are `PENDING COST EVIDENCE`; they cannot be
  marketed until provider unit cost and failure policy are documented.

## Free plan semantics
- Free is **not a trial**: it is a permanent plan with the 50 bookings / 1 shop / 3 services
  limits *(A-2)*. Whether a separate 14-day Basic trial is still needed is an open Owner
  question — see §Open questions.
- The limits are enforced server-side; a UI-only limit is not acceptable (LOCKED rule L-11).
- A shop over a Free limit must be told plainly why the action failed and what upgrading does.
- Free does not silently convert to paid: only a completed Stripe checkout/subscription event
  changes the plan.

## Upgrade, downgrade and cancellation
- Upgrade begins only from authoritative Stripe subscription state, never from client
  selection alone.
- Downgrade must preserve historical records; capabilities above the new entitlement become
  non-creatable/non-reactivatable rather than deleting data.
- Cancellation scheduled for period end keeps paid entitlement until authoritative period end;
  after cancellation/end, new online booking is blocked while historical data remains accessible
  according to account-retention policy.
- `past_due` may retain booking during a defined grace policy, but the final grace duration must
  be implemented and tested before public launch.

## Top-up semantics
Booking-count top-up from the legacy model is RETIRED for public paid packaging. Variable-cost
automation top-up may exist only for explicit managed LINE or automatic slip verification
credits, with authoritative ledger, idempotent purchase/application and visible balance.

## Price-lock gate
The Free and Basic price points are **approved** (Owner decision 2026-09-26, A-2): Free forever
at 50 bookings/month, 1 shop, 3 services; Basic at ฿390 or $11 per month. Basic is the only
purchasable BK01 plan today.

Still required before any further paid packaging opens:
- a Pro public price (currently none — Pro must not be marketed as purchasable),
- the V1 feature contract implemented,
- the variable-cost model and pilot willingness-to-pay evidence,
- a competitor refresh and explicit Owner approval.

Until each of those exists, the corresponding value stays PENDING and must not be represented
as final public pricing. The retired `฿490` / `฿990` pilot reference points are withdrawn for BK01.
