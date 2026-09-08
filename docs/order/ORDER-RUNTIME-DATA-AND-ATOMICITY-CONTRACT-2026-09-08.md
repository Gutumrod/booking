# BK01 Order runtime data and atomicity contract

**Status:** `RUNTIME-BLOCKED` — design contract only; this file is not executable SQL and does not prove live database behavior.

## Trust and ownership

- Every private row and repository/RPC call is scoped by `shop_id` derived from a trusted server-side shop lookup. A client-provided shop ID is never authorization.
- Public submit accepts catalog product IDs and quantities, not prices, lead time, capacity, deposit, lifecycle, payment state, or line snapshots. The server reloads active catalog records and constructs snapshots.
- Tracking uses a cryptographically random opaque token. Store only a one-way token hash where practical, rate-limit lookup, and never support phone-only enumeration.
- Service-role/provider credentials remain server-only. Customer input cannot set internal lifecycle, payment verification, deposit verification, promised date, or audit actor.

## Conceptual entities

- `shop_order_settings`: one row per shop; capability/intake state and default Order rules.
- `order_catalog_products` and related category/brand/variant/attribute/media relations: shop-owned Product Catalog persistence. Inventory fields are not exposed or activated in V1.
- `production_weekly_schedule`: one rule per `(shop_id, weekday)` with open/closed state and base capacity.
- `production_day_overrides`: at most one row per `(shop_id, production_date)` with closure or effective-capacity override.
- `orders`: shop-owned lifecycle, operational payment state, deposit verification state, requested/promised dates, fulfillment, appointment requirement, customer data, totals, and immutable confirmation metadata.
- `order_items`: immutable confirmed snapshots linked to one Order; catalog source ID is reference context, never a live-price dependency.
- `capacity_reservations`: one active logical reservation per confirmed Order and target production day, including reserved units and release metadata.
- `booking_order_links`: many links per Order, unique per `(shop_id, order_id, booking_id)`, with idempotency/audit metadata.
- `public_order_tokens`: unique token hash linked to one shop/Order, with expiry/revocation/attempt metadata as required.
- `order_idempotency_keys` or equivalent RPC-owned claims: unique in the operation scope and bound to a request fingerprint/result.
- `order_audit_events`: append-only actor, reason, transition/override, timestamp, and request correlation metadata.

Foreign keys must prevent cross-shop catalog, Order, reservation, token, and Booking references. Expected query indexes cover shop + lifecycle/date list views, shop + promised date, reservation day, unique tracking-token hash, and idempotency lookup. Exact SQL and index names belong to the separately authorized post-gate migration.

## Authoritative confirmation transaction

A single database transaction/RPC must:

1. claim the idempotency key and reject fingerprint reuse;
2. lock/read the Order, shop settings, active catalog sources, calendar/override, and target capacity under one documented isolation/locking strategy;
3. validate shop ownership and allowed lifecycle transition;
4. rebuild immutable line snapshots and safe integer totals/deposit on the server;
5. compute lead/capacity and choose or validate one production day;
6. reject if effective capacity would be exceeded;
7. persist snapshots, totals/deposit, selected production date, exactly one reservation, promised ready date, lifecycle `CONFIRMED`, and audit event;
8. persist the idempotent result before commit and return success only after commit.

Cancellation before production must release the reservation and append audit exactly once in one transaction. Settings edits must not silently recompute existing confirmed promises. Ready-date override requires a privileged actor and non-empty reason.

## Mandatory post-gate probes

1. concurrent confirms cannot exceed effective capacity;
2. retry cannot create a second Order or reservation;
3. eligible cancellation releases exactly once, including concurrent retries;
4. cross-shop catalog/order/token/link identifiers fail;
5. settings/calendar races resolve under the chosen transaction strategy;
6. injected partial failure cannot return confirmation success;
7. public tokens cannot enumerate or expose private Order/customer fields;
8. `order_enabled=false` blocks new intake while preserving authorized history reads.

All eight remain `RUNTIME-BLOCKED` until product-local migrations, RLS/grants, RPCs, and live adapters are separately authorized and exercised against a clean database.
