# R0–R6 Amendment Log — Review Gate 2026-09-09

**Gate verdict (CEO):** PASS WITH AMENDMENT.
**Frozen audit baseline:** `docs/bk01-real-shop-hardening` @ `520bb08` — pushed to origin,
**not merged, not modified**. Permanent evidence/design checkpoint.
**Amendment branch:** `docs/bk01-real-shop-hardening-r2` (from `520bb08`).
**Implementation branch (opened after this log):** `feature/bk01-real-shop-hardening-r4`.

This log is the authority for what changed between the frozen baseline and the amended
design. Each amended document carries an `## AMENDMENT 1` block near its top that overrides
its body on conflict; this log is the cross-document index and rationale.

---

## A1 — Slot interval is not an enum; slot interval ≠ service duration

**Frozen said:** `slot_interval_minutes int NOT NULL DEFAULT 30 CHECK (slot_interval_minutes
IN (5,10,15,20,30,60))` (R2 §6, R3 §6, R5 §3); service duration `min={15} step={15}` and a
server rule "multiple of 15 minutes".

**Problem:** the `IN (...)` set is an invented constraint with no system basis — it is the
same class of defect (hardcoded merchant policy) that R1 was auditing. A shop may
legitimately run 25 / 45 / 90-minute slots. The "duration multiple of 15" rule (KMO-07) is
the same mistake one level down.

**Amended:**
- `slot_interval_minutes int NOT NULL DEFAULT 30 CHECK (slot_interval_minutes BETWEEN 1 AND 1440)`.
- Slot interval governs only the offered start-time grid. **Service duration is a separate,
  independent value** and need not be a multiple of the slot interval or of anything.
- R7 removes "duration must be a positive multiple of 15 minutes" from `create_service` /
  `update_service` (`20260807175455_...:89,155`). Duration = free positive integer minutes.
- `slot_generation_strategy` (fixed grid vs dynamic back-to-back start times) = documented
  **future capability**, not built. V1 = fixed grid.
- New R4 item **R4-9**: admin duration input `min={15} step={15}` → `min={1}`.

**Docs touched:** R2 (AMENDMENT A1), R3 (AMENDMENT A1), R5 (AMENDMENT A1), R6 (SEC-BC-2
rewritten, SEC-BC-6 added, SEC-AV-6 kept), R4 (R4-9), handoff §4.

---

## A3 — DATE_RANGE fully deferred; V1 = TIME_SLOT only

**Frozen said:** R5 designed `services.scheduling_mode ∈ {TIME_SLOT, DATE_RANGE}`,
`duration_unit ∈ {minute,hour,day}`, `duration_value`, `skip_closed_days`,
`max_concurrent_date_range_jobs`, `bookings.booking_start_date/end_date`, a
`DATE_RANGE` availability walk, and an `is_service_bookable` primitive.

**Problem:** BK01 **Order** already owns day-based production semantics —
`production_weekly_schedule`, `production_day_overrides`, day-level capacity, single
target-day allocation (`docs/order/01_ORDER_V1_CONTRACT.md:60,71,84,119`). Building a
parallel day-range calendar inside Booking before the Booking ↔ Order ownership boundary is
decided risks two half-overlapping production calendars — brief §14 forbids exactly this.

**Amended:**
- V1 implements `TIME_SLOT` only. `DATE_RANGE` status = **`DEFERRED — pending Booking ↔
  Order ownership decision`**.
- This round creates **none** of: `scheduling_mode`, `duration_unit`, `duration_value`,
  `skip_closed_days`, `max_concurrent_date_range_jobs`, `booking_start_date`,
  `booking_end_date`, date-range capacity/overlap logic, `is_service_bookable`.
- One primitive only: `is_slot_bookable` (`TIME_SLOT` semantics).
- The R5 §4 day-by-day calendar walk (skip closed days, derived end date, production-day vs
  calendar-day count, inclusive overlap, per-resource capacity — **not** `days × 1440`) is
  **retained verbatim as the design of record** for whenever DATE_RANGE is built.
- The only new service-scheduling column this phase: `shops.slot_interval_minutes`.

**Docs touched:** R5 (AMENDMENT A3 — §2–§6 relabelled "deferred design record"), R2
(AMENDMENT A3 — no `is_service_bookable`), R3 (AMENDMENT A3 — D4 stores one minute value),
R6 (SEC-AV-8/9, SEC-PUB-5, SEC-RB-4 deleted; SEC-RB-3 de-DATE_RANGE'd), handoff §4/§8/§9.

---

## A4 — "Bookable Resource" framing; V1 = Staff; no `resource_kind` column

**Frozen said:** R5 introduced `services.requires_provider boolean` and a `resource_kind`
future-proof column suggestion; the primitive was `is_slot_bookable(shop, staff_id, ...)`.

**Problem:** real shops book staff **or** rooms / tables / repair bays / vehicles / tools.
The design must not bake "staff is the only bookable thing" into the calendar/config in a
way that forces a Booking rewrite later — but a Resource Engine now is overbuild.

**Amended:**
- Concept name: **Bookable Resource**. **V1 implementation = Staff** (`staff` table /
  `bookings.staff_id`). Future kinds: Staff / Room / Table / Bay / Vehicle / Equipment.
- **No `resource_kind` column added** this round.
- Shared primitive keeps the generic name `is_slot_bookable`; its resource parameter is
  `staff_id` in V1. Contract layers 4–6 are written as "the assigned Bookable Resource",
  not "staff".
- Shop-level layers 1–3 and all shop calendar/config (`weekly_closure_mode`,
  `shop_weekly_closures`, booking config) stay resource-agnostic — verified they contain no
  staff-only assumption; keep it that way.
- Documented: the V1 resolver maps a Bookable Resource → `staff_id`. A future
  `booking_resources` table + `bookings.resource_id` generalises without touching the
  precedence contract.
- `requires_provider` retained as a boolean, documented as "requires a Bookable Resource;
  Staff-only in V1" (no schema change this round — it is not created either; the existing
  implicit "a service may or may not need a specific staff" behaviour is unchanged for V1).

**Docs touched:** R2 (AMENDMENT A4), R3 (AMENDMENT A4 — D5), R5 (AMENDMENT A4), R6
(SEC-AV-10 added), handoff §4.

---

## B1 — Deposit defaults: new shops opt IN; NULL means "not set"

**Frozen said:** R3 kept `shops.require_deposit DEFAULT true` and noted `default_deposit_amount
DEFAULT 100`; recommended flipping but not firmly.

**CEO decision:** firm.

**Amended:**
- New shops: `require_deposit` default **`false`**, `default_deposit_amount` default
  **`NULL`**.
- `NULL` ≠ `0`. `NULL` = "not set, never resolves to a number". `0` on a service still means
  "explicit no deposit for that service".
- **Existing rows are not rewritten** — the `ALTER COLUMN ... SET DEFAULT` only affects new
  inserts.
- **Consistency sweep (R7 + R4 + R6):** DB column default; `provision_owner_shop`;
  registration/onboarding UI; `seed_demo_shop`; every `tests/` fixture; consumer client
  fallback (`?? 100` removed); admin client (`price*0.3` auto and `100` seed removed).
- **Fail-closed:** `require_deposit = true` AND (no resolvable amount OR no valid PromptPay
  recipient) → `create_booking_hold` raises `PAYMENT_NOT_CONFIGURED`; consumer shows the
  "payment not configured" negative state; admin readiness `payment` = attention. No
  fallback recipient, no fallback amount, ever (KMO-X3).

**Docs touched:** R3 (AMENDMENT B1 + default-status confirmation table), R6 (SEC-PP-11,
SEC-DEP-5/6, SEC-FIX-1), R4 (R4-7 / R4-5 logic), handoff §4.

---

## Default-status confirmation (CEO ask B — all overridable, none business truth)

Every configurable value is a `shops` or `services` column with an owner/admin RPC setter:
`booking_enabled`, `weekly_closure_mode`, `slot_interval_minutes`, `booking_lead_time_minutes`,
`booking_horizon_days`, `reminder_offsets_minutes`, `reminder_enabled`,
`services.duration_minutes`, `require_deposit`, `default_deposit_amount`,
`customer_cancel_before_hours`, `customer_reschedule_before_hours`.

Invariants (code, not merchant-settable): tenant isolation, auth boundaries, server-side
collision prevention, idempotency + atomic state, payment recipient must be real, audit for
sensitive mutations, bounded public exposure, fail-closed on missing security/payment
authority, lifecycle transition integrity.

---

## Consistency check

Run after all AMENDMENT blocks were written. Cross-checked pairs:

| Check | Result |
|---|---|
| `slot_interval_minutes BETWEEN 1 AND 1440` everywhere it appears | consistent — R2 §6, R3 §6, R5 §3, handoff AMENDMENT all patched inline; `grep "IN (5,10,15,20,30,60)"` now returns only prose that *quotes the withdrawn enum* to say it is withdrawn (R2 A1, log) |
| No doc creates `scheduling_mode` / `duration_unit` / `booking_start_date` as V1 | R3 §6 patched inline ("NO new columns"); handoff §4 replaced with pointer to AMENDMENT 1; R6 DATE_RANGE tests struck inline (SEC-AV-8/9, SEC-PUB-5, SEC-RB-4). R5 §2 / §4–§6 retained as the labelled **deferred design record** (AMENDMENT A3 relabels them) — this is deliberate, not a contradiction |
| `is_service_bookable` not a V1 primitive | only `is_slot_bookable` in every authoritative spot (R2 §7 body, handoff); `is_service_bookable` remains only in R5's deferred design record and the amendment prose that removes it |
| Deposit default `false` / `NULL`, existing rows not rewritten | consistent — R3 AMENDMENT + R3 §6 inline + R6 SEC-PP-11/SEC-DEP-5/6 + handoff AMENDMENT |
| Bookable Resource / V1 = Staff / no `resource_kind` | consistent — R2, R3, R5, R6 (SEC-AV-10), handoff |
| Junction A partition unchanged: schema/RPC still R7; R4 now 9 items, still source-only | consistent |
| Frozen `520bb08` named as do-not-touch baseline in every amended doc | consistent |
| `npm test` 27/27 unchanged — amendments are docs only | confirmed |

**Residual (intentional):** R5 §2 and §4–§6 keep the full DATE_RANGE design (modes, unit,
day-walk, capacity). AMENDMENT A3 relabels them "deferred design record — not V1 work". This
is kept on purpose: when the Booking ↔ Order boundary is decided, that design is ready and
correct (it is calendar iteration, not `days × 1440`). Every *operational* doc (R3, R6,
handoff) is clean of DATE_RANGE V1 schema.

## Verdict

**AMENDMENT 1: COMPLETE.** 4 contract changes applied via override blocks across R2, R3, R4,
R5, R6 and the consolidated handoff. Consistency check passed with one intentional residual
(preserved pre-amendment text). Frozen `520bb08` untouched. Ready to open
`feature/bk01-real-shop-hardening-r4` for the 9 source items.
