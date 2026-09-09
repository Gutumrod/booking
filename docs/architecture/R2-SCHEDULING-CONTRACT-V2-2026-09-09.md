# R2 — Scheduling Contract V2

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R2 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** CONTRACT LOCK / DESIGN — no code change, no LAB migration
**Branch:** `docs/bk01-real-shop-hardening`
**Consumes:** R0 (KMO-01, KMO-05, KMO-X1, KMO-X2), R1 (HC-12, HC-17, HC-27, HC-28, HC-36/37),
`BRIEF-BK01-SHOP-WEEKLY-CLOSURE-ADDENDUM-2026-09-09.md`

## Purpose

Lock the availability model before any implementation. This document is the single
authority for how BK01 decides whether a time is bookable. Consumer availability, admin
availability preview, `create_booking_hold`, `customer_reschedule_booking`, and any future
trusted mutation path must all implement **this precedence and nothing else**.

Nothing here is applied to WSTERA LAB. Implementation is R7, after Junction A PASS.

---

## 1. Model overview

Availability is decided by six layers, evaluated top-down. The first layer that says "no"
wins; if no layer says "no", the slot is available.

```
1. Shop gate        shop inactive OR billing-blocked            -> NO SLOT (whole shop)
2. Shop exact-date  shop_holidays row, staff_id IS NULL, = date -> NO SLOT (whole shop, that date)
3. Recurring weekly  selected weekly-closure mode (see §2)       -> NO SLOT (per rule)
4. Staff exact-date staff_holidays row for that staff, = date   -> staff unavailable that date
5. Staff working     staff_schedules: not working / outside      -> staff unavailable that slot
                     work_start..work_end / inside break
6. Collision         overlapping hold|pending_review|confirmed   -> staff unavailable that slot
                     booking for that staff
-------------------------------------------------------------------------------------------
   otherwise                                                     -> SLOT AVAILABLE
```

This is exactly the brief §6 precedence:
`shop inactive/billing blocked -> exact-date shop closure -> selected recurring-weekly policy
-> staff exact-date time-off -> staff working time/break -> existing booking collision -> slot available`

### Layer semantics

| # | Scope | Meaning | Source of truth |
|---|---|---|---|
| 1 | whole shop, all dates | `shops.is_active = false`, or billing state blocks booking | `shops`, billing gate (existing `SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS`) |
| 2 | whole shop, one date | manual exact-date closure ("ปิดร้าน 13 เม.ย.") | `shop_holidays` (`staff_id IS NULL`) |
| 3 | see §2 | recurring weekly closed day(s) | `shops.weekly_closure_mode` + (`shop_weekly_closures` or `staff_schedules`) |
| 4 | one staff, one date | staff leave / day off | `shop_holidays` (`staff_id = X`) — **rename direction §6** |
| 5 | one staff, recurring slot | working hours + break for that weekday | `staff_schedules` |
| 6 | one staff, one slot | already-booked overlap | `bookings` where `status IN ('hold','pending_review','confirmed')` and not expired |

---

## 2. Recurring weekly closure — the mode switch

A shop operates in **exactly one** weekly-closure mode at a time. The mode is a new
shop-level field.

### `shops.weekly_closure_mode` — enum, NOT NULL

| Value | Meaning |
|---|---|
| `SHOP_WEEKLY` | Recurring weekly open/closed days are controlled at **shop** level. |
| `STAFF_WEEKLY` | Recurring weekly availability/off-days are controlled **per staff member**. |

**Default for existing shops on migration:** `STAFF_WEEKLY`.
Rationale: current BK01 already derives weekly availability from `staff_schedules` only
(R1 evidence, `create_booking_hold` reads `staff_schedules`). `STAFF_WEEKLY` is
behaviour-preserving; every existing shop keeps working with no config action. Brief
§6.5 / addendum §5–6 require this compatibility.

### Mode A — `SHOP_WEEKLY`

- Recurring weekly closed days live in a new table `shop_weekly_closures(shop_id, day_of_week)`.
  A row means "the whole shop is closed every <day_of_week>".
- Layer 3 evaluates: `EXISTS shop_weekly_closures WHERE shop_id = ? AND day_of_week = dow(date)`
  → NO SLOT for the whole shop that weekday, **even if a staff member is individually marked
  working** (addendum §2).
- Per-staff *recurring weekly off-day* control is **disabled** in the admin UI in this mode
  (addendum: "recurring weekly off-day controls at individual staff level are disabled").
- Staff `staff_schedules` rows still apply for **working time / break refinement** on days
  the shop is open (layer 5). They may narrow availability within an open day; they may not
  re-open a shop-closed weekday.
- Missing `shop_weekly_closures` rows ⇒ **no shop-level weekly closure** (addendum §6 —
  do not infer one from staff rows).

### Mode B — `STAFF_WEEKLY`

- No `shop_weekly_closures` rows are consulted (layer 3 is a no-op).
- Recurring weekly availability is fully per-staff via `staff_schedules.is_working_day`
  (layer 5 absorbs it).
- Shop-level recurring weekly closure controls are **disabled** in the admin UI in this mode.

### Always independent of the mode

| Mechanism | Scope | Model | Applies in both modes |
|---|---|---|---|
| **Shop Special Closure** | whole shop, exact calendar date | `shop_holidays` (`staff_id IS NULL`) | yes (layer 2) |
| **Staff Date Time-Off** | one staff, exact calendar date | `shop_holidays` (`staff_id = X`) — see §6 | yes (layer 4) |

Both are exact-date. Neither is affected by `weekly_closure_mode`. Brief §6 "Always
independent".

---

## 3. `day_of_week` convention

`0 = Sunday … 6 = Saturday`, matching:
- `staff_schedules.day_of_week CHECK (BETWEEN 0 AND 6)` with comment `-- 0=Sunday`
  (`supabase/migrations/20260807051629_staff_schedules.sql:9`),
- Postgres `EXTRACT(DOW FROM date)` used in `create_booking_hold`
  (`...20260807051839_...:133`),
- JS `Date.getDay()` used in the consumer client (`book/[slug]/page.tsx:166`).

`shop_weekly_closures.day_of_week` MUST use the same `CHECK (day_of_week BETWEEN 0 AND 6)`.
No timezone-shift bug today (client builds the date as `new Date(\`${selectedDate}T00:00:00\`)`
local) but R7 SHOULD compute `dow` **server-side from the booking date** as the authority and
treat the client value as advisory.

---

## 4. Missing / incomplete data behaviour (fail-closed)

| Condition | Result | Basis |
|---|---|---|
| No `staff_schedules` row for (staff, weekday) | staff **unavailable** that weekday | existing invariant, `phase_c_fail_closed_staff_schedules.sql` — keep |
| `weekly_closure_mode = SHOP_WEEKLY`, no `shop_weekly_closures` rows | no shop weekly closure; fall through to staff layers | addendum §6 |
| `weekly_closure_mode` missing (should be impossible — NOT NULL) | treat as `STAFF_WEEKLY` | safest compatibility |
| No active staff at all | every slot **unavailable**; consumer shows "no provider" state (R4 / KMO-09) | brief §11 |
| No active services | booking cannot start; consumer shows "no services" state | brief §11 |
| Shop has services + staff but zero `staff_schedules` rows | every slot **unavailable**; consumer shows "schedule not configured" state | brief §11 |
| Service requires a specific provider and none is available | slot **unavailable** for that service | brief §11 |

Fail-closed is the rule everywhere: absence of positive availability data means **not
bookable**, never "assume open".

---

## 5. Authority (who may mutate)

| Object | owner | admin | staff | outsider / cross-shop |
|---|---|---|---|---|
| `shops.weekly_closure_mode` | ✅ | ✅ | ❌ deny | ❌ fail closed |
| `shop_weekly_closures` (add/remove weekday) | ✅ | ✅ | ❌ deny | ❌ fail closed |
| `shop_holidays` (`staff_id IS NULL`, special closure) | ✅ | ✅ | ❌ deny (currently UI-gated only — R6 must prove DB/RPC deny) | ❌ fail closed |
| `shop_holidays` (`staff_id = X`, staff time-off) | ✅ | ✅ | staff: **self only**, if contract allows — decide in R3; default deny | ❌ fail closed |
| `staff_schedules` | ✅ | ✅ | ❌ deny (current UI disables; R6 must prove RPC `upsert_staff_weekly_schedule` denies) | ❌ fail closed |
| `shops.customer_cancel_before_hours` / `customer_reschedule_before_hours` | ✅ | ✅ | ❌ | ❌ |

Enforcement MUST be at the RPC / RLS boundary, not only hidden UI controls (brief §13,
KMO evidence that current staff-deny is UI-only in places). R6 builds the negative-test
matrix for each row above.

---

## 6. Data-model direction (for R3 / R7, not applied here)

### New

```sql
-- shop-level recurring weekly closure (Mode A only, but table always present)
ALTER TABLE local_service.shops
  ADD COLUMN weekly_closure_mode text NOT NULL DEFAULT 'STAFF_WEEKLY'
    CHECK (weekly_closure_mode IN ('SHOP_WEEKLY','STAFF_WEEKLY'));

CREATE TABLE local_service.shop_weekly_closures (
  shop_id     uuid NOT NULL REFERENCES local_service.shops(id) ON DELETE CASCADE,
  day_of_week int  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, day_of_week)
);
-- RLS: SELECT for anon via a bounded availability contract only (no raw settings exposure);
--      INSERT/DELETE via owner/admin RPC only.
```

### Rename direction (defer, non-breaking path)

`shop_holidays` currently carries two distinct concepts on one table
(`staff_id IS NULL` = shop special closure; `staff_id = X` = staff date time-off). This is
workable but the name misleads. R3 decides whether to:
- (a) keep the table, add a generated/virtual view split, **or**
- (b) introduce `staff_time_off(staff_id, off_date, reason)` and keep `shop_holidays` for
  shop-only exact dates.

Not decided in R2. Whatever R3 picks, layers 2 and 4 semantics above are fixed.

### Slot interval (from R1 HC-12)

`shops.slot_interval_minutes int NOT NULL DEFAULT 30 CHECK (slot_interval_minutes IN (5,10,15,20,30,60))`
— merchant-configurable; consumer grid is generated from it; `create_booking_hold` MUST
validate `p_start_time` aligns to it (currently unenforced). Exact allowed set finalised in
R5 alongside the TIME_SLOT / DATE_RANGE model.

---

## 7. Shared enforcement primitive (the anti-divergence rule)

R1 HC-27: three hand-written availability checks that disagree. Contract V2 requires **one**
server-side primitive:

```
local_service.is_slot_bookable(
  p_shop_id, p_staff_id, p_service_id, p_booking_date, p_start_time,
  p_exclude_booking_id uuid DEFAULT NULL   -- for reschedule: ignore the row being moved
) RETURNS ( bookable boolean, blocked_layer int, reason text )
```

- `create_booking_hold` calls it (auto-assign loops candidate staff through it).
- `customer_reschedule_booking` calls it with `p_exclude_booking_id = p_booking_id`
  — this closes KMO-X1 / HC-28 (today it has no collision check at all).
- The consumer client calls a **read-only** projection RPC
  (`get_bookable_slots(shop, service, staff?, date)`) that internally uses the same layer
  logic, so the client grid can never show a slot the RPC will reject.
- No path re-implements the precedence inline.

Layer 6 (collision) query is authoritative from `create_booking_hold`
(`tstzrange(b.start_timestamptz, b.end_timestamptz, '[)') && tstzrange(v_start, v_end, '[)')`,
status in `hold|pending_review|confirmed`, `expires_at IS NULL OR > NOW()`), plus
`AND b.id <> p_exclude_booking_id` when excluding.

---

## 8. Acceptance (verified in R7, after Junction A PASS)

From the addendum §"Required acceptance after runtime unlock" plus the mode split:

1. `weekly_closure_mode = SHOP_WEEKLY` + `shop_weekly_closures(Tuesday)` ⇒ Tuesday returns
   no public availability for **every** staff member, even one marked working.
2. Another weekday remains governed by each staff member's `staff_schedules`.
3. An exact-date `shop_holidays` row still closes an otherwise-open weekday.
4. Removing the Tuesday row restores staff-derived availability with **no** rewrite of any
   `staff_schedules` row.
5. `weekly_closure_mode = STAFF_WEEKLY` ⇒ `shop_weekly_closures` rows are ignored; behaviour
   identical to today.
6. Switching a shop from `STAFF_WEEKLY` to `SHOP_WEEKLY` and back is non-destructive
   (staff rows and closure rows both retained).
7. `create_booking_hold`, `customer_reschedule_booking`, and `get_bookable_slots` agree on
   every (shop, staff, date, time) tuple in a randomised cross-check.
8. `customer_reschedule_booking` refuses a move onto an occupied slot (KMO-X1 regression).
9. ordinary staff cannot mutate `weekly_closure_mode` or `shop_weekly_closures` via RPC.
10. cross-shop read/write substitution on the new table fails closed.
11. existing shops with no config keep current behaviour (compatibility).
12. no unauthorized PS01 / MT01 / shared-runtime delta.

---

## 9. Junction A status

- **This document:** contract only — allowed now, applied nowhere.
- `weekly_closure_mode` column, `shop_weekly_closures` table, `slot_interval_minutes`,
  `is_slot_bookable`, `get_bookable_slots`, the reschedule collision fix: **all BLOCKED by
  Junction A** — product-local forward migrations, land in R7 after House returns platform
  isolation PASS and BK01 re-proves Junction A PASS.
- No object here touches `auth`, `net`, PS01, MT01 or any shared surface.

## R2 verdict

**SCHEDULING CONTRACT V2:** LOCKED.

- Two modes (`SHOP_WEEKLY`, `STAFF_WEEKLY`), default `STAFF_WEEKLY` for compatibility.
- Two always-independent exact-date mechanisms (shop special closure, staff date time-off).
- Six-layer precedence, fail-closed, matching brief §6 exactly.
- One shared server primitive `is_slot_bookable` + read projection `get_bookable_slots`;
  no inline re-implementation permitted — this is the structural fix for KMO-X2 and the
  reschedule double-book (KMO-X1).
- Authority table defined; R6 turns each row into a negative test.

**Next:** R3 — merchant configuration architecture (Profile / Booking config / Schedule /
Services / Staff / Payment / Notifications / Readiness as separate concerns; Profile
saveable without PromptPay).
