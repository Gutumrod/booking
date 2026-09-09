# R3 — Merchant Configuration Architecture

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R3 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** DESIGN — no code change, no LAB migration
**Branch:** `docs/bk01-real-shop-hardening`
**Consumes:** R0 (KMO-06, KMO-X3, KMO-X4, KMO-X5), R1 (HC-01…HC-08, HC-07b/c, HC-23, HC-30…HC-37), R2

## Purpose

Split "shop settings" into independent configuration domains so that each can be saved,
validated, and reasoned about on its own. The immediate driver is KMO-06: today profile and
payment are fused, so a shop cannot save its name/phone/address without a PromptPay number,
and cannot even register without one (HC-07b).

Nothing here is applied. Migrations land in R7.

---

## 1. Current state (evidence)

One RPC, `update_shop_settings(p_shop_id, p_name, p_phone, p_address, p_promptpay_number,
p_promptpay_name, p_line_oa_id)`
(`supabase/migrations/20260807191046_phase_e3_3_shop_settings_authorization.sql:47-96`),
writes profile **and** payment together and hard-rejects blank PromptPay
(`:74-80`). `provision_owner_shop` does the same at registration
(`20260807161412_...:58-60`). The admin UI submits everything through one
`handleSaveShopSettings` form (`dashboard/page.tsx:379-402`, tabs "services" and "settings"
both post it).

Other config is scattered:
- schedules → `upsert_staff_weekly_schedule` RPC
- holidays → `create_shop_holiday` / `delete_shop_holiday`
- services → `create_service` / `update_service` / `set_service_active`
- staff → `create_staff` / `set_staff_active` / `link_staff_user`
- cancel/reschedule windows → columns exist (`customer_cancel_before_hours`,
  `customer_reschedule_before_hours`) but **no RPC or UI writes them** (HC-37)
- slot interval, weekly closure mode, reminder policy, lead time, horizon → **not modeled**

## 2. Configuration domains

Eight domains. Each has: its own persistence, its own mutation RPC(s), its own validation
rules, its own readiness signal (R3 §5), and an independent "is this saved / valid" answer.

| # | Domain | Holds | Mutation authority | Save depends on |
|---|---|---|---|---|
| D1 | **Profile** | shop name, phone, address, business category, public contact | owner, admin | nothing else — always saveable |
| D2 | **Booking configuration** | `booking_enabled`, `weekly_closure_mode`, `slot_interval_minutes`, `booking_lead_time_minutes`, `booking_horizon_days`, `customer_cancel_before_hours`, `customer_reschedule_before_hours` | owner, admin | Profile exists |
| D3 | **Schedule** | `staff_schedules` (per staff weekday hours/break), `shop_weekly_closures` (Mode A), `shop_holidays` shop-special, staff date time-off | owner, admin (staff: none / self time-off per §4) | at least one staff (for staff rows) |
| D4 | **Services** | service name, description, duration + scheduling mode (R5), price, deposit rule | owner, admin | nothing |
| D5 | **Staff / providers** | staff name, nickname, phone, active, user link, provider-required flag per service | owner (create/link), owner+admin (activate) | nothing |
| D6 | **Payment** | PromptPay number + name, deposit-required default, (future: other methods), verification state | **owner only** | nothing — but booking with deposit fails closed until valid (§3) |
| D7 | **Notifications** | reminder offsets, channels (Central OA / merchant OA), enable flags | owner, admin | nothing |
| D8 | **Readiness** | derived, read-only — computed capability status (§5) | system | — |

### Design rule

**No domain's save may be blocked by another domain's incompleteness**, except where a
`SYSTEM_INVARIANT` requires it (e.g. you cannot create a `staff_schedules` row for a staff
member that does not exist). Payment being incomplete never blocks Profile, Services,
Schedule or Staff; it only makes a *deposit-required booking flow* fail closed at runtime
(§3).

---

## 3. Profile / Payment separation (the KMO-06 fix)

### RPC split

Replace `update_shop_settings` with:

```
local_service.update_shop_profile(
  p_shop_id, p_name, p_phone, p_address, p_business_category, p_line_oa_id
) -- owner + admin; validates name + phone non-empty; NO payment fields

local_service.update_shop_payment(
  p_shop_id, p_promptpay_number, p_promptpay_name, p_require_deposit, p_default_deposit_amount
) -- owner only; validates PromptPay format ONLY when p_require_deposit or any service
   -- carries a deposit > 0; otherwise PromptPay may be blank
```

`provision_owner_shop` (HC-07b) drops `p_promptpay_number` / `p_promptpay_name` from its
required set. A shop is created with profile + plan; payment is a later, optional step.
Registered shops with `require_deposit = true` (the current default, HC-05) and no PromptPay
land in a **"payment setup required"** readiness state, not a hard error.

### Runtime fail-closed (KMO-X3)

`create_booking_hold` today: if `require_deposit` and a deposit amount resolves `> 0`, it
sets status `hold` / `awaiting` and expects a slip. It never checks that a **payable
recipient exists**. R7 adds: when a deposit is required but
`shops.promptpay_number` is null/invalid → `RAISE EXCEPTION 'PAYMENT_NOT_CONFIGURED'`, and
the consumer shows the brief §11 "payment configuration missing" state. **No** fallback to
`0812345678` (HC-02), **no** fallback amount `100` (HC-03). The consumer client stops
computing its own deposit figure and PromptPay payload; it renders only what the server
returns.

### Deposit is an explicit merchant decision (KMO-X4)

Remove the `setServiceDeposit(price * 0.3)` coupled write (`dashboard/page.tsx:1318`).
Deposit fields:
- `services.deposit_amount` — `NULL` = "use shop default", `0` = "no deposit for this
  service" (already correctly distinguished server-side since
  `20260807052329_fix_service_deposit_override.sql`), any positive value = explicit.
- Optional UI affordance: a "set to 30% of price" button that fills the field once, never an
  automatic recompute on price change.
- Changing price never touches `deposit_amount`.

---

## 4. Authority model

| Domain | owner | admin | staff |
|---|---|---|---|
| D1 Profile | ✅ | ✅ | ❌ |
| D2 Booking config | ✅ | ✅ | ❌ |
| D3 Schedule (shop-level: weekly mode, closures, shop holidays) | ✅ | ✅ | ❌ |
| D3 Schedule (own weekly hours / own date time-off) | ✅ | ✅ | **decide:** default ❌; opt-in "staff may edit own schedule" flag is a future D2 setting, not V1 |
| D4 Services | ✅ | ✅ | ❌ |
| D5 Staff create / link user | ✅ | ❌ | ❌ |
| D5 Staff activate / deactivate | ✅ | ✅ | ❌ |
| D6 Payment | ✅ | ❌ | ❌ |
| D7 Notifications | ✅ | ✅ | ❌ |

All enforced at RPC/RLS, not UI-only (brief §13, R6). This matches the current
`update_shop_settings` intent (owner-only for the payment-bearing parts) but makes the
non-payment profile parts admin-writable, which they are not today.

---

## 5. Readiness (D8) — derived capability status

Brief §11: admin must show readiness as **independent capabilities**, not one completion
bar. Readiness is computed, never stored as truth, never blocks preview.

| Capability | GREEN when | Consumer impact if not GREEN |
|---|---|---|
| `profile` | name + phone present | header shows slug fallback (cosmetic) |
| `services` | ≥ 1 active service | "no services" state (KMO-09) |
| `staff` | ≥ 1 active staff, OR shop marks services as not-provider-bound | "no provider" state |
| `schedule` | for `STAFF_WEEKLY`: ≥ 1 staff has ≥ 1 working `staff_schedules` row; for `SHOP_WEEKLY`: weekly mode set + at least the open days have staff hours | "schedule not configured" / "no slot" state |
| `payment` | if any deposit-required path is active: valid PromptPay number + name; else N/A | "payment configuration missing" state at step 3 |
| `public_booking` | `booking_enabled = true` and not billing-blocked | "online booking disabled" state |

Readiness surface:
- Admin: a checklist panel with one row per capability, each independently GREEN / attention,
  each linking to the domain that fixes it.
- A **"Preview customer page"** action is available regardless of any capability state
  (brief §10, KMO-03) — opens the consumer `/book/[slug]` view; may be an embedded frame or
  a new tab, but it must be a first-class button, not just a copyable URL.

Readiness may be delivered as:
- a client-side computation over data the admin dashboard already loads (no schema) for the
  Junction-A-clear portion, **and/or**
- an `RPC get_shop_readiness(p_shop_id)` returning the capability rows (cleaner, testable) —
  design now, land in R7.

The consumer negative states (KMO-09) need at most one new **public** boolean on
`shop_public_profile` (e.g. `is_bookable` already partially exists as
`is_accepting_online_bookings`); anything finer-grained than the current single flag is an
R7 projection change. The client can distinguish "no services" / "no staff" / "no schedule"
from data it already fetches without any projection change.

---

## 6. Data-model direction (R7)

```sql
-- D1/D6 split: replace update_shop_settings with update_shop_profile + update_shop_payment
--   (RPC change only; columns already exist on shops)

-- D2: booking configuration
ALTER TABLE local_service.shops
  ADD COLUMN booking_enabled           boolean NOT NULL DEFAULT true,
  ADD COLUMN weekly_closure_mode       text    NOT NULL DEFAULT 'STAFF_WEEKLY'
       CHECK (weekly_closure_mode IN ('SHOP_WEEKLY','STAFF_WEEKLY')),
  ADD COLUMN slot_interval_minutes     int     NOT NULL DEFAULT 30
       CHECK (slot_interval_minutes IN (5,10,15,20,30,60)),
  ADD COLUMN booking_lead_time_minutes int     NOT NULL DEFAULT 0  CHECK (booking_lead_time_minutes >= 0),
  ADD COLUMN booking_horizon_days      int     NOT NULL DEFAULT 60 CHECK (booking_horizon_days BETWEEN 1 AND 365);
-- customer_cancel_before_hours / customer_reschedule_before_hours already exist (bk_a_v1)

-- D3: from R2
CREATE TABLE local_service.shop_weekly_closures (...);          -- R2 §6
-- staff date time-off: keep shop_holidays(staff_id = X) OR introduce staff_time_off (R3 open item)

-- D7: notifications
ALTER TABLE local_service.shops
  ADD COLUMN reminder_offsets_minutes  int[]   NOT NULL DEFAULT '{1440,60}',  -- 24h, 1h
  ADD COLUMN reminder_enabled          boolean NOT NULL DEFAULT true;
```

All defaults chosen to preserve current behaviour: `booking_enabled` true, `STAFF_WEEKLY`,
30-min slots, no lead time, 60-day horizon, reminders at 24h + 1h (matches HC-23).

### Open item for R3 → R5/R7

Whether staff date time-off stays on `shop_holidays` or moves to a dedicated
`staff_time_off` table. R2 fixed the *semantics* (layer 4); the table choice is deferred to
whoever writes the R7 migration, with a bias toward **keeping `shop_holidays`** to minimise
migration surface unless R5's service model forces a change.

---

## 7. Admin UX consequence (feeds R4)

The current dashboard has one "settings" tab mixing PromptPay + LINE, and a "services" tab
that also carries the shop profile form. R4 reorganises to match the domains:

- **Profile** tab — D1 only, its own Save, never asks for PromptPay.
- **Booking** tab — D2 (new): enable toggle, weekly mode selector, slot interval, lead time,
  horizon, cancel/reschedule windows.
- **Schedule** tab — D3: staff weekly grid + (Mode A) shop weekly closure + shop holidays.
- **Services** tab — D4 only.
- **Staff** tab — D5.
- **Payment** tab — D6 (split from "settings"): PromptPay, deposit default. Its own Save.
- **Notifications** — D7 (can fold into Booking tab for V1).
- **Readiness** — D8 panel, visible on dashboard landing, with "Preview customer page".

## 8. Junction A status

- Design: allowed now.
- Client-only pieces deliverable in R4 without LAB: the tab reorganisation, removing the
  auto-30% write (KMO-X4), the "Preview customer page" button, client-side readiness
  computation, the consumer negative states that use already-fetched data, and the consumer
  ceasing to invent PromptPay/deposit values (the client stops using the fallbacks; the
  server-side `PAYMENT_NOT_CONFIGURED` guard is R7).
- Blocked by Junction A: the RPC split (`update_shop_profile` / `update_shop_payment`),
  `provision_owner_shop` change, all new `shops` columns, `shop_weekly_closures`,
  `get_shop_readiness`, and the `create_booking_hold` payment fail-closed guard.
- No shared surface touched.

## R3 verdict

**MERCHANT CONFIG ARCHITECTURE:** LOCKED.

- 8 domains, each independently saveable; no cross-domain save blocking except true
  invariants.
- Profile/Payment split into two RPCs; PromptPay dropped from registration required-set and
  from profile save. Payment incompleteness → readiness state + runtime fail-closed, never a
  profile-save error.
- Deposit is an explicit merchant field; price changes never rewrite it.
- Readiness is derived, per-capability, non-blocking, and always allows customer preview.
- All new defaults preserve current behaviour for existing shops.

**Next:** R4 — UX remediation that can ship on source alone (time input, numeric empty
state, staff-schedule dirty-state, Save All, Preview button, consumer empty/error states,
readiness panel).
