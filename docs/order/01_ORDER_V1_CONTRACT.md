# BK01 Order V1 Contract

**Date:** 2026-09-05
**Status:** LOCKED — Phase 0B contract
**Scope:** Order capability only; additive to existing Booking V1
**Build authorization:** NO

## V1 customer flow

```text
Catalog
-> Ready-date selection
-> Customer details
-> Deposit / payment evidence when configured
-> Submit / confirm
-> Track Order
-> READY
-> Pickup / Delivery OR create Booking if appointment required
```

Public Order intake does not require a customer account. Phone may be used as a tenant-local matching/dedup key but is not authentication or global identity.

Public tracking uses an opaque/signed tracking token. Never expose "enter phone -> list all orders" behavior.
## Order lifecycle

Canonical V1 target:

- `DRAFT`
- `SUBMITTED`
- `CONFIRMED`
- `IN_PROGRESS`
- `READY`
- `COMPLETED`
- `CANCELLED`

`SUBMITTED` represents customer intent before merchant acceptance when a made-to-order job requires review. `CONFIRMED` means the merchant accepted the order contract and required production capacity is reserved.

Invalid direct transitions must fail closed. State changes are attributable and auditable. Terminal-state reopen/recovery requires an explicit privileged action and reason.

## Payment state

Order payment is a separate operational state domain:

- `UNPAID`
- `PARTIALLY_PAID`
- `PAID`
- `REFUNDED`

Deposit/slip verification is separate again: `PENDING | VERIFIED | REJECTED`.
Order payment status is **not** a payment engine, subscription system or billing-core replacement. Order and Booking payment/deposit states are never auto-merged.

Booking deposit remains authoritative on the Booking side. An Order-linked Booking follows the Booking service/policy; prior Order payment must not silently waive or settle Booking deposit.

## Catalog contract

Order catalog is separate from Booking `services`.

Catalog master data is sourced from the canonical Product Catalog module contract through copy-and-own reuse. BK01 adaptation may add Order-specific fields such as:

- production lead days;
- capacity units;
- deposit configuration;
- fulfillment type;
- appointment-required flag.

Do not activate generic stock/inventory semantics merely because the reusable catalog type contains stock fields. Inventory is outside Order V1.

At confirmation, every order line snapshots name, SKU/reference, unit price, quantity, lead days, capacity units and deposit-relevant values so later catalog edits cannot rewrite historical orders.
## Production readiness semantics

V1 uses day-level production capacity, not appointment slots or physical-resource scheduling.

```text
Lead Time
+ Workshop Calendar
+ Available Production Capacity
= Earliest Available Ready Date
```

Required order capacity = `SUM(qty * capacity_units_snapshot)`.

Required lead = `MAX(lead_days_snapshot)` across order lines.

V1 uses **single target-day allocation**: one confirmed order reserves its required units against one scheduled production date. Do not distribute one order across multiple production days in V1.

Required dates:

- `earliest_ready_date`
- `requested_ready_date`
- `scheduled_production_date` (nullable until allocated)
- `promised_ready_date`

Customer UI must never expose raw capacity units. It may expose available/full/closed and available ready dates.
## Capacity reservation invariants

Confirmation is atomic. A successful `CONFIRMED` order must have, in the same authoritative transaction:

- immutable item snapshots;
- computed total/deposit amounts;
- selected production date;
- capacity reservation;
- promised ready date.

Concurrent confirmations must never make `reserved_units > effective_capacity` for a production date.

Cancellation of a confirmed-but-not-started order releases its reservation atomically. Cancellation/reduction after `IN_PROGRESS` requires explicit merchant action and audit because physical work may already exist.

Moving an order to `READY` does not rewrite historical capacity evidence. Manual ready-date override requires actor, reason, previous value and new value in audit history.

Calendar/capacity setting changes apply to future confirmations by default and must not silently rewrite already-promised orders.
## Conceptual data contract

The implementation contract should map onto the existing `shop_id` tenancy model. Minimum conceptual entities:

- `shop_capabilities` — Booking / Order / future Claim intake toggles;
- `shop_order_settings` — default lead/capacity/deposit/contact behavior;
- Order catalog tables/adapters — catalog master data plus Order-specific production attributes;
- `orders` — lifecycle, payment state, ready dates, fulfillment and tracking token;
- `order_items` — immutable commercial/production snapshots;
- `production_weekly_schedule` and `production_day_overrides`;
- `capacity_reservations` — order/date/units reservation evidence;
- `booking_order_links` — many-to-many-capable relation.

Exact SQL/table names are implementation design details, but these ownership boundaries and invariants are contract requirements.
## Fulfillment and Booking integration

Canonical fulfillment modes:

- `PICKUP`
- `DELIVERY`
- `ON_SITE_SERVICE`

`appointment_required` is explicit. A product/order requiring installation or service uses `ON_SITE_SERVICE` + `appointment_required=true`.

An appointment may be created only when the Order is `READY`. The create flow delegates to the existing Booking engine for service, provider/Any Staff, date, time, duration, closures and collision checks.

Order-linked Booking has no priority and no bypass. It must obey the same authoritative availability rules as normal Booking.

One Order may link to more than one Booking (for example measurement and installation). Booking completion does not automatically complete Order. Order completion remains an explicit Order-domain action.
## Security, authorization and audit

- Every private Order read/write is scoped to authorized `shop_id` membership and role.
- Public catalog/intake/tracking surfaces expose only fields required for the public flow.
- Tracking tokens must be opaque, non-sequential, revocable/rotatable if compromised, and never derived from phone/email/order number alone.
- Public mutation endpoints must validate the target Order and allowed state transition server-side; browser state is advisory only.
- Merchant mutations, capacity overrides, payment/slip review, Order cancellation/reopen, capability changes and Order↔Booking link changes are auditable.
- SECURITY DEFINER/RPC patterns must preserve existing BK01 pinned-search-path, explicit authorization and minimum-grant rules.
- Cross-shop references are rejected; Order item/catalog/link foreign keys must not permit a row from another shop to be attached.

Order capability must not weaken the existing Booking RLS/authorization contract or broaden platform-operator access.
## Failure, concurrency and idempotency

- Duplicate public submit/retry must not create duplicate accepted Orders.
- Confirmation retry must return/recover the same authoritative result or fail safely; it must never reserve capacity twice.
- Concurrent confirmations for the same production date are serialized/guarded at the database boundary.
- Capacity/calendar changes racing confirmation must resolve against one authoritative transaction snapshot/lock strategy.
- Booking-link creation retry must not create duplicate logical links or bypass Booking collision checks.
- Provider/payment/slip timeout or unknown result remains reviewable and never invents `PAID` or `VERIFIED`.
- Partial failure after confirmation must be detectable and reconcilable; no successful response may be returned without the required reservation and promised-date state.

## Capability disable behavior

When `order_enabled=false`, new public Order intake and new merchant Order creation stop. Existing Orders, payments, audit history and authorized operational actions remain accessible according to lifecycle/security rules.

Disabling Booking must not destroy existing Booking links. Disabling future Claim capability must not delete historical case references.
## Explicit V1 non-goals

Order V1 does not include:

- inventory/warehouse or stock reservation;
- supplier/purchase-order workflows;
- ERP, POS, payroll or accounting;
- shipping/carrier engine or marketplace sync;
- BOM, routing or multi-stage manufacturing planning;
- lift/bay/room/equipment scheduling;
- generic resource-booking or buffer engine;
- automatic Booking→Order completion;
- automatic cross-module payment aggregation/settlement;
- a second appointment scheduler;
- a duplicate Claim/Case lifecycle.

A future need for any item above requires a separate product/architecture decision and applicable reuse/gates.
## V1 acceptance contract

Before Order implementation can be considered complete, evidence must prove at minimum:

1. cross-shop read/write/link denial;
2. valid lifecycle transitions and rejection of invalid transitions;
3. immutable Order-line snapshots after confirmation;
4. concurrent confirmations cannot overbook day capacity;
5. cancellation/reduction releases or preserves capacity according to lifecycle rules;
6. ready-date calculation respects lead days, open/closed calendar and available capacity;
7. public tracking token does not expose another customer's Order;
8. capability disable stops new intake and preserves history;
9. Order-linked Booking uses normal Booking availability/collision authority;
10. Booking and Order payment/lifecycle states remain independent;
11. retries are idempotent on Order confirmation and link creation;
12. all privileged overrides and critical money/capacity/link mutations have attributable audit evidence.

## Phase 0B result

This contract closes the product/domain design required for Phase 0B. Implementation remains governed by the separate Reuse Gate and Codex BK-A/B sequencing prerequisites.

**ORDER V1 CONTRACT:** LOCKED

**BUILD AUTHORIZATION:** NO