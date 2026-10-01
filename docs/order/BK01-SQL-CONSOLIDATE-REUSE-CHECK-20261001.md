# BK01 SQL Consolidation — Module Reuse Check

**Task:** `HOUSE-BK01-SQL-CONSOLIDATE`  
**Repository base:** `codex/bk01-queue-lock-20261001` @ `f97642cc6a8ed950b528ed40d2e498fc8213c48e`  
**Module Hub inspected:** `D:\AI-Workspace\projects\modules-hub` @ `cd88c570ab57f6976d15f85d09973d0cfbf0cd63`  
**Date:** 2026-10-01

## Gate

- Module Reuse Check: COMPLETE
- MT01 Bootstrap Check: PASS — existing BK01 check inspected at `docs/order/03_MT01_BOOTSTRAP_CHECK.md`; retain BK01's existing shop membership, Auth, RLS, and RPC authority. MT01 remains a reference and is not a runtime dependency.
- Reuse Gate: PASS for the product-local SQL scope below. Recipient lookup and daily email-summary specifications are separately on HOLD under the BK01 migration policy. Shop-owner email enqueue and event-type changes are also held because the existing consumer routes `shop_owner` through the LINE OA recipient field.

## Required Capabilities

| Capability | Decision | Evidence / boundary |
|---|---|---|
| Booking policy defaults, owner-only policy update, outcome timing, and reschedule overlap cleanup | MISSING CAPABILITY | These are BK01-specific rules over `local_service.shops` and `local_service.bookings`; Module Hub has no migration or booking-domain SQL module. Existing BK01 tenant membership and policy functions remain authoritative. |
| Refund record and refund audit history | MISSING CAPABILITY | Uses existing BK01 `local_service.audit_events`, booking columns, and `local_service_internal.request_user_id()` contract. No shared module owns these product rows or RPC semantics. `enforce_booking_status_transition` remains untouched. |
| Stale-reminder claim predicate and expired-row retirement | MISSING CAPABILITY | BK01 owns the notification table and claim behavior. This product-local rule does not use a generic provider-send abstraction. |
| Shop-owner email enqueue and event-type changes | REJECT WITH JUSTIFICATION | The current dispatcher consumes all claimed `line_notification_logs` rows as LINE events and resolves `shop_owner` to `shops.line_oa_id`. Enqueuing the specified email event without the email consumer contract would send it to the wrong route. Held until the consumer/email route is in scope and tested. |
| Customer booking status protected by recovery token | MISSING CAPABILITY | Uses BK01's existing recovery authorization helper and booking fields. No reusable Module Hub SQL capability matches this token contract. |
| Shop recipient email lookup and daily email summary | REJECT WITH JUSTIFICATION | The supplied SQL design reads `auth.users`; `supabase/bk01-migrations/README.md` forbids product-local migrations from depending on `auth` or reading `auth.users` unless a separately declared, reviewed shared-surface exception exists. No such exception is in scope or present in the references. The specified implementation is therefore held pending a controller/platform decision. |

## Module Decisions

| Candidate inspected | Version / source | Decision | Technical reason |
|---|---|---|---|
| `modules/notification` | 0.2.0, Module Hub commit `cd88c570ab57f6976d15f85d09973d0cfbf0cd63` | REJECT WITH JUSTIFICATION | Contract accepts an event and sends it to an injected webhook provider. It does not provide BK01's SQL outbox, tenant-scoped claims, Postgres triggers, or database role grants. Copying it would not implement this migration. |
| `modules/audit-log` | 0.1.0, same Module Hub commit | REJECT WITH JUSTIFICATION | It is a TypeScript audit client/store abstraction. The required refund history is already governed by BK01's SQL `audit_events` table and shop-scoped RLS/RPC boundary; replacing or duplicating that trail is unsafe and unnecessary. |
| `modules/auth-supabase` | 0.2.0, same Module Hub commit | NOT APPLICABLE | It is an application-side TypeScript helper and cannot grant a BK01 product migrator access to the managed `auth` schema. The existing BK01 SQL identity and membership helpers remain the authority. |
| `modules/tenant-context` | 0.3.0, same Module Hub commit | NOT APPLICABLE | BK01 already has locked `shop_id` / `shop_users` tenancy and existing membership helpers. Introducing another tenant context would duplicate authority and violate the existing product boundary. |

## Missing Capabilities

Only the BK01-specific SQL changes in this task are eligible for implementation. The recipient-email lookup and daily email summary remain held because their supplied data-source contract conflicts with the product-local migration policy. Shop-owner email enqueue remains held because its consumer path is not compatible with the existing LINE dispatcher. No fallback to `service_role`, broad schema access, or caller-supplied email is authorized.

The refund write/history RPCs enforce owner/admin authorization, matching the refund surface that hides those actions from staff. The supplied addendum uses `is_shop_member()`; the narrower owner/admin boundary is retained to prevent staff from marking financial refunds and should be confirmed by the controller during review.

## Provenance Plan

No Module Hub code is copied. The inspected modules are not suitable bases for this SQL migration, so there is no copy provenance to record and no upstream repository will be modified.
