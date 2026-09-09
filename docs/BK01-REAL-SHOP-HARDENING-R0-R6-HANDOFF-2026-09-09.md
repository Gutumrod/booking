# BK01 Real-Shop Hardening — R0–R6 Consolidated Handoff

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Brief:** `docs/BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Branch:** `docs/bk01-real-shop-hardening` (from `feature/bk-a-v1-contract-remediation` @ `edeb49e`)
**Mode:** prepare-only — no WSTERA LAB migration, no shared-runtime change, no Order/Claim
live integration. Junction A remains `FAIL / ROLLED BACK`.
**Baseline:** `npm test` 27/27 pass; working tree changes are docs only.

---

## AMENDMENT 1 — 2026-09-09 R0–R6 Review Gate (CEO): PASS WITH AMENDMENT

Frozen audit baseline: `docs/bk01-real-shop-hardening` @ `520bb08` (pushed, **do not merge**,
do not modify). Amendments live on `docs/bk01-real-shop-hardening-r2`. Full rationale:
`docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`.

Four contract changes; §4 (schema delta), §7 (browser evidence), §8 (blocked) and §9 (ready)
below are superseded by this block where they conflict:

**A1 Slot interval** — `slot_interval_minutes int NOT NULL DEFAULT 30 CHECK (BETWEEN 1 AND 1440)`
(not an enum). Slot interval ≠ service duration. Remove the "duration multiple of 15" rule
from `create_service`/`update_service` in R7. `slot_generation_strategy` = future capability.

**A3 DATE_RANGE — fully DEFERRED.** V1 = `TIME_SLOT` only. This round does **not** create
`services.scheduling_mode`, `duration_unit`, `skip_closed_days`,
`max_concurrent_date_range_jobs`, `bookings.booking_start_date/end_date`, or any date-range
capacity logic. Reason: Order already owns production-calendar semantics
(`production_weekly_schedule` / `production_day_overrides` / capacity) — the Booking ↔ Order
boundary must be decided first (brief §14). The day-walk design in R5 §4 is retained as the
design of record for when it is built.

**A4 Bookable Resource** — the reserved unit is a "Bookable Resource"; **V1 = Staff**. No
`resource_kind` column. Shared primitive keeps the generic name `is_slot_bookable` (staff_id
parameter in V1); its layers 4–6 are written as "the assigned Bookable Resource". Shop
calendar/config stays resource-agnostic. V1 resolver maps resource → `staff_id`.

**B1 Deposit defaults** — new shops: `require_deposit` default `false`, `default_deposit_amount`
default `NULL` (≠ 0, = "not set"). Existing rows not rewritten. Consistency required across
DB default, `provision_owner_shop`, onboarding UI, `seed_demo_shop` + test fixtures, and
client fallbacks. If `require_deposit = true` but amount unset or PromptPay recipient
missing → `create_booking_hold` `PAYMENT_NOT_CONFIGURED` + readiness error; never a fallback.

**Revised schema delta (replaces §4):**
```sql
-- R7, product-local, behaviour-preserving for existing rows

ALTER TABLE local_service.shops
  ADD COLUMN booking_enabled            boolean NOT NULL DEFAULT true,
  ADD COLUMN weekly_closure_mode        text    NOT NULL DEFAULT 'STAFF_WEEKLY'
       CHECK (weekly_closure_mode IN ('SHOP_WEEKLY','STAFF_WEEKLY')),
  ADD COLUMN slot_interval_minutes      int     NOT NULL DEFAULT 30
       CHECK (slot_interval_minutes BETWEEN 1 AND 1440),
  ADD COLUMN booking_lead_time_minutes  int     NOT NULL DEFAULT 0   CHECK (booking_lead_time_minutes >= 0),
  ADD COLUMN booking_horizon_days       int     NOT NULL DEFAULT 60  CHECK (booking_horizon_days BETWEEN 1 AND 365),
  ADD COLUMN reminder_offsets_minutes   int[]   NOT NULL DEFAULT '{1440,60}',
  ADD COLUMN reminder_enabled           boolean NOT NULL DEFAULT true;
ALTER TABLE local_service.shops ALTER COLUMN require_deposit SET DEFAULT false;      -- new shops
ALTER TABLE local_service.shops ALTER COLUMN default_deposit_amount DROP DEFAULT;    -- -> NULL
-- customer_cancel_before_hours / customer_reschedule_before_hours already exist (bk_a_v1)

CREATE TABLE local_service.shop_weekly_closures (
  shop_id     uuid NOT NULL REFERENCES local_service.shops(id) ON DELETE CASCADE,
  day_of_week int  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, day_of_week)
);

-- services: NO new columns this round. duration_minutes stays a single integer.
--   R7 removes the "multiple of 15" rule from create_service / update_service.

-- bookings: NO new columns this round.

-- new RPCs: is_slot_bookable (TIME_SLOT only, staff_id resource param),
--           get_bookable_slots (read projection), get_shop_readiness,
--           update_shop_profile / update_shop_payment (split), + provision_owner_shop change,
--           create_booking_hold PAYMENT_NOT_CONFIGURED + slot-alignment + lead/horizon guards,
--           customer_reschedule_booking -> call is_slot_bookable (collision fix, KMO-X1).
-- every forward migration ships a tested *_rollback.
```

**Not created this round (was in the frozen §4):** `services.scheduling_mode`,
`duration_unit`, `duration_value`, `requires_provider` column, `skip_closed_days`,
`max_concurrent_date_range_jobs`, `bookings.booking_start_date/end_date`. All belong to the
deferred DATE_RANGE work.

**R4 items after amendment (source-only, pre-Junction-A):** the 8 in R4 spec **plus R4-9**
(remove `min={15} step={15}` from the admin duration input → free positive integer minutes;
optional pure-UI hour display). R4-7 deposit logic uses the B1 rules (no `?? 100`, server
value only, `PAYMENT_NOT_CONFIGURED` when `require_deposit=true` and unset).

---

## Phase documents

| Phase | Document | Status |
|---|---|---|
| R0 Evidence lock | `docs/audit/R0-KMO-EVIDENCE-LOCK-2026-09-09.md` | LOCKED |
| R1 Hardcode audit | `docs/audit/R1-HARDCODE-AUDIT-2026-09-09.md` | COMPLETE (44 entries) |
| R2 Scheduling Contract V2 | `docs/architecture/R2-SCHEDULING-CONTRACT-V2-2026-09-09.md` | LOCKED |
| R3 Merchant config architecture | `docs/architecture/R3-MERCHANT-CONFIG-ARCHITECTURE-2026-09-09.md` | LOCKED |
| R4 UX remediation spec | `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md` | SPEC LOCKED, 8 items ready |
| R5 Service scheduling model | `docs/architecture/R5-SERVICE-SCHEDULING-MODEL-2026-09-09.md` | LOCKED |
| R6 Security & negative-test matrix | `docs/audit/R6-SECURITY-NEGATIVE-TEST-MATRIX-2026-09-09.md` | LOCKED (~70 tests) |

R7 (canonical runtime implementation) and R8 (KMO resync + pilot round 2) are **not
started** — they require Junction A PASS first.

---

## 1. Findings table (from R0)

9 KMO pilot findings + 5 discovered during source reproduction. Full detail in R0.

| ID | Summary | Class | Severity | Junction A |
|---|---|---|---|---|
| KMO-01 | Shop weekly closure has no shop-level source of truth (tester misread per-staff edits as a shop capability) | ARCHITECTURE_GAP | P1 | BLOCKED |
| KMO-02 | Native `<input type=time>` hard to operate on mobile | UX_GENERIC | P1 | clear (R4-3) |
| KMO-03 | No in-app customer preview; empty service set unexplained | UX_GENERIC | P1 | clear (R4-5) |
| KMO-04 | Special shop holidays add/delete — **working capability** | — | — | — |
| KMO-05 | Saving one staff schedule discards unsaved edits to others | BUG_GENERIC | **P0** | clear (R4-4) |
| KMO-06 | Shop profile cannot be saved without PromptPay (two RPCs: `update_shop_settings` + `provision_owner_shop`) | BUG_GENERIC | **P0** | PARTIAL (RPC split, R7) |
| KMO-07 | Service duration minute-only, 15-minute assumption (client + server) | ARCHITECTURE_GAP | P1 | BLOCKED |
| KMO-08 | Numeric fields coerce empty input to 0 | UX_GENERIC | P1 | clear (R4-2) |
| KMO-09 | Customer page HTTP 200 with a dead booking flow | BUG_GENERIC + UX_GENERIC | **P0** | clear for UI (R4-6) |
| KMO-X1 | `customer_reschedule_booking` has no collision check → server double-book; also violates `docs/05_BOOKING_DOMAIN_RULES.md:44` | BUG_GENERIC | **P0** | PARTIAL (R7) |
| KMO-X2 | Three divergent availability implementations | ARCHITECTURE_GAP | **P0** | PARTIAL (R7) |
| KMO-X3 | Consumer invents PromptPay recipient `0812345678` + deposit `100` | BUG_GENERIC | **P0** | clear client (R4-7) + R7 server guard |
| KMO-X4 | Price change auto-overwrites deposit with 30% | BUG_GENERIC | P0 | clear (R4-1) |
| KMO-X5 | Phone validation differs Booking vs Ticket | ARCHITECTURE_GAP | P1 | clear |

**P0 count: 7.**

---

## 2. Hardcode inventory (from R1)

44 entries, `HC-01…HC-42` + `HC-07b/c`. Categories:
`MERCHANT_CONFIG` (shop-settable) / `PRODUCT_DEFAULT` (overridable default) /
`SYSTEM_INVARIANT` (stays in code, must be stated) / `COSMETIC`.

**P0 subset:** HC-01 (auto-30%), HC-02 (invented PromptPay), HC-03 (invented deposit),
HC-07 + HC-07b (PromptPay gates profile save + registration), HC-27 (divergent precedence),
HC-28 (reschedule double-book).

**Merchant config that must exist but doesn't:** shop weekly closure (HC-17), slot interval
(HC-12), booking lead time, booking horizon, reminder offsets (HC-23), service scheduling
mode/unit (HC-09).

**Merchant config that exists but is unreachable:** `customer_cancel_before_hours` /
`customer_reschedule_before_hours` — columns present, no UI, no RPC parameter (HC-36/37);
`customer_reschedule` is dead for every shop as a result.

Full table with file:line and Junction A partition in R1.

---

## 3. Scheduling Contract V2 (R2)

Six-layer fail-closed precedence (brief §6 exactly):

```
shop inactive/billing → exact-date shop closure → recurring weekly policy →
staff exact-date time-off → staff working time/break → booking collision → available
```

- **Two modes:** `shops.weekly_closure_mode ∈ {SHOP_WEEKLY, STAFF_WEEKLY}`,
  default `STAFF_WEEKLY` (behaviour-preserving for every existing shop).
- **Two always-independent exact-date mechanisms:** shop special closure, staff date time-off.
- **One shared server primitive** `is_slot_bookable` / `is_service_bookable` +
  read-only projection `get_bookable_slots` — no path re-implements availability. This is the
  structural fix for KMO-X1 and KMO-X2.
- Authority matrix defined (R2 §5).
- 12 acceptance checks (R2 §8), run in R7.

---

## 4. Proposed schema / domain delta (R3 + R5, for R7 — nothing applied)

> **Superseded by AMENDMENT 1.** The authoritative schema delta is the SQL block in
> AMENDMENT 1 at the top of this document. Summary of the difference from the frozen
> baseline: `slot_interval_minutes CHECK` is `BETWEEN 1 AND 1440` (not an enum); **no**
> `services` columns are added this round (`scheduling_mode`, `duration_unit`,
> `duration_value`, `requires_provider`, `skip_closed_days`,
> `max_concurrent_date_range_jobs` are all deferred with DATE_RANGE); **no**
> `bookings.booking_start_date/end_date`; the one primitive is `is_slot_bookable`
> (no `is_service_bookable`); `require_deposit` new-shop default → `false`,
> `default_deposit_amount` default → `NULL`.

All product-local, all with behaviour-preserving defaults for existing rows, no shared
surface touched. Every forward migration ships a tested `*_rollback` (SEC-RB-1).

---

## 5. Security threat / negative-test matrix (R6)

- **8 source-level gaps recorded; 2 closed on inspection** (SEC-GAP-4 deposit>price and
  SEC-GAP-6 staff-deny are both server-enforced — verified 2026-09-09).
- **Live P0 gaps:** SEC-GAP-1 (= KMO-X1), SEC-GAP-2 (= KMO-X2), SEC-GAP-3 (= KMO-X3).
- **~70 negative tests** across: weekly closure (10), availability primitive (9),
  profile/payment split (10), deposit integrity (4), booking config (5), tenant isolation (5),
  public minimization (5), idempotency/audit (5), rollback (4).
- Execution layers: pure logic (`npm test`, runnable now) → pgTAP (LAB, R7) → concurrency
  harness (LAB) → public-contract tests → browser E2E → rollback signature diff.
- Nothing accepted on `npm test` alone (brief §16).

---

## 6. Source changes deliverable now (no Junction A) — R4

8 items, spec + exact diffs + unit-test plan in R4. Ordered by risk:

| # | Item | Files | Test |
|---|---|---|---|
| R4-1 | Remove auto-30% deposit write | `booking-admin/.../dashboard/page.tsx:1315-1319` | none (deletion) |
| R4-8 | Countdown from server `expires_at` | `booking-consumer/.../book/[slug]/page.tsx:65,263` | none |
| R4-2 | Numeric empty-state (`useNumericField`) | admin dashboard + new `lib/` helper | reducer unit test |
| R4-5 | Preview button + readiness panel | admin dashboard + `computeReadiness()` | pure-fn test |
| R4-6 | Consumer truthful negative states | consumer book page + `resolveBookingState()` | pure-fn test |
| R4-7 | Stop inventing PromptPay/deposit (client half) | consumer book page | payment-display guard test |
| R4-3 | HH:MM `time-field.tsx` component | new admin component | parse/format tests |
| R4-4 | Staff-schedule dirty-state + Save All | admin dashboard state logic | merge-reducer test |

Constraint: **no local backend** (`.env.local` production-bound and forbidden; no Docker).
Each item's logic is unit-testable; end-to-end verification is browser proof (§7).

---

## 7. Browser / mobile evidence — OWED

Blocked on an approved runtime target (consumer/admin staging on `wstera-lab`, or the KMO
downstream pilot), **not** on the code. Required before any R4 item or R7 acceptance
(brief §16.4, §16.5):

- R4-2: clear a numeric field → shows empty, not 0; invalid submit blocked.
- R4-3: mobile keyboard-only time entry; picker fallback.
- R4-4: edit two staff, save one, other keeps edits; unsaved-leave guard.
- R4-5: readiness rows truthful on a half-set-up shop; Preview opens pre-completion.
- R4-6: each negative state screen (no services / no staff / no schedule / payment missing /
  load error vs not-found).
- R4-7: deposit-required shop with no PromptPay → not-configured screen, no QR.
- Customer E2E positive: shop → service → provider → date → valid slot → hold/create.
- KMO round-2 (R8): all of the above on a real device.

---

## 8. BLOCKED BY JUNCTION A

Needs a product-local WSTERA LAB forward migration → only after House returns platform
isolation PASS **and** BK01 re-proves Junction A PASS (R7):

- `shops` columns: `booking_enabled`, `weekly_closure_mode`, `slot_interval_minutes`
  (`BETWEEN 1 AND 1440`), `booking_lead_time_minutes`, `booking_horizon_days`,
  `reminder_offsets_minutes`, `reminder_enabled`.
- `shops` default changes: `require_deposit` → `false` (new shops), `default_deposit_amount`
  → `NULL` (existing rows unchanged).
- `shop_weekly_closures` table.
- RPC split: `update_shop_profile` / `update_shop_payment`; `provision_owner_shop` change.
- New RPCs: `is_slot_bookable` (TIME_SLOT, `staff_id` resource param), `get_bookable_slots`,
  `get_shop_readiness`.
- `create_booking_hold`: `PAYMENT_NOT_CONFIGURED` guard, slot-alignment/lead-time/horizon
  checks, call the shared primitive.
- `customer_reschedule_booking`: collision check via the shared primitive (KMO-X1).
- `create_service` / `update_service`: **drop the 15-minute-multiple duration rule**
  (no scheduling-mode params — DATE_RANGE deferred).
- Defaults for HC-04, HC-05, HC-06, HC-11, HC-14, HC-15, HC-18, HC-20, HC-21, HC-23, HC-26
  becoming configurable.
- All pgTAP / concurrency / rollback tests from R6.

**DEFERRED (not blocked — pending Booking ↔ Order boundary decision, AMENDMENT 1 A3):**
`services.scheduling_mode` / `duration_unit` / `skip_closed_days` /
`max_concurrent_date_range_jobs`, `bookings.booking_start_date` / `booking_end_date`,
`is_service_bookable`, the DATE_RANGE availability walk. Design of record kept in R5 §2–§6.

Also still blocked (brief §3): Order/Claim live integration, any PS01/MT01/shared change.

---

## 9. READY to implement the moment Junction A passes (R7 order)

1. Forward migration 1 — `shops` booking-config columns + `require_deposit`/`default_deposit_amount`
   default changes + `shop_weekly_closures` (+ rollback). Prove LAB isolation, PS01/MT01/shared
   signatures unchanged.
2. Forward migration 2 — `create_service`/`update_service` drop the 15-minute duration rule
   (+ rollback). (No `services` schema columns — DATE_RANGE deferred.)
3. `is_slot_bookable` (TIME_SLOT) / `get_bookable_slots` primitive; repoint
   `create_booking_hold` and `customer_reschedule_booking` at it (closes KMO-X1, KMO-X2).
4. `update_shop_profile` / `update_shop_payment` split; `provision_owner_shop` change
   (closes KMO-06); `create_booking_hold` `PAYMENT_NOT_CONFIGURED` guard (closes KMO-X3
   server half).
5. `get_shop_readiness` RPC.
6. Admin Profile/Payment tab split + booking-config tab + `SHOP_WEEKLY` UI (co-lands with 4).
7. Run the full R6 matrix (pgTAP + concurrency + browser E2E + rollback) on LAB.
8. R8 — sync verified fixes to KMO downstream, pilot round 2, real-device E2E.

(DATE_RANGE consumer picker is out — deferred with the DATE_RANGE feature.)

R4's 9 items can land **before** step 1 (source only) once a browser-proof target is
available.

---

## 10. Stop-condition check (brief §17)

None of the R0–R6 work triggered a stop condition:
- no merchant identity / payment info guessed;
- no tenant isolation or server enforcement weakened (design strengthens both);
- no LAB migration attempted;
- no KMO-specific value pushed into generic product code;
- no Order/Claim integration required;
- no PS01 / MT01 / shared-surface delta;
- no PASS claimed on HTTP status / mocks / source inspection alone — every phase states what
  real-user proof is still owed.

## Verdict

**R0–R6: COMPLETE (design/audit/spec).** 7 P0 findings characterised and routed. Contract V2,
config architecture, service model and security matrix locked. 8 UX fixes spec'd and
ready for a browser-proof target. All runtime work partitioned and queued for R7 behind
Junction A. No code behaviour changed; `npm test` still 27/27.
