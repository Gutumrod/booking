# BK01 Shared-Runtime Schema Alignment Assessment — 2026-09-08

**Mode:** BK01 / SHARED-RUNTIME SCHEMA ALIGNMENT — ASSESS & PREPARE ONLY
**Execution authority:** NONE — no schema move, no live DDL, no PS01 mutation
**Repository:** `feature/bk-a-v1-contract-remediation` @ `43ca79c` at assessment start, clean, origin `0/0`
**Live target inspected:** WSTERA LAB `ykxlqnshaaxmzzocpjlj`
**Current application schema:** `local_service`
**Proposed companion name:** `local_service_internal` — **NOT LOCKED**
**Recommendation:** `PARTIAL ALIGNMENT RECOMMENDED`

## Executive finding

BK01 is not broken. The single-schema `local_service` baseline is live-working and must remain the compatibility anchor. However, live catalog inspection confirms that the schema currently mixes product-facing business objects with service-only recovery, webhook, notification, entitlement, platform-admin and audit machinery.

A split has real least-privilege and isolation value, but a full move would create unnecessary compatibility risk. The safe direction is a phased, wrapper-first partial alignment: keep product/business tables and public/admin RPC contracts in `local_service`; move only proven internal state behind controlled `SECURITY DEFINER` façades after consumers have been cut away from direct table access.

No migration was executed during this assessment.

## Evidence basis

This assessment used live WSTERA LAB PostgreSQL catalogs plus current BK01 application/test source. It did not rely only on migration files. No query or mutation was made against `ps01` or `ps01_internal`.

## 1. Current State

Live `local_service` inventory at assessment time:

| Object kind | Live count |
|---|---:|
| Tables | 21 |
| Views | 1 |
| Functions | 61 |
| Application triggers | 10 |
| RLS policies | 26 |
| Indexes | 61 |
| Foreign keys | 35 |
| Sequences | 0 |
| Standalone composite types | 1 (`platform_admin_shop_row`) |

All 21 tables have RLS enabled. `local_service` grants schema `USAGE` to `anon`, `authenticated`, and `service_role`. During BK-SR-03 the schema was enabled for normal BK01 Data API use; current admin and consumer clients are configured with `db.schema = 'local_service'`.

`local_service_internal` does not currently exist, so the proposed name has no live namespace collision.

The global Supabase migration ledger is **not** inside BK01: `supabase_migrations.schema_migrations` contains 30 rows, from `20260807051615` through `20260907181500`. It is shared platform metadata and must not be moved or duplicated into a BK01 internal schema.

#

## Live data preservation baseline

Exact live row counts captured read-only:

| Table | Rows | Table | Rows |
|---|---:|---|---:|
| shops | 3 | bookings | 5 |
| customers | 2 | services | 1 |
| staff | 1 | staff_schedules | 1 |
| subscriptions | 3 | entitlement_usage | 1 |
| line_notification_logs | 13 | line_users | 1 |
| audit_events | 3 | booking_status_history | 6 |
| platform_admins | 1 | auto_slip_attempts | 0 |
| booking_recovery_attempts | 0 | stripe_webhook_events | 0 |
| shop_users | 0 | shop_holidays | 0 |
| tickets | 0 | ticket_timeline_entries | 0 |
| account_closure_requests | 0 |  |  |

These rows include current LAB fixture/rehearsal state. Future execution must preserve IDs, row counts and content digests for every moved table; zero-row tables still require schema/privilege/contract verification.

## 2. Object Inventory and Classification

Classification: `A = PRODUCT SURFACE`, `B = INTERNAL RUNTIME`, `C = SHARED / PLATFORM DEPENDENCY`, `D = UNCERTAIN`.

#

## 2.1 Tables

| Table | Class | Proposed destination | Evidence / rationale |
|---|---|---|---|
| `shops` | A | `local_service` | Core merchant/product state; public profile and many FKs depend on it. |
| `shop_users` | A | `local_service` | Auth-to-shop membership and RLS anchor. |
| `services` | A | `local_service` | Public/admin booking surface. |
| `staff` | A | `local_service` | Public/admin/staff runtime surface. |
| `staff_schedules` | A | `local_service` | Public availability + staff/admin runtime. |
| `shop_holidays` | A | `local_service` | Public availability + admin runtime. |
| `customers` | A | `local_service` | Core booking/customer state. |
| `bookings` | A | `local_service` | Authoritative booking truth; collision/FK/storage dependency anchor. |
| `subscriptions` | A | `local_service` for V1 | Directly read by admin billing, consumer notification routing and public profile gating; moving now is high-risk and becomes billing redesign. |
| `tickets` | A | `local_service` | Owner/admin support capability with direct app reads. |
| `ticket_timeline_entries` | A | `local_service` | Product support history consumed through ticket RPCs. |
| `account_closure_requests` | A | `local_service` | User data-rights workflow; owner-visible semantics are product-facing even though current app writes via RPC. |
| `audit_events` | B | candidate internal | Cross-cutting audit machinery; no direct app table consumer found; written/read through functions, but owner SELECT/export compatibility must be preserved. |
| `auto_slip_attempts` | B | candidate internal | Provider-attempt machinery; no current direct app consumer found; owner/admin read contract exists. |
| `booking_recovery_attempts` | B | strong internal candidate | No product RLS policy/table grant; accessed only via recovery authorization function. |
| `booking_status_history` | B | internal candidate, defer pending privilege decision | History/audit machinery; no direct app table consumer found; current broad DML grant/policy requires explicit compatibility/security decision. |
| `entitlement_usage` | B | internal candidate, defer first wave | Service-role table used through entitlement/quota functions; composite return coupling makes immediate move risky. |
| `line_notification_logs` | B | internal candidate, later wave | Worker queue/delivery machinery; direct server writes + service RPCs + owner read policy. |
| `line_users` | B | internal candidate, later wave | LINE identity binding state; direct webhook upsert, no normal UI consumer found. |
| `platform_admins` | B | strong internal candidate | Platform authorization registry; no direct table policy/grant; accessed through `is_platform_admin()`. |
| `stripe_webhook_events` | B | strong internal candidate | Idempotency/processing ledger; service-role only and webhook-server controlled. |

#

## 2.2 View and type

- `shop_public_profile` — **A / keep `local_service`**. Live definition joins `shops` to `subscriptions` and computes `is_accepting_online_bookings`; consumer booking code reads it directly.
- `platform_admin_shop_row` — **B purpose / keep compatibility type in `local_service`** while `platform_admin_list_shops()` exposes this return contract.

#

## 2.3 Indexes, FKs and sequences

All 61 indexes are parent-table implementation objects and should move only with their parent table. Important invariant indexes include:

- `prevent_overlapping_staff_bookings` — GiST collision protection on `bookings`.
- `idx_bookings_trans_ref` — partial unique transaction-reference guard.
- `line_notification_idempotency_unique` — LINE delivery idempotency.
- `auto_slip_attempts_idempotency_key_key` — auto-slip provider idempotency.
- unique shop/staff/service/ticket creation-idempotency indexes.

There are 35 FKs: 29 point within `local_service`; 6 point to `auth.users`. Auth-linked columns are `account_closure_requests.requested_by`, `audit_events.actor_user_id`, `booking_status_history.changed_by`, `platform_admins.user_id`, `shop_users.user_id`, and `staff.user_id`.

No sequences exist in `local_service`; UUID/default generation means there is no sequence migration surface.

A physical `SET SCHEMA` operation, if later approved, can preserve relation OIDs and FK/index attachment, but that is only the physical move step; function bodies, grants, RLS, Data API contracts, tests and external policies still require explicit transition work.

#

## 2.4 Functions / RPCs — product-facing contracts (A)

These should remain callable from `local_service` even if implementation/state later moves behind them:

- Booking/customer: `create_booking_hold`, `customer_cancel_booking`, `customer_reschedule_booking`, `submit_deposit_slip(uuid,text,text,text)`, `extend_booking_hold`.
- Merchant booking ops: `approve_booking_deposit`, `reject_deposit_slip`, `cancel_booking`, `set_booking_outcome`.
- Shop/setup: `provision_owner_shop`, `update_shop_settings`, `create_service`, `update_service`, `set_service_active`, `create_staff`, `set_staff_active`, `link_staff_user`, `upsert_staff_weekly_schedule`, `create_shop_holiday`, `delete_shop_holiday`.
- Entitlement/product reads: `get_entitlement_usage`, `get_tier_limits`.
- Data rights: `export_core_business_data`, `request_account_closure`.
- Ticket/support: `create_ticket`, `add_ticket_timeline_entry`, `update_ticket_status`, `update_ticket_priority`, `update_ticket_assignee`, `save_ticket_resolution`, `preview_ticket_retention`, `delete_closed_tickets_before`.

Security helpers such as `current_staff_id`, `has_shop_role`, `is_shop_member`, and `is_shop_owner` are part of the product authorization boundary. They are not normal UI features, but keeping their stable names in `local_service` avoids rewriting RLS/storage dependencies without isolation benefit.

#

## 2.5 Functions / RPCs — internal/runtime purpose (B)

- Recovery: `authorize_booking_recovery_attempt`.
- LINE worker: `claim_due_line_notifications`, `complete_line_notification`, `enqueue_booking_notifications`, `suppress_new_overdue_line_reminder`.
- Stripe: `claim_stripe_webhook_event`, `sync_subscription_state`, `sync_subscription_state_bk_a`.
- Entitlement internals: `ensure_entitlement_row`, `enforce_booking_quota`, `apply_topup`, `platform_admin_add_topup`.
- Platform-admin: `is_platform_admin`, `platform_admin_list_shops`, `platform_admin_set_shop_active`, `platform_admin_extend_trial`, `platform_admin_update_plan`.
- Trigger/invariant machinery: `audit_platform_admin_update`, `enforce_booking_status_transition`, `enforce_shop_booking_acceptance`, `enforce_ticket_owner_admin`, `initialize_shop_subscription`.
- Internal generators: `generate_booking_code`, `generate_link_token`.

#

## 2.6 Uncertain / compatibility function (D)

- `submit_deposit_slip(uuid,text,text)` — live overload exists, but no anon/authenticated/service-role EXECUTE grant and no current app call was found. The active customer path uses the recovery-token overload. Treat this overload as compatibility/deprecation-uncertain until an execution brief proves whether it can be removed; do not silently delete it during schema alignment.

`sync_subscription_state` is still classified B rather than D because its internal purpose is clear, but the application currently calls `sync_subscription_state_bk_a`; the older function's retention status must be checked before any cleanup.

#

## 2.7 Triggers

| Trigger | Parent | Class | Migration consequence |
|---|---|---|---|
| `trg_enforce_booking_quota` | bookings | A/B invariant | Depends on entitlement state; wrapper/internal reference update required if entitlement moves. |
| `trg_enforce_booking_status_transition` | bookings | A/B invariant | Writes booking history; becomes cross-schema if history moves. |
| `trg_enforce_shop_booking_acceptance` | bookings | A/B invariant | Reads subscription state; subscriptions recommended to stay. |
| `trg_enqueue_booking_notifications` | bookings | B | Writes LINE queue; becomes cross-schema if log moves. |
| `trg_suppress_new_overdue_line_reminder` | line_notification_logs | B | Moves with notification-log implementation. |
| `bk_a_audit_platform_shop_update` | shops | B | Writes audit state; function must target internal audit table after cutover. |
| `trg_initialize_shop_subscription` | shops | A/B invariant | Subscriptions remain product surface. |
| `bk_a_audit_platform_subscription_update` | subscriptions | B | Writes audit state. |
| `trg_ticket_timeline_owner_admin` | ticket_timeline_entries | A security | Keep with product support table. |
| `trg_ticket_owner_admin` | tickets | A security | Keep with product support table. |

#

## 2.8 RLS / grant inventory

Live policy coverage by table:

- 3 policies: `staff`, `staff_schedules`.
- 2 policies: `bookings`, `customers`, `services`, `shop_holidays`, `shops`.
- 1 policy: `account_closure_requests`, `audit_events`, `auto_slip_attempts`, `booking_status_history`, `line_notification_logs`, `line_users`, `shop_users`, `subscriptions`, `ticket_timeline_entries`, `tickets`.
- 0 policies: `booking_recovery_attempts`, `entitlement_usage`, `platform_admins`, `stripe_webhook_events`.

The zero-policy group is already behaving as internal state and is the strongest first-wave candidate set.

Notable live grants/exposure:

- `booking_recovery_attempts` and `platform_admins`: no anon/authenticated/service-role table grants found.
- `entitlement_usage`: service-role table access only.
- `stripe_webhook_events`: service-role `SELECT/INSERT/UPDATE` only.
- `audit_events`, `auto_slip_attempts`: authenticated `SELECT` with owner/owner-admin RLS.
- `line_notification_logs`, `line_users`: broad table ACLs exist for anon/authenticated/service-role, while RLS is doing the effective restriction. This is broader than least privilege and strengthens the case for façade-based internalization.
- `booking_status_history`: broad table DML ACLs plus an `ALL` shop-member RLS policy. This is the highest-value privilege finding from the assessment because history integrity should not depend on ordinary members voluntarily using only intended paths.

Schema alignment should reduce direct grants, not merely move names.

## 3. Dependency Map

Current admin and consumer Supabase clients default to `local_service`. Therefore every direct `.from('<table>')` call assumes the exposed product schema; simply changing a table's schema would break those calls.

| Candidate | Confirmed consumers / dependencies | What breaks on naive move |
|---|---|---|
| `booking_recovery_attempts` | live `authorize_booking_recovery_attempt`; deposit upload intent; customer cancel/reschedule recovery chain | recovery authorization fails unless function references are updated; server RPC name can remain stable. |
| `stripe_webhook_events` | Stripe webhook route direct `.from()` updates; `claim_stripe_webhook_event` | webhook idempotency/release/completion fails. Direct table access must be replaced by RPC façade first. |
| `platform_admins` | `is_platform_admin`; platform-admin page; multiple RLS/audit functions call admin check | platform admin and policies fail if wrapper/search path is not updated. |
| `auto_slip_attempts` | live owner/admin SELECT policy; contract test asserts table in `local_service`; no current app direct table consumer found | test/API location contract breaks; future Pro provider path must target new location. |
| `audit_events` | audit trigger; customer cancel/reschedule; booking outcome; account closure; `export_core_business_data`; owner read policy | audits stop or export loses data unless every writer/reader is cut over. |
| `booking_status_history` | status-transition trigger; deposit rejection; auth FK; current shop-member ALL policy | status history write/read contract and tests break; privilege semantics need explicit decision. |
| `entitlement_usage` | quota trigger; staff/booking entitlement functions; top-up functions; QA scripts; `ensure_entitlement_row` returns table composite | booking/staff admission can break transactionally; return-type/API coupling is high. |
| `line_notification_logs` | booking notification trigger; suppression trigger; claim/complete RPCs; LINE webhook direct inserts/updates; dispatcher; contract test | LINE confirmation/reminder/retry/idempotency breaks; claim RPC composite type also moves. |
| `line_users` | LINE webhook direct upsert; FK to customers/shops; owner/admin read policy | LINE UID binding/reuse breaks unless server write path is wrapped first. |

`subscriptions` is intentionally excluded from the move set for this assessment: admin checkout/portal/dashboard, consumer LINE routing, booking acceptance triggers, entitlement functions and `shop_public_profile` all read it. Separating Stripe provider details from product subscription truth would be a billing-contract redesign, which this brief forbids.

#

## 3.1 Shared / platform dependencies (C)

- **Supabase Auth:** 6 live FKs to `auth.users`; multiple functions/RLS predicates use `auth.uid()`. Auth remains shared and untouched.
- **Supabase Storage:** private bucket `deposit-slips`, 5 MiB limit, JPEG/PNG/WebP. Live `storage.objects` SELECT policy references `local_service.bookings` and `local_service.has_shop_role()` directly. Because both are recommended to remain in `local_service`, no storage-policy rewrite is needed for the partial target.
- **Supabase migration ledger:** shared `supabase_migrations`; remain untouched except normal future migration registration.
- **Stripe:** admin webhook/checkout/portal routes; server-only secrets; direct current dependency on `subscriptions` and `stripe_webhook_events`.
- **LINE:** consumer webhook + push API; direct current dependency on `line_users`, `line_notification_logs`, `customers`, `bookings`, `subscriptions` and notification RPCs.
- **Cloudflare Worker:** consumer Worker owns the scheduled dispatch. Source config has production cron `*/5 * * * *`; staging cron is `[]`. The scheduled handler calls `/api/notifications/dispatch` with the dispatch secret.
- **Postgres cron:** `cron.job` exists in WSTERA LAB, but no current job command matched `local_service`, BK01 booking text, the consumer Worker, or the notification dispatch endpoint. No BK01 pg_cron ownership was found.

## 4. Exposure / Security Findings

#

## Product schema should remain the exposed compatibility boundary

`local_service` is already the schema selected by browser/server Supabase clients and contains public booking RPCs, owner/admin data and RLS helpers. Keeping this name and interface avoids a broad API migration.

#

## Internal schema should not become another normal Data API schema

The isolation gain disappears if `local_service_internal` is simply added to exposed schemas with the same grants. Recommended privilege posture:

- no `USAGE` to `PUBLIC`, `anon`, or `authenticated`;
- no direct table grants to browser roles;
- preferably no direct `service_role` table path through PostgREST either;
- controlled access through narrowly granted `SECURITY DEFINER` RPC façades in `local_service`;
- internal tables may keep RLS enabled as defense-in-depth, but normal browser policies should be absent.

#

## Current least-privilege debt worth addressing during future execution

1. `booking_status_history` should not rely on a broad member `ALL` policy for an audit/history table. Treat correction as an explicit security-contract decision, not a silent side effect of moving schemas.
2. `line_notification_logs` and `line_users` have broader table ACLs than their intended runtime use requires. RLS currently supplies the effective restriction, but internalization can reduce attack surface and configuration ambiguity.
3. Several helper/trigger functions retain broad `PUBLIC` EXECUTE grants (for example trigger/generator helpers). They are not the primary migration target, but a future execution migration should review/revoke unnecessary EXECUTE without changing legitimate RPC contracts.
4. All reviewed `SECURITY DEFINER` internal-facing functions currently use `search_path=pg_catalog, local_service`. Any moved object must be referenced explicitly or the secure search path updated deliberately; otherwise runtime will fail after relocation.

No evidence was found that BK01 currently requires direct access to PS01 schemas. None should be introduced.

## 5. Proposed Target Architecture

```text
local_service                         # exposed BK01 product/API boundary
├─ shops / shop_users
├─ services / staff / schedules / holidays
├─ customers / bookings
├─ subscriptions                     # keep for V1
├─ tickets / ticket_timeline_entries
├─ account_closure_requests
├─ shop_public_profile
├─ product-facing RPCs
├─ authorization helpers
└─ temporary compatibility façades only where proven necessary

local_service_internal                # proposed; NOT Data API product surface
├─ booking_recovery_attempts
├─ stripe_webhook_events
├─ platform_admins
├─ auto_slip_attempts                 # after read-contract façade
├─ audit_events                       # later wave
├─ booking_status_history             # later wave + privilege decision
├─ entitlement_usage                  # later wave + return-contract prep
├─ line_notification_logs             # later wave + worker façade prep
└─ line_users                         # later wave + webhook façade prep
```

Shared `auth`, `storage`, `supabase_migrations`, Stripe, LINE and Cloudflare remain external/shared dependencies and are not absorbed into either BK01 schema.

#

## Why `local_service_internal` is the preferred name

The product-facing schema is already `local_service` and is deeply embedded in clients, RLS, tests and storage policy. Renaming it to `bk01` would multiply risk without isolation benefit. A paired `local_service_internal` preserves the established namespace while following the `<product-surface> + _internal` shared-runtime pattern. Final naming still requires Owner lock.

## 6. Migration Risk

| Area / object | Risk | Reason |
|---|---|---|
| Create locked internal schema only | LOW | New namespace, provided it is not exposed and no objects move yet. |
| `booking_recovery_attempts` | MEDIUM | Small/no current rows and no direct table grants, but recovery is security-sensitive and in customer/deposit paths. |
| `platform_admins` | MEDIUM | Simple table, but `is_platform_admin()` is used by UI, RLS and audit behavior. |
| `stripe_webhook_events` | MEDIUM | Service-only state, but webhook route currently performs direct table writes after claim. |
| `auto_slip_attempts` | MEDIUM | No current app direct consumer found, but owner-read contract and future Pro integration exist. |
| `audit_events` | HIGH | Multiple writers, auth FK, owner read policy and export dependency. |
| `booking_status_history` | HIGH | Trigger writes plus current broad DML/RLS semantics; requires explicit security compatibility decision. |
| `entitlement_usage` | HIGH | Booking/staff enforcement path; QA direct references; composite RPC return type. |
| `line_notification_logs` | HIGH | LINE webhook, scheduler, claim/complete RPCs, trigger, retry/idempotency and composite return coupling. |
| `line_users` | MEDIUM-HIGH | Real LINE binding/reuse path directly upserts the table. |
| `subscriptions` | HIGH / DO NOT MOVE in this scope | Central product entitlement truth with many direct consumers. |
| Cross-product collateral | HIGH if unguarded | Shared LAB; must prove PS01/public/shared catalogs unchanged. |

The risk rating is migration risk, not an assertion that the current object is defective.

## 7. Compatibility Plan

The key rule is **wrapper first, move second**. Do not dual-write two authoritative tables.

#

## Stage 0 — Preflight / snapshot

- Capture current commit, migration version, object definitions, grants, policies, FK/index definitions and exact row counts/digests.
- Capture BK01 functional baseline plus cross-product catalog snapshots.
- Confirm `local_service_internal` name and execution scope with Owner.

#

## Stage 1 — Decouple direct internal-table consumers while tables are still in `local_service`

Add or complete stable RPC façades in `local_service`, initially pointing to the existing tables. Then update server code to use the façades and prove no behavior change.

Required examples:

- Stripe: replace direct `.from('stripe_webhook_events')` completion/release writes with service-only RPCs.
- LINE: replace direct webhook writes/updates to `line_notification_logs` and `line_users` before those tables are eligible to move.
- Audit/auto-slip/history reads: establish explicitly scoped read RPC/view only if current contract must remain addressable.
- Entitlement: eliminate dependency on a schema-bound table composite before moving `entitlement_usage`; preserve `get_entitlement_usage` JSON contract.

At this stage no table needs to move. App rollback is trivial because the old tables still exist.

#

## Stage 2 — First physical move, only after wrapper proof

Preferred first wave: `booking_recovery_attempts`, `platform_admins`, `stripe_webhook_events`; optionally `auto_slip_attempts` only if its read contract is settled.

A transactional `ALTER TABLE ... SET SCHEMA ...` may be used as the physical relocation because it preserves table identity/FKs/index attachment, but it is not considered the migration solution by itself.

#

## Stage 3 — Later-wave internalization

Only after independent wrapper/API proof:

1. `audit_events`.
2. `booking_status_history` after Owner decides whether current member-DML behavior is a contract or a defect.
3. `entitlement_usage` after composite-return coupling is removed or versioned.
4. `line_notification_logs` and `line_users` after LINE webhook/dispatcher use stable service-only façades.

Do not move `subscriptions` in this alignment. Do not redesign billing to force a prettier schema.

#

## RPC / API compatibility strategy

- Existing product-facing function names stay in `local_service`.
- Internal implementation tables may move without requiring browser/admin callers to know the internal schema.
- For a currently direct readable table that must move, use a **temporary, read-only compatibility view or RPC** with the same product-visible shape only for a defined transition window.
- No permanent compatibility view is accepted without an identified consumer and removal criterion.
- Internal schema itself should remain absent from normal PostgREST exposed-schema configuration.
- `SECURITY DEFINER` functions must use fixed safe search paths and preferably fully-qualified application object references.

#

## RLS / grant transition

- Preserve product RLS on product tables.
- Revoke direct browser-role access to moved underlying state.
- Put row/role filtering in narrowly scoped façade RPCs/views where product visibility is required.
- Keep internal tables RLS-enabled as defense-in-depth, with no generic browser policies.
- Review existing broad helper-function EXECUTE grants as part of the execution migration, but only revoke privileges proven unnecessary.

## Migration Design — design only

#

## Destination map

**Stay in `local_service`:** all A tables/view, product-facing RPCs, authorization helpers and any explicitly approved temporary compatibility façade.

**First-wave internal candidates:** `booking_recovery_attempts`, `platform_admins`, `stripe_webhook_events`; `auto_slip_attempts` only after its owner-read contract is preserved.

**Later-wave candidates:** `audit_events`, `booking_status_history`, `entitlement_usage`, `line_notification_logs`, `line_users`.

#

## Dependency order

1. Snapshot/catalog checksums and current data digests.
2. Add façade RPCs against current table locations.
3. Deploy application code that uses façades; run existing behavior tests.
4. Create and lock internal schema privileges.
5. Move one bounded object group transactionally.
6. Recreate/update only the grants, policies, function references and compatibility surfaces required for that group.
7. Run DB/RLS/API/runtime tests before touching the next group.
8. End compatibility window only after source/test/external-consumer search is clean and Owner approves removal.

#

## Existing-data preservation

For each moved table record pre/post:

- exact row count;
- primary-key set digest;
- deterministic row-content digest computed inside PostgreSQL (do not export PII into logs/docs);
- FK validity and orphan count;
- unique/index constraint validity;
- representative application reads/writes through the supported façade.

No table is recreated from scratch merely to change schema unless a specific technical constraint makes physical relocation unsafe.

#

## Migration ledger strategy

Use normal timestamped BK01 migrations in the shared Supabase migration ledger. Do **not** create a parallel BK01 migration-metadata table and do not manually rewrite `supabase_migrations` to simulate rollback.

A failed transactional migration should leave no applied state. If a migration has committed and must be reverted later, use an explicit compensating migration so shared-runtime history remains append-only and auditable.

#

## Backward-compatibility window

Recommended window is at least one deployed/tested application checkpoint between “consumer uses façade” and “underlying table moves”. High-risk later-wave tables may require an additional checkpoint with temporary read compatibility.

The window ends only when:

- repository search finds no unsupported direct old-table consumers;
- current tests no longer hard-code an obsolete table location, or deliberately test a compatibility façade;
- LAB live behavior passes;
- no unknown external consumer is identified;
- Owner approves removal of temporary compatibility objects.

## 8. Rollback Plan — design only

#

## Before physical move commit

Use one transaction per bounded move group. Any failed DDL/data/permission verification inside the transaction rolls back entirely.

#

## After a committed LAB move

1. Stop further object groups; do not continue forward through a failing gate.
2. Keep the app on façade contracts; they are the rollback cushion.
3. Apply a compensating migration that moves the affected relation back or restores the prior object layout.
4. Restore captured grants/RLS/function definitions from the preflight snapshot.
5. Re-run row/digest/FK checks and the full affected runtime path.
6. Keep migration history append-only; do not `repair` shared ledger state merely to hide a failed attempt.

Production rollback must not be attempted until the exact reverse path has been proven in WSTERA LAB.

## WSTERA LAB Proof Plan for a Future Approved Migration

#

## BK01 proof

Must pass before/after every move wave:

- public booking creation / collision protection;
- deposit hold/upload/review path;
- customer recovery, cancel and reschedule;
- staff/admin role scope and RLS negatives;
- subscription/entitlement booking acceptance;
- LINE bind, UID reuse, confirmation, 24h reminder, reschedule, cancel, retry/idempotency;
- Stripe webhook idempotency/state path when test credentials are available;
- auto-slip path when the provider integration is present;
- account closure/export and audit evidence;
- support tickets/platform-admin flows;
- exact data/FK/index checks.

#

## Cross-product proof

Before migration, snapshot catalog signatures for `ps01`, `ps01_internal`, and shared/public surfaces. After migration, compare exact object counts and definition/grant/policy digests. Expected result for PS01 is **zero change**.

Also verify:

- no new FK/grant from BK01 to PS01 schemas;
- no PS01 grant/policy/function definition changed;
- `public` catalog signature unchanged unless an explicitly approved shared object is part of the execution brief;
- no shared pg_cron job changed;
- storage policy changes are zero for the recommended first wave;
- only expected `local_service` / internal-schema definitions and the normal migration-ledger row change.

This assessment itself performed no PS01 inspection or mutation.

## 9. Recommendation

#

## `PARTIAL ALIGNMENT RECOMMENDED`

**Why not KEEP CURRENT STRUCTURE:** live evidence shows real internal-only state, broad ACL reliance on RLS, service-only webhook/recovery machinery and a history-integrity privilege concern. A deliberate internal boundary can reduce exposure and shared-runtime ambiguity.

**Why not FULL ALIGNMENT:** `subscriptions`, product support/history surfaces, authorization helpers and several internal candidates are deeply coupled to current Data API/RPC contracts. Moving everything would create more regression risk than isolation value and would drift into billing/refactor scope.

**Recommended path:** keep `local_service` as the stable BK01 product/API boundary; introduce a non-exposed companion internal schema and migrate only proven internal state in small waves after wrapper-first decoupling.

First-wave preference after explicit execution approval:

1. `booking_recovery_attempts`.
2. `platform_admins`.
3. `stripe_webhook_events`.
4. `auto_slip_attempts` only if the existing owner/admin read contract has a defined façade.

Later waves require separate proof for `audit_events`, `booking_status_history`, `entitlement_usage`, `line_notification_logs`, and `line_users`.

Keep `subscriptions` in `local_service` for V1.

## 10. Owner Decision Required

Before any execution, Owner must explicitly approve:

1. `PARTIAL ALIGNMENT RECOMMENDED` as the chosen direction.
2. Final internal schema name — recommendation: `local_service_internal`.
3. Exact first-wave object list.
4. Whether the current `booking_status_history` member-DML capability is an unintended security defect to remove or a compatibility behavior that must temporarily remain.
5. Temporary compatibility-view/RPC policy and maximum removal window.
6. Whether `auto_slip_attempts` moves before Pro provider integration or is deferred until that runtime is active.
7. A separate **LAB EXECUTION BRIEF** authorizing DDL and functional proof.

Until those decisions exist: **STOP — DO NOT MIGRATE.**

## Appendix A — Full live index inventory

Indexes inherit the classification/destination of their parent table.

- `account_closure_requests` (1): `account_closure_requests_pkey`.
- `audit_events` (1): `audit_events_pkey`.
- `auto_slip_attempts` (2): `auto_slip_attempts_pkey`, `auto_slip_attempts_idempotency_key_key`.
- `booking_recovery_attempts` (1): `booking_recovery_attempts_pkey`.
- `booking_status_history` (1): `booking_status_history_pkey`.
- `bookings` (7): `bookings_pkey`, `bookings_booking_code_key`, `idx_bookings_booking_code`, `idx_bookings_expires_at`, `idx_bookings_shop_date`, `idx_bookings_trans_ref`, `prevent_overlapping_staff_bookings`.
- `customers` (3): `customers_pkey`, `customers_shop_id_phone_key`, `idx_customers_shop_phone`.
- `entitlement_usage` (2): `entitlement_usage_pkey`, `idx_entitlement_usage_shop_id`.
- `line_notification_logs` (3): `line_notification_logs_pkey`, `idx_line_logs_booking`, `line_notification_idempotency_unique`.
- `line_users` (3): `line_users_pkey`, `idx_line_users_shop`, `line_users_shop_id_line_user_id_key`.
- `platform_admins` (1): `platform_admins_pkey`.
- `services` (2): `services_pkey`, `services_shop_creation_idempotency_key`.
- `shop_holidays` (5): `shop_holidays_pkey`, `idx_shop_holidays_date`, `shop_holidays_shop_creation_idempotency_key`, `shop_holidays_shop_id_staff_id_holiday_date_key`, `shop_holidays_shop_wide_date`.
- `shop_users` (2): `shop_users_pkey`, `shop_users_shop_id_user_id_key`.
- `shops` (4): `shops_pkey`, `shops_slug_key`, `idx_shops_slug`, `shops_registration_idempotency_key_key`.
- `staff` (3): `staff_pkey`, `staff_shop_creation_idempotency_key`, `staff_shop_user_unique`.
- `staff_schedules` (3): `staff_schedules_pkey`, `idx_staff_schedules_staff`, `staff_schedules_staff_id_day_of_week_key`.
- `stripe_webhook_events` (1): `stripe_webhook_events_pkey`.
- `subscriptions` (5): `subscriptions_pkey`, `subscriptions_shop_id_idx`, `subscriptions_shop_id_key`, `subscriptions_stripe_customer_id_key`, `subscriptions_stripe_subscription_id_key`.
- `ticket_timeline_entries` (3): `ticket_timeline_entries_pkey`, `idx_ticket_timeline_shop_id`, `idx_ticket_timeline_ticket_id`.
- `tickets` (8): `tickets_pkey`, `idx_tickets_booking_id`, `idx_tickets_created_at`, `idx_tickets_shop_due_at`, `idx_tickets_shop_id`, `idx_tickets_shop_normalized_phone`, `idx_tickets_shop_status`, `tickets_shop_creation_idempotency_key`.

## Appendix B — Full live FK inventory

- `account_closure_requests`: `shop_id -> local_service.shops`; `requested_by -> auth.users`.
- `audit_events`: `shop_id -> local_service.shops`; `actor_user_id -> auth.users`.
- `auto_slip_attempts`: `shop_id -> local_service.shops`; `booking_id -> local_service.bookings`.
- `booking_recovery_attempts`: `booking_id -> local_service.bookings`.
- `booking_status_history`: `booking_id -> local_service.bookings`; `changed_by -> auth.users`.
- `bookings`: `shop_id -> shops`; `customer_id -> customers`; `staff_id -> staff`; `service_id -> services`.
- `customers`: `shop_id -> shops`.
- `entitlement_usage`: `shop_id -> shops`.
- `line_notification_logs`: `shop_id -> shops`; `booking_id -> bookings`.
- `line_users`: `shop_id -> shops`; `customer_id -> customers`.
- `platform_admins`: `user_id -> auth.users`.
- `services`: `shop_id -> shops`.
- `shop_holidays`: `shop_id -> shops`; `staff_id -> staff`.
- `shop_users`: `shop_id -> shops`; `user_id -> auth.users`.
- `staff`: `shop_id -> shops`; `user_id -> auth.users`.
- `staff_schedules`: `shop_id -> shops`; `staff_id -> staff`.
- `subscriptions`: `shop_id -> shops`.
- `ticket_timeline_entries`: `shop_id -> shops`; `ticket_id -> tickets`.
- `tickets`: `shop_id -> shops`; `booking_id -> bookings`; `service_id -> services`.
- `stripe_webhook_events`: no FK.

Total: 35 FKs — 29 BK01-local, 6 `auth.users` dependencies. A future schema move must validate every FK after relocation even though PostgreSQL OID-based constraints normally survive `SET SCHEMA`.

## Appendix C — Full live RLS policy inventory

- `account_closure_requests`: `BK-A owner reads own closure requests` (authenticated SELECT).
- `audit_events`: `BK-A owner reads own audit events` (authenticated SELECT; owner or platform admin).
- `auto_slip_attempts`: `BK-A owner admin reads auto slip attempts` (authenticated SELECT).
- `booking_status_history`: `Members view status history` (`public`, `ALL`).
- `bookings`: `BK-A scoped booking reads` (authenticated SELECT); `Public bookings insert` (`public` INSERT).
- `customers`: `BK-A scoped customer reads` (authenticated SELECT); `Public customers insert` (`public` INSERT).
- `line_notification_logs`: `BK-A owner admin view notification logs` (authenticated SELECT).
- `line_users`: `BK-A owner admin view line users` (authenticated SELECT).
- `services`: `BK-A owner admin manage services` (authenticated ALL); `Public services viewable by everyone` (`public` SELECT active only).
- `shop_holidays`: `BK-A owner admin manage holidays` (authenticated ALL); `Public shop holidays viewable by everyone` (`public` SELECT).
- `shop_users`: `Users view own shop memberships` (authenticated SELECT via `auth.uid()`).
- `shops`: `Members view own shop` (authenticated SELECT); `Public shops viewable by everyone` (`public` SELECT active only).
- `staff`: `BK-A owner manages staff` (authenticated ALL); `BK-A public active staff` (anon SELECT); `BK-A scoped staff reads` (authenticated SELECT).
- `staff_schedules`: `BK-A owner admin manage schedules` (authenticated ALL); `BK-A public schedules for booking availability` (anon SELECT); `BK-A staff reads own schedule` (authenticated SELECT).
- `subscriptions`: `Owner views own subscription` (authenticated SELECT).
- `ticket_timeline_entries`: `BK-A owner admin view ticket timeline` (authenticated SELECT).
- `tickets`: `BK-A owner admin view shop tickets` (authenticated SELECT).

No policy exists on `booking_recovery_attempts`, `entitlement_usage`, `platform_admins`, or `stripe_webhook_events`; those tables are already non-product-facing by policy design.

## Appendix D — Confirmed source/test consumers

Direct application table access found in current source includes:

- Admin: `shop_users`, `shops`, `bookings`, `services`, `staff`, `staff_schedules`, `shop_holidays`, `subscriptions`, `tickets`, `stripe_webhook_events`.
- Consumer: `shop_public_profile`, `services`, `staff`, `staff_schedules`, `shop_holidays`, `bookings`, `subscriptions`, `line_users`, `customers`, `line_notification_logs`.

Current application RPC callers cover booking create/deposit/recovery/cancel/reschedule, notification claim/complete, merchant service/staff/shop settings, ticket operations, account export/closure, platform admin, Stripe claim/sync, and subscription/admin operations.

Hard-coded test/location contracts include:

- `supabase/tests/bk_a_contract.sql` expects `auto_slip_attempts`, `account_closure_requests`, and `audit_events` in `local_service`.
- `tests/notification-scheduling-contract.test.ts` expects the overdue-reminder trigger on `local_service.line_notification_logs`.
- quota/staff QA SQL directly reads/writes `local_service.entitlement_usage` and `local_service.subscriptions`.

These tests must be treated as real migration consumers. They should be updated only when the target contract is intentionally changed, not merely made green by deleting assertions.

## Assessment boundary

No DDL, DML, migration repair, schema creation, function move, table move, grant change, policy change, cron change, storage change, production access, PS01 access, Council, billing redesign, LINE redesign or unrelated refactor was performed.

**STOP GATE:** assessment complete. Await explicit Owner execution decision.
