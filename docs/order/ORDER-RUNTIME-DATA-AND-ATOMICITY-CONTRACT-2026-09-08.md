# BK01 Order runtime data and atomicity contract

Status: RUNTIME-BLOCKED. This document is not executable SQL.

Future product-local entities are shop_capabilities, shop_order_settings, order catalog data, orders, order_items, production_weekly_schedule, production_day_overrides, capacity_reservations and booking_order_links. Every private relation is shop_id scoped; cross-shop IDs must be rejected by FK/RPC authorization.

The authoritative confirmation transaction must atomically persist immutable item snapshots, money/deposit totals, scheduled production date, capacity reservation and promised ready date. It must own the idempotency key and return no success after a partial failure.

Mandatory post-gate database probes: concurrent confirms cannot exceed capacity; retries reserve once; eligible cancellation releases once; cross-shop catalog/order/link IDs fail; settings races serialize under one lock/transaction strategy; and partial confirmation never returns success.
