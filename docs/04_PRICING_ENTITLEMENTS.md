# BK01 Pricing & Entitlements

**Status:** LOCKED STRUCTURE / PRICE POINTS PROVISIONAL
**Owner decision:** 2026-08-28
**Public paid launch:** BLOCKED until final price approval + BK-A feature gates.

## Pricing policy
BK01 does not monetize database rows. Paid packaging is based on operational value, provider/staff scope and variable-cost automation. Legacy paid booking limits of 100/500 bookings per month are retired as customer-facing value walls.

## V1 plans
| Plan | Public price status | Booking capacity | Staff/providers | LINE mode | Auto-slip | Intended use |
|---|---|---:|---:|---|---|---|
| Trial | ฿0 / 14 days | 50 total evaluation bookings | up to 5 | WSTERA central OA onboarding mode | limited evaluation allowance, subject to provider readiness | prove first value |
| Basic | **Pilot reference ฿490/mo; not final** | effectively unlimited for normal ICP / fair-use protected | up to 5 | WSTERA Central OA included; merchant OA optional add-on | manual verification | small single-location teams |
| Pro | **Pilot reference ฿990/mo; not final** | effectively unlimited for normal ICP / fair-use protected | up to 10 | WSTERA Central OA included; merchant OA optional add-on | automatic verification required before sale | teams needing lower manual deposit workload |

## Billing cadence
- Public V1 supports monthly Stripe subscription billing only.
- Annual billing is POST-V1 until separate annual Stripe prices, checkout behavior, portal behavior and webhook evidence exist.
- Registration UI must not imply an annual discount that checkout cannot fulfill.

## Booking fair use
“Effectively unlimited” means BK01 does not stop a normal primary-ICP merchant at 100 or 500 bookings. A high operational ceiling/rate guard may be enforced for abuse, runaway automation or platform protection, but it must not be marketed as a normal paid quota and must be documented before enforcement.

## Staff entitlement
- Trial/Basic: maximum 5 active providers.
- Pro: maximum 10 active providers.
- Inactive historical providers do not consume active-provider entitlement.
- Reactivation must enforce the same limit transactionally.
## LINE entitlement and cost ownership
- Trial/Basic/Pro default: WSTERA Central LINE OA is the standard notification path and is bundled with the monthly BK01 service.
- Merchant-owned LINE OA is optional, not required. If a merchant chooses its own OA, WSTERA treats setup/configuration/ongoing management as a paid add-on; the merchant remains responsible for its own LINE OA/message-plan charges.
- Exact Central OA fair-use/message allowance and merchant-OA add-on price remain pending the commercial lock; do not invent or market final numbers before that gate.
- BK01 must surface notification delivery/failure evidence regardless of who owns the OA.
- Custom token configuration must use a server-side secret boundary; no raw channel access token is stored in ordinary shop rows or exposed in the dashboard/client.

## Auto-slip entitlement
- Pro automatic slip verification is **V1 REQUIRED before Pro public sale**.
- Trial may receive a small evaluation allowance only after provider/cost controls are implemented.
- Basic remains manual verification in V1.
- Auto-slip usage and any top-up are separate from booking capacity.
- Exact monthly Pro allowance and top-up price are `PENDING COST EVIDENCE`; they cannot be marketed until provider unit cost and failure policy are documented.

## Trial semantics
- Trial starts at successful shop provisioning and runs 14 days.
- Trial is blocked after its authoritative end timestamp; missing/invalid subscription truth fails closed for public booking acceptance.
- Trial does not silently convert to paid without a completed Stripe checkout/subscription event.

## Upgrade, downgrade and cancellation
- Upgrade begins only from authoritative Stripe subscription state, never from client selection alone.
- Downgrade must preserve historical records; capabilities above the new entitlement become non-creatable/non-reactivatable rather than deleting data.
- Cancellation scheduled for period end keeps paid entitlement until authoritative period end; after cancellation/end, new online booking is blocked while historical data remains accessible according to account-retention policy.
- `past_due` may retain booking during a defined grace policy, but the final grace duration must be implemented and tested before public launch.

## Top-up semantics
Booking-count top-up from the legacy model is RETIRED for public paid packaging. Variable-cost automation top-up may exist only for explicit managed LINE or automatic slip verification credits, with authoritative ledger, idempotent purchase/application and visible balance.

## Price-lock gate
Final Basic/Pro public prices require: V1 feature contract implemented, variable-cost model, pilot willingness-to-pay evidence, competitor refresh and owner approval. Until then, ฿490/฿990 are pilot/reference price points only and must not be represented as final public pricing.
