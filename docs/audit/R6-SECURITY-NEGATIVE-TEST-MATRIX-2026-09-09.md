# R6 — Security Review & Negative-Test Matrix

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R6 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** THREAT MODEL + TEST DESIGN — no code change, no LAB migration
**Branch:** `docs/bk01-real-shop-hardening`
**Consumes:** R0 (KMO-X1, KMO-X2, KMO-X3), R1 (HC-02, HC-03, HC-07*, HC-08, HC-27, HC-28,
authority rows in HC-*), R2 §5, R3 §4, R5 §4/§7

## Purpose

Define what every new merchant-configurable surface introduced by R2/R3/R5 must prove
before it is accepted (brief §13, §16.3), and record the security gaps already visible in
canonical source that R7 must close. This is the test contract R7/R8 execute; it is not run
here (no runtime).

Brief §13 proof requirements, mapped to a test ID scheme `SEC-<area>-<n>`.

---

## AMENDMENT 1 — 2026-09-09 R0–R6 Review Gate (CEO)

Test-matrix expectation updates. Frozen pre-amendment: `520bb08`. Log:
`docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`.

**A1 — slot interval expectations:**
- `SEC-BC-2` change: `slot_interval_minutes = 7` is now **VALID** (`BETWEEN 1 AND 1440`).
  Replace with: `= 0` → reject; `= 1441` → reject; `= 45` / `= 90` → **accept**.
- New `SEC-BC-6`: a service with `duration_minutes = 50` on a shop with
  `slot_interval_minutes = 15` → booking succeeds (duration is NOT required to be a
  multiple of the slot interval or of 15). `create_service` accepts `duration_minutes = 50`,
  `= 37`, `= 90` — no "multiple of 15" rejection after R7.
- `SEC-AV-6` retained: `p_start_time` not aligned to `slot_interval_minutes` → reject.

**A3 — DATE_RANGE tests removed** (feature deferred):
- Delete `SEC-AV-8`, `SEC-AV-9` (date-range spanning closed days / capacity).
- Delete `SEC-PUB-5` (date-range capacity projection).
- Delete `SEC-RB-3` clause about `SHOP_WEEKLY` — keep the mode-rollback test but drop any
  `DATE_RANGE` reference; delete `SEC-RB-4` (DATE_RANGE orphan bookings).
- Delete `SEC-DEP` / `SEC-BC` rows that assume a `scheduling_mode` column.
- The availability primitive cross-check (`SEC-AV-1`) covers `TIME_SLOT` tuples only.

**A4 — Bookable Resource:** primitive tests reference `is_slot_bookable` with a `staff_id`
resource parameter (V1). New `SEC-AV-10`: the primitive signature and the shop
calendar/config tables contain no column or check that names "staff" as the only bookable
kind (grep-level assertion in the R7 migration review) — the door to Room/Table/Bay/etc.
stays open.

**B1 — deposit-default tests** (expand `SEC-PP` / `SEC-DEP`):
- `SEC-PP-11`: fresh shop from `provision_owner_shop` → `require_deposit = false`,
  `default_deposit_amount IS NULL`; a booking with no service deposit confirms with no
  payment step.
- `SEC-DEP-5`: shop with `require_deposit = true` and `default_deposit_amount IS NULL` and
  service `deposit_amount IS NULL` → `create_booking_hold` raises `PAYMENT_NOT_CONFIGURED`
  (never resolves to `0`, never to `100`).
- `SEC-DEP-6`: `default_deposit_amount IS NULL` is distinct from `= 0` — a `NULL` never
  produces a deposit line; an explicit `0` on a service produces an explicit no-deposit
  confirm.
- `SEC-FIX-1` (new area, fixtures): `seed_demo_shop` and all `tests/` fixtures assert
  `require_deposit = false` / `default_deposit_amount IS NULL` unless the test's own name
  says it exercises the deposit path.

Everything else in the matrix stands.

---

## 1. Existing authorization model (baseline — evidence)

| Primitive | Definition | Used by |
|---|---|---|
| `local_service.is_shop_member(shop_id)` | caller has any `shop_users` row for the shop | RLS SELECT policies |
| `local_service.has_shop_role(shop_id, text[])` | caller's role ∈ the array | services/staff/schedule/holiday manage policies + RPCs |
| `local_service.is_shop_owner(shop_id)` | caller role = `owner` | `update_shop_settings`, staff link, subscription, closure/export |
| RLS | enabled on `bookings, customers, services, staff, staff_schedules, shop_holidays, shops, subscriptions, tickets, ticket_timeline_entries, line_*, account_closure_requests` | BK-A remediation added scoped read/write policies |
| Public read | `shop_public_profile` view (`security_invoker=true`, column-limited), `services`/`staff` scoped to active + approved columns | consumer |
| Trusted RPCs | `SECURITY DEFINER`, `SET search_path = pg_catalog, local_service`, `REVOKE ALL FROM PUBLIC` then explicit `GRANT` | all mutations |

The foundation is sound. R6's job is to ensure the **new** surfaces inherit it and to fix
the specific holes below.

---

## 2. Confirmed security gaps in canonical source (R7 must close)

| ID | Gap | Evidence | Severity | Fix phase |
|---|---|---|---|---|
| SEC-GAP-1 | `customer_reschedule_booking` has no booking-collision check → a token-holding customer can double-book a provider server-side | `bk_a_v1_contract_remediation.sql:514-576`; also **violates BK01's own** `docs/05_BOOKING_DOMAIN_RULES.md:44` ("same availability/collision rules") | **P0** | R7 (R2 §7 primitive) |
| SEC-GAP-2 | Three divergent availability implementations; only `create_booking_hold` enforces collision | R0 KMO-X2 / R1 HC-27 | **P0** | R7 |
| SEC-GAP-3 | Consumer generates a PromptPay QR paying `0812345678` a real amount when the shop has no PromptPay configured | `book/[slug]/page.tsx:124,131` | **P0** (false payment truth) | R4-7 (client) + R7 (`PAYMENT_NOT_CONFIGURED` server guard) |
| ~~SEC-GAP-4~~ | **RESOLVED — not a gap.** `create_service` and `update_service` both reject `p_deposit_amount > p_price` server-side | `20260807175455_...:93-95, 159-161` | — | verified 2026-09-09 |
| SEC-GAP-5 | `create_booking_hold` accepts any `p_start_time` — no slot-interval alignment, no lead-time, no horizon enforcement. (Note: `create_service`/`update_service` **do** enforce "duration is a positive multiple of 15 minutes" server-side at `...:89, 155` — that hardcoded 15 is a real HC-09 server-side instance, not a missing check) | all `create_booking_hold` defs | P1 | R7 (R5 §3) |
| ~~SEC-GAP-6~~ | **RESOLVED — not a gap.** `upsert_staff_weekly_schedule` (`:44`), `create_shop_holiday` (`:132`), `delete_shop_holiday` (`:202`) all check `has_shop_role(shop, ['owner','admin'])` server-side; `create_staff`/`set_staff_active` are owner-only (`:222, 276`). Staff-deny is enforced at the RPC, not UI-only | `20260807181852_...`, `20260807175455_...` | — | verified 2026-09-09 |
| SEC-GAP-7 | `create_booking_hold` / `submit_deposit_slip` granted to `anon`; the recovery-token abuse guard (`authorize_booking_recovery_attempt`, 5/15min/30min) covers slip submit + reschedule but **not** initial hold creation — an anon caller can spam `create_booking_hold` | grants at `phase_a_...:291`; abuse guard scope `bk_a_v1_...:40-60` | P2 | R7 (rate-limit hold creation per shop/IP) |
| SEC-GAP-8 | `shop_holidays` overloads shop-closure and staff-time-off on one table; a mis-scoped RLS/RPC change could let a shop admin write another shop's staff time-off | R2 §6 open item | P2 (latent) | R7 table decision |

**R6 action items — DONE 2026-09-09 (source verification, no runtime):**
- `create_service` / `update_service`: server-side `p_deposit_amount > p_price` reject
  present → SEC-GAP-4 closed.
- `upsert_staff_weekly_schedule` / `create_shop_holiday` / `delete_shop_holiday`:
  `has_shop_role(shop, ['owner','admin'])` present; `create_staff` / `set_staff_active`
  owner-only → SEC-GAP-6 closed.
- Residual: `create_service`/`update_service` hardcode the 15-minute duration multiple
  server-side (`...:89, 155`) — folded into HC-09; R5/R7 removes it with the scheduling
  model.

---

## 3. Negative-test matrix — per new configurable surface

Every row is a test that must **fail closed** (deny / error / no-op), proven at the DB/RPC
boundary, not the UI. Format: caller → action → expected.

### 3.1 `shops.weekly_closure_mode` + `shop_weekly_closures` (R2)

| ID | Caller | Action | Expected |
|---|---|---|---|
| SEC-WC-1 | `staff` role | set `weekly_closure_mode` via RPC | deny (`42501`) |
| SEC-WC-2 | `staff` role | insert `shop_weekly_closures` row | deny |
| SEC-WC-3 | owner of shop B | insert `shop_weekly_closures` for shop A | deny (tenant) |
| SEC-WC-4 | `anon` | select `shop_weekly_closures` directly | deny (only the bounded availability projection is public) |
| SEC-WC-5 | owner | insert `day_of_week = 7` | reject (`CHECK 0..6`) |
| SEC-WC-6 | owner | insert duplicate `(shop_id, day_of_week)` | reject (PK) |
| SEC-WC-7 | consumer availability, `SHOP_WEEKLY` + Tuesday closed | request Tuesday slot, staff marked working | **no slot** (layer 3 beats layer 5) |
| SEC-WC-8 | `create_booking_hold`, same | force `p_booking_date` = a closed Tuesday | reject |
| SEC-WC-9 | `customer_reschedule_booking`, same | move booking onto closed Tuesday | reject |
| SEC-WC-10 | any | switch mode `SHOP_WEEKLY → STAFF_WEEKLY → SHOP_WEEKLY` | staff rows + closure rows both intact (non-destructive) |

### 3.2 Availability primitive `is_slot_bookable` / `is_service_bookable` (R2 §7, R5 §7)

| ID | Scenario | Expected |
|---|---|---|
| SEC-AV-1 | randomised cross-check: `create_booking_hold`, `customer_reschedule_booking`, `get_bookable_slots` on 500 random (shop, staff, service, date, time) tuples | identical bookable verdict for every tuple |
| SEC-AV-2 | `customer_reschedule_booking` onto a slot already held by another confirmed booking, same staff | reject (closes SEC-GAP-1) |
| SEC-AV-3 | `customer_reschedule_booking` onto the booking's **own** current slot | allowed (`p_exclude_booking_id` works) |
| SEC-AV-4 | two concurrent `create_booking_hold` for the same staff/slot | exactly one succeeds (serialization / exclusion) |
| SEC-AV-5 | concurrent `create_booking_hold` + `customer_reschedule_booking` targeting the same slot | at most one wins; no overlap persists |
| SEC-AV-6 | `p_start_time` not aligned to `slot_interval_minutes` | reject (SEC-GAP-5) |
| SEC-AV-7 | `p_booking_date` beyond `booking_horizon_days` / inside `booking_lead_time_minutes` | reject |
| ~~SEC-AV-8~~ | DELETED (AMENDMENT 1 A3 — DATE_RANGE deferred) |
| ~~SEC-AV-9~~ | DELETED (AMENDMENT 1 A3 — DATE_RANGE deferred) |
| SEC-AV-10 | grep the R7 migration + `is_slot_bookable` signature | no column or CHECK names "staff" as the only bookable kind (AMENDMENT 1 A4) |

### 3.3 Profile / Payment split (R3 §3)

| ID | Caller | Action | Expected |
|---|---|---|---|
| SEC-PP-1 | owner | `update_shop_profile` with PromptPay empty on the shop | **succeeds** (KMO-06 fixed) |
| SEC-PP-2 | `admin` role | `update_shop_profile` | succeeds (admin may edit profile) |
| SEC-PP-3 | `admin` role | `update_shop_payment` | deny (owner only) |
| SEC-PP-4 | `staff` role | either RPC | deny |
| SEC-PP-5 | owner of shop B | `update_shop_profile(shop_A)` | deny (tenant) |
| SEC-PP-6 | owner | `update_shop_payment` with blank PromptPay while `require_deposit = true` or a service has deposit > 0 | reject with a clear "payment required for deposit flow" error |
| SEC-PP-7 | owner | `update_shop_payment` with blank PromptPay while `require_deposit = false` and no service deposit | **succeeds** |
| SEC-PP-8 | anon consumer, shop with deposit required + no PromptPay | `create_booking_hold` for a deposit service | reject `PAYMENT_NOT_CONFIGURED` — **no** fallback recipient, **no** fallback amount (SEC-GAP-3) |
| SEC-PP-9 | anon consumer | inspect page source / network for a hardcoded `0812345678` or `100` deposit | absent after R4-7 |
| SEC-PP-10 | `provision_owner_shop` | register with PromptPay omitted | **succeeds** (HC-07b fixed); shop lands in "payment setup required" readiness |

### 3.4 Deposit integrity (R3 §3, KMO-X4)

| ID | Scenario | Expected |
|---|---|---|
| SEC-DEP-1 | `update_service` sets `deposit_amount` = 250, then `update_service` changes only price | `deposit_amount` stays 250 (no auto-30%) |
| SEC-DEP-2 | `create_service`/`update_service` with `deposit_amount > price` | reject server-side (SEC-GAP-4) |
| SEC-DEP-3 | `create_booking_hold`: deposit figure in the response vs `services.deposit_amount` / `shops.default_deposit_amount` resolution | matches the server rule exactly; client never overrides |
| SEC-DEP-4 | service `deposit_amount = 0` (explicit no-deposit) on a `require_deposit = true` shop | booking confirms without a deposit step (explicit 0 wins — already correct since `fix_service_deposit_override`) |

### 3.5 Booking config (R3 D2)

| ID | Caller | Action | Expected |
|---|---|---|---|
| SEC-BC-1 | `staff` | set `slot_interval_minutes` / `booking_enabled` / windows | deny |
| SEC-BC-2 | owner | `slot_interval_minutes = 45` / `90` | **accept** (AMENDMENT 1 A1 — `BETWEEN 1 AND 1440`); `= 0` / `= 1441` → reject |
| SEC-BC-3 | owner | `booking_horizon_days = 0` or `400` | reject (CHECK 1..365) |
| SEC-BC-6 | owner | `create_service` with `duration_minutes = 50` / `37` / `90` | **accept** — duration need not be a multiple of the slot interval or of 15 (AMENDMENT 1 A1); no "multiple of 15" rejection after R7 |
| SEC-BC-4 | consumer | `booking_enabled = false` | consumer shows "online booking disabled"; `create_booking_hold` rejects |
| SEC-BC-5 | `customer_reschedule_booking` with `customer_reschedule_before_hours` NULL | current behaviour is a hard error "policy not configured" — after R3/R4 it must be **set to a real value via UI** or the feature is explicitly off, not silently dead (HC-37) |

### 3.6 Tenant isolation (all new tables/columns)

| ID | Scenario | Expected |
|---|---|---|
| SEC-TEN-1 | authenticated user with no `shop_users` row | any config RPC → deny |
| SEC-TEN-2 | shop A member | read/write shop B's `shop_weekly_closures`, `services` deposit, `staff_schedules`, booking config | deny on every one |
| SEC-TEN-3 | anon | select `shops` base table (not the view) | deny (already closed in E3.3) |
| SEC-TEN-4 | anon | select `shop_weekly_closures`, `staff_schedules` beyond the availability projection | only the bounded projection returns data |
| SEC-TEN-5 | cross-shop reference substitution: valid token for booking in shop A, call reschedule with `p_shop`/service from shop B | deny |

### 3.7 Public surface minimization (brief §13)

| ID | Check | Expected |
|---|---|---|
| SEC-PUB-1 | `shop_public_profile` columns | only booking-necessary fields; no `subscription_status`, `trial_ends_at`, `owner_name`, billing state (already true — regression guard) |
| SEC-PUB-2 | new readiness projection (if added) | exposes only capability booleans, never raw settings values |
| SEC-PUB-3 | `get_bookable_slots` projection | returns slot times + availability only; no staff PII, no other customers' bookings, no internal reasons that leak schedule detail beyond "unavailable" |
| SEC-PUB-4 | browser bundle / network | no `service_role` key, no Channel Access Token, no Channel Secret (existing test `line-config.test.ts` — extend to new endpoints) |
| ~~SEC-PUB-5~~ | DELETED (AMENDMENT 1 A3 — DATE_RANGE deferred) |

### 3.8 Idempotency & audit (brief §13)

| ID | Scenario | Expected |
|---|---|---|
| SEC-IDEM-1 | retried `create_service` / `create_staff` / `create_shop_holiday` with the same `p_idempotency_key` | one row, not two (pattern already present — regression guard) |
| SEC-IDEM-2 | `shop_weekly_closures` add: retried "close Tuesday" | idempotent (PK collision → no-op or explicit) |
| SEC-IDEM-3 | mode switch RPC retried | terminal state, no duplicate side effects |
| SEC-IDEM-4 | every new config mutation (`weekly_closure_mode`, closures, booking config, payment, deposit) | writes an `audit_events` row with actor, action, target, before/after |
| SEC-IDEM-5 | `customer_reschedule_booking` retried with same params | one reschedule, one audit event, one notification (idempotency key on the notification log — already present) |

### 3.9 Rollback / recovery (brief §13, §16.8)

| ID | Requirement |
|---|---|
| SEC-RB-1 | every R7 forward migration ships with a tested `*_rollback` counterpart (pattern: `bk01_platform_bootstrap` + `bk01_platform_bootstrap_rollback`) |
| SEC-RB-2 | rollback of `shop_weekly_closures` / new `shops` columns restores pre-migration BK01, PS01, MT01 and shared-surface signatures (Junction A discipline) |
| SEC-RB-3 | a shop that configured `SHOP_WEEKLY` before a rollback degrades safely to `STAFF_WEEKLY` behaviour, no availability corruption |
| ~~SEC-RB-4~~ | DELETED (AMENDMENT 1 A3 — DATE_RANGE deferred) |

---

## 4. Test execution plan (R7/R8, on approved runtime only)

| Layer | Where | Tooling |
|---|---|---|
| pure logic (readiness, numeric field, time parse, booking-state, availability layer reducer) | `tests/*.test.ts` | `npm test` — **can run now**, no DB |
| RPC authorization / tenant / negative | WSTERA LAB pgTAP (pattern: CONT-04 `26/26`) | pgTAP, extension removed after run |
| concurrency / collision | LAB, parallel session harness | scripted concurrent RPC calls |
| public surface | `tests/public-contract.test.ts` + network capture on staging | extend existing |
| browser / mobile E2E (positive + every negative) | consumer + admin staging, or KMO downstream pilot | manual + screenshots |
| rollback | LAB, signature diff | `db:bk01:verify` + manual signature capture |

Nothing is accepted on `npm test` alone (brief §16). The pure-logic layer is the only part
runnable pre-Junction-A; everything else waits for R7.

## 5. Junction A status

- This matrix: allowed now.
- Pure-logic tests for R4 helpers: runnable now (`npm test`).
- All RPC/tenant/concurrency/rollback tests: **blocked** — require WSTERA LAB, i.e. after
  Junction A PASS (R7/R8).
- No shared surface probed here beyond the existing regression guards.

## R6 verdict

**SECURITY REVIEW & NEGATIVE-TEST MATRIX:** LOCKED.

- 8 confirmed source-level security gaps recorded; SEC-GAP-1/2/3 are P0 and already tracked
  as KMO-X1/X2/X3.
- ~70 negative tests specified across weekly closure, availability primitive, profile/payment
  split, deposit integrity, booking config, tenant isolation, public minimization,
  idempotency/audit, and rollback.
- 2 R6 action items (verify `create_service`/`update_service` and schedule/holiday RPC
  bodies) are source-only and can be done before R7.
- Execution is R7/R8 on approved runtime; only the pure-logic layer runs pre-Junction-A.

**Next:** R0–R6 consolidated handoff — findings table, hardcode inventory, contract V2,
proposed schema/domain delta, this security matrix, source changes deliverable now,
browser-evidence owed list, blocked-by-Junction-A list, ready-to-implement-on-A-pass list.
