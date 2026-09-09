# R5 — Service Scheduling Model

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R5 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** DESIGN — no code change, no LAB migration
**Branch:** `docs/bk01-real-shop-hardening`
**Consumes:** R0 (KMO-07), R1 (HC-09, HC-10, HC-11, HC-12), R2 (§6 slot interval, §7 primitive)

## Purpose

Replace the implicit "every service is a same-day minute interval on a 30-minute grid" model
with an explicit scheduling model that supports minute/hour appointments **and** day-based
work, per brief §8. Design only; migration is R7.

Brief §8 constraints, verbatim intent:
- do not solve minute/hour/day by display conversion alone;
- `TIME_SLOT` = minute/hour services occupying a same-day interval;
- `DATE_RANGE` = day-based work that can span dates with real multi-day calendar semantics;
- minute/hour may be normalized internally but the merchant-facing unit must be preserved;
- day-based duration must **not** be `days * 1440 minutes` without cross-date rules;
- no hidden 15/30-minute policy unless it is an explicit configurable product default.

---

## AMENDMENT 1 — 2026-09-09 R0–R6 Review Gate (CEO)

Overrides the body below on conflict. Frozen pre-amendment: `520bb08`. Log:
`docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`.

**A3 — DATE_RANGE is fully DEFERRED. V1 implements `TIME_SLOT` only.**

Reason: BK01 Order already owns day-based production semantics —
`production_weekly_schedule`, `production_day_overrides`, day-level capacity, single
target-day allocation (`docs/order/01_ORDER_V1_CONTRACT.md:60,71,84,119`). Building a
parallel `DATE_RANGE` calendar inside Booking before the Booking ↔ Order ownership boundary
is decided risks two half-overlapping production calendars — exactly what brief §14 forbids.

**This round MUST NOT create:**
- `services.scheduling_mode`
- `services.duration_unit` (and no `duration_unit = 'day'`)
- `services.skip_closed_days`, `services.max_concurrent_date_range_jobs`
- `bookings.booking_start_date` / `bookings.booking_end_date`
- any date-range capacity / overlap logic
- an `is_service_bookable` sibling primitive

**DATE_RANGE status:** `DEFERRED — pending Booking ↔ Order ownership decision.` The
day-by-day calendar walk worked through in §4 below (skip closed days, derived end date,
production-day vs calendar-day count, inclusive overlap, capacity per resource) is
**retained as the design of record for whenever it is built** — it is correct and not
`days × 1440` — but it is not scheduled and not part of V1 schema.

**V1 `TIME_SLOT` scope (what R5 actually delivers):**
- `services.duration_minutes` stays a single integer, minutes.
- Admin duration input: remove `min={15} step={15}` → free positive integer minutes
  (client change, R4). The server-side "multiple of 15" rule in `create_service` /
  `update_service` is removed in R7.
- Optional: a pure-UI minute↔hour *display* toggle (`90 min` ⇄ `1 ชม 30 น`) — presentation
  math only, **no schema column**, no `duration_unit`.
- `shops.slot_interval_minutes int NOT NULL DEFAULT 30 CHECK (BETWEEN 1 AND 1440)` — the one
  new column from this phase; consumer grid generated from it (R2 A1). Slot interval and
  service duration are separate concepts.
- `create_booking_hold` (R7): validate `p_start_time` aligns to `slot_interval_minutes`;
  no duration-multiple rule.

**A4 — Bookable Resource** (see R2 AMENDMENT 1 A4): `requires_provider` is retained as a
boolean but documented as "requires a Bookable Resource; Staff-only in V1". No
`resource_kind` column.

Read §2–§6 below as the **deferred DATE_RANGE design record**, not V1 work.

---

## 1. Current state (evidence)

- `services.duration_minutes INTEGER NOT NULL DEFAULT 30`
  (`supabase/migrations/20260807051615_local_service_initial_schema.sql:43`). One integer,
  minutes, no unit, no mode.
- Admin input: `min={15} step={15}`, default `45` (`dashboard/page.tsx:1296-1306`). The 15
  is invisible product policy (HC-09).
- `create_booking_hold`: `v_end_tz := v_start_tz + (duration_minutes || ' minutes')::interval`
  — same-day interval math only
  (`20260807052329_fix_service_deposit_override.sql:58`).
- Consumer grid: `ALL_TIME_SLOTS` `09:00`–`19:00` in 30-minute steps, client-only,
  service-independent (`book/[slug]/page.tsx:22`). The 30 is invisible product policy
  (HC-12).
- No concept of a service that takes days. KMO (custom fabrication) is exactly this case
  (brief §12).

## 2. The model

### `services.scheduling_mode` — enum, NOT NULL

| Mode | For | Occupies | Booking artifact |
|---|---|---|---|
| `TIME_SLOT` | haircut, consult, repair job with a time appointment | a same-day `[start, end)` interval on one provider | one `bookings` row with `start_timestamptz` / `end_timestamptz` (as today) |
| `DATE_RANGE` | fabrication, multi-day repair, rental, production work | one or more whole days `[start_date, end_date]`, provider optional | one `bookings` row with `booking_start_date` / `booking_end_date`; no wall-clock interval |

**Default on migration:** `TIME_SLOT` for every existing service (behaviour-preserving).

### `services` shape (R7 direction)

```sql
ALTER TABLE local_service.services
  ADD COLUMN scheduling_mode text NOT NULL DEFAULT 'TIME_SLOT'
    CHECK (scheduling_mode IN ('TIME_SLOT','DATE_RANGE')),
  -- merchant-facing unit, preserved for display/edit even though duration is stored in minutes
  ADD COLUMN duration_unit text NOT NULL DEFAULT 'minute'
    CHECK (duration_unit IN ('minute','hour','day')),
  ADD COLUMN duration_value int  NOT NULL DEFAULT 30 CHECK (duration_value > 0),
  ADD COLUMN requires_provider boolean NOT NULL DEFAULT true;
-- duration_minutes becomes a GENERATED column (or is kept in sync by the write RPC) for
-- TIME_SLOT services:  minute -> value ; hour -> value*60 ; day -> NULL (not a minute concept)
```

- `TIME_SLOT` service: `duration_unit ∈ {minute, hour}`, `duration_minutes` derived, used by
  the interval math unchanged.
- `DATE_RANGE` service: `duration_unit = day`, `duration_value` = number of production/work
  days, `duration_minutes` is `NULL` and never used for scheduling.
- The admin form shows a unit dropdown (`นาที / ชั่วโมง / วัน`); picking `วัน` switches the
  service to `DATE_RANGE` and hides the time-of-day fields.

## 3. Slot interval — configurable, not 15/30

From R2 §6 / R3 D2. **AMENDMENT 1 A1:** `CHECK` is `BETWEEN 1 AND 1440`, not an enum;
slot interval ≠ service duration; the "duration multiple of 15" rule is removed in R7.

```sql
ALTER TABLE local_service.shops
  ADD COLUMN slot_interval_minutes int NOT NULL DEFAULT 30
    CHECK (slot_interval_minutes BETWEEN 1 AND 1440);
```

- The **30** default is now an explicit configurable product default (brief §8 requirement
  satisfied).
- The consumer grid is generated from `slot_interval_minutes` + the shop's open hours
  (derived from staff schedules / business hours), not from `ALL_TIME_SLOTS`.
- `create_booking_hold` for `TIME_SLOT` services validates
  `p_start_time` aligns to `slot_interval_minutes` from midnight (or from shop open time).
  Today it validates nothing — any `p_start_time` is accepted. This is a new
  `SYSTEM_INVARIANT` check.
- The 15-minute admin input `step` becomes `slot_interval_minutes` for the duration field's
  granularity, or a free minute input with server validation — decide in R7; either way the
  literal 15 is gone.

## 4. `DATE_RANGE` availability semantics

`DATE_RANGE` does **not** go through the time-slot layers (R2 §1 layers 5–6 are
wall-clock). Its availability is a distinct check:

```
1. Shop gate            shop inactive / billing-blocked            -> unavailable
2. Every day in [start_date, end_date]:
   2a. not a shop exact-date closure (shop_holidays, staff_id IS NULL)
   2b. not a shop recurring weekly closure (if SHOP_WEEKLY mode)
   2c. if requires_provider: the assigned provider is not on exact-date time-off
       and the weekday is a working weekday for that provider
3. Capacity            count of overlapping DATE_RANGE bookings for the same
                       (shop, provider?) on any shared day < capacity limit
-------------------------------------------------------------------------------
   otherwise            available
```

- **No `days * 1440`.** The range is iterated day by day against the calendar. A 3-day job
  starting Friday in a shop closed Sunday either (a) is rejected, or (b) extends to skip the
  closed day — **merchant policy**, a per-service flag `skip_closed_days boolean`
  (default `false` = reject; `true` = extend). Brief §8 "must respect multi-day calendar
  semantics".
- Capacity for `DATE_RANGE` is a shop/service setting (`max_concurrent_date_range_jobs`,
  default 1). This is the Booking analogue of Order's `production_weekly_schedule` capacity
  but stays **Booking-local** — brief §14, do not collapse Booking and Order calendars.
- `DATE_RANGE` bookings still emit the same lifecycle (`hold` → deposit → `confirmed`) and
  audit events; only the availability primitive differs.

### The shared primitive extends

R2 §7 `is_slot_bookable` becomes mode-aware, or gets a sibling:

```
local_service.is_service_bookable(
  p_shop_id, p_staff_id, p_service_id,
  p_start_date, p_start_time,     -- p_start_time NULL for DATE_RANGE
  p_end_date DEFAULT NULL,        -- derived for TIME_SLOT
  p_exclude_booking_id DEFAULT NULL
) RETURNS (bookable boolean, blocked_layer int, reason text)
```

`create_booking_hold`, `customer_reschedule_booking`, and the consumer projection all call
this one function. `TIME_SLOT` path = R2 layers; `DATE_RANGE` path = §4 above. No inline
re-implementation (the anti-divergence rule from R2 §7 still holds).

## 5. Diversity matrix mapping (brief §12)

| Shop style | scheduling_mode | duration_unit | notes |
|---|---|---|---|
| barber / salon | `TIME_SLOT` | minute | short slots, multi-staff, `STAFF_WEEKLY` |
| clinic / wellness | `TIME_SLOT` | minute | `requires_provider = true`, breaks, cancel windows |
| garage / repair | `TIME_SLOT` (short) or `DATE_RANGE` (big jobs) | hour / day | variable duration; a shop may have both kinds of service |
| custom fabrication (KMO) | `DATE_RANGE` | day | production days, `max_concurrent_date_range_jobs`, optional deposit, future Order |
| no-deposit merchant | either | any | `require_deposit = false`; payment onboarding not required (R3) |
| one-person shop | `TIME_SLOT` | minute | `STAFF_WEEKLY`, one staff, simple |
| multi-staff, batch schedule edits | `TIME_SLOT` | minute | R4-4 dirty-state |
| day-based / date-range service | `DATE_RANGE` | day | the reason this phase exists |
| Claim-heavy / support merchant | n/a for Booking | — | profile/support must not depend on Booking payment config (R3) |

## 6. Migration & compatibility (R7)

1. Add columns with behaviour-preserving defaults (`TIME_SLOT`, `minute`,
   `duration_value` from existing `duration_minutes`, `slot_interval_minutes = 30`).
2. Backfill `duration_value = duration_minutes`, `duration_unit = 'minute'` for all rows.
3. Keep `duration_minutes` readable (generated or RPC-synced) so nothing that reads it
   breaks during transition.
4. `create_service` / `update_service` RPCs gain `p_scheduling_mode`, `p_duration_unit`,
   `p_duration_value`, `p_requires_provider`, `p_skip_closed_days`.
5. `create_booking_hold` branches on `scheduling_mode`; `DATE_RANGE` inserts
   `booking_start_date` / `booking_end_date`, `start_timestamptz`/`end_timestamptz` NULL.
6. Consumer booking page: step 2 renders a date-range picker for `DATE_RANGE` services
   instead of the time grid.

## 7. Junction A status

- Design: allowed now.
- Client-only slice deliverable pre-A: none meaningful on its own — the model needs the
  schema. R4-3 already notes it hardcodes `30` with a `// R5` marker until this lands.
- Blocked by Junction A: every column, RPC change, and the `is_service_bookable` primitive —
  product-local, R7.
- No shared surface touched. Booking capacity stays Booking-local; Order's
  `production_weekly_schedule` is not reused (brief §14).

## R5 verdict

**SERVICE SCHEDULING MODEL:** LOCKED.

- Two modes: `TIME_SLOT` (default, behaviour-preserving) and `DATE_RANGE` (day-based, real
  calendar iteration — never `days * 1440`).
- Merchant-facing unit (`minute` / `hour` / `day`) preserved; minutes normalized internally
  for `TIME_SLOT` only.
- Slot interval is an explicit configurable shop default (30), replacing the hidden 15/30
  literals; `create_booking_hold` gains an alignment invariant.
- One mode-aware primitive `is_service_bookable`; no path re-implements availability.
- Diversity matrix (brief §12) mapped to concrete config.

**Next:** R6 — security review: authorization, tenant isolation, public exposure, collision,
idempotency, rollback, and the negative-test matrix for every new configurable surface.
