# BK01 Order — Product Boundary Decision

**Date:** 2026-09-05 (Asia/Bangkok)
**Status:** LOCKED — Owner decision / Phase 0A
**Product:** BK01 — Booking by WSTERA
**Authority:** Later explicit Owner decision; additive to the 2026-08-28 locked Booking contract.

## Decision

BK01 expands from appointment-only framing into a modular **Business Portal foundation** with independent capabilities:

```text
BK01
├── Booking
├── Order
└── future Claim / Case integration
```

This decision does not erase or rewrite the historical Booking V1 contract. Booking remains the sole authority for appointment date/time, provider availability, duration, collision prevention and Booking lifecycle.

## Bounded ICP

Order may support Thai SMB workflows that are made-to-order, pre-order, production-to-ready, service+product, or Order-only.

This expansion does **not** authorize BK01 to become a generic e-commerce, marketplace, POS, ERP, warehouse, inventory, shipping or accounting platform.
## Capability activation

The target contract may use shop-level capability flags:

- `booking_enabled`
- `order_enabled`
- `claim_enabled`

Existing `shops`, `shop_users` and `shop_id` remain the tenancy model. Do not rename the current implementation merely to introduce the word tenant.

Disabling a capability stops new intake for that capability but must preserve existing business history and authorized access to historical records.

## Authority map

| Domain | Authority |
|---|---|
| Appointment availability / staff / time / duration / collision | Booking |
| Product/made-to-order catalog | Order, using canonical catalog reuse |
| Order lifecycle / production lead / capacity / ready date | Order |
| Booking deposit state | Booking |
| Order payment operational state | Order |
| Subscription/billing | Existing BK01 subscription boundary; no new duplicate engine |
| Claim/case lifecycle | Future capability owner; not assumed to be CM01 runtime |

Order may link to Booking only through Booking's existing authoritative availability/collision rules.
## Document treatment

- Preserve `00_PRODUCT_VISION.md`, `01_PRD.md`, `02_SYSTEM_ARCHITECTURE.md`, `03_DATA_SECURITY_TENANCY.md` and `05_BOOKING_DOMAIN_RULES.md` as historical locked Booking contracts.
- This dated decision supersedes only the appointment-only product-boundary framing where it conflicts with the approved additive Order capability.
- Order requirements live in dated Order documents/addenda; do not rewrite historical files to make Order appear retroactive.
- Prototype remains frozen exploration evidence and is not production source.

## Sequencing

Booking core is the active heavy track. Order Phase 0A/0B is the bounded documentation track.

Default implementation order:

`BK-A/CONT-04 -> BK-B -> Booking release/pilot decision -> Order implementation`

An earlier Order implementation requires all exceptional-entry conditions recorded in the Phase 0 execution plan and a new explicit Owner overlap/risk authorization.

## Phase 0A result

**PASS / LOCKED.** Product boundary, ICP fence, authority split, capability intent, document treatment and sequencing are sufficiently decided for Phase 0B contract work.

**BUILD AUTHORIZATION:** NO for Order production implementation.