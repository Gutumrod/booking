# BK01 System Architecture

**Status:** LOCKED TARGET V1 — 2026-08-28

## Runtime topology
BK01 remains a two-application/two-Worker product behind canonical technical host `bk01.wstera.com`:
- **Consumer Worker** — public booking experience, booking RPC calls, LINE webhook/binding surface.
- **Admin Worker** — merchant auth/dashboard, platform-admin, Stripe checkout/portal/webhook, support/ticket UI.
- **Supabase** — Auth, Postgres/RLS/RPC, private Storage and authoritative booking/subscription data.
- **Stripe** — monthly subscription billing only in public V1.
- **LINE Messaging API** — central OA onboarding/trial mode and merchant-owned OA paid-production mode.

Exact path/route split under `bk01.wstera.com` is an infrastructure implementation detail for BK-A, but must preserve separate Worker security and deployment boundaries.

## Authority boundaries
1. Browser UI is never authoritative for availability, entitlement, money state or tenant authorization.
2. Postgres constraints/RPCs are authoritative for booking integrity and role-gated data mutations.
3. Stripe webhook-derived subscription state is authoritative for paid subscription lifecycle.
4. LINE delivery status is communication evidence only; it never changes booking truth by itself.
5. Slip-verification provider result can change deposit state only through guarded server-side orchestration and auditable rules.

## Core data flow
Customer → consumer UI → public-safe read/RPC → transactional booking hold → optional private slip upload → manual/automatic verification → confirmation → LINE notification. Merchant → authenticated admin → tenant/role-scoped read/RPC → booking/service/staff/schedule operations. Billing → Stripe Checkout/Portal → signed webhook → idempotent subscription sync → booking-acceptance entitlement gate.

## Failure behavior
- availability race: database transaction/constraint rejects loser; UI refreshes availability;
- expired hold: fail closed and require a new hold;
- LINE failure: retain booking state, record failed delivery and retry/escalate;
- Stripe webhook duplicate/out-of-order: idempotent/no stale state overwrite;
- slip provider timeout/unknown: remain manual-reviewable; never auto-confirm;
- Supabase/DB outage: no optimistic booking success;
- routing/Worker failure: health/smoke gate blocks release.
