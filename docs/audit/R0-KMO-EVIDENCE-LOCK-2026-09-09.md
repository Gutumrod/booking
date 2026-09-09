# R0 — KMO Real-Shop Pilot Evidence Lock

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R0 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** EVIDENCE PRESERVATION — no code change in this phase
**Branch:** `docs/bk01-real-shop-hardening`
**Canonical source inspected at:** `feature/bk-a-v1-contract-remediation` HEAD `edeb49e`

## Purpose

Freeze the 2026-09-09 KMO RACKBARCUSTOM real-user observations before any remediation
touches the code that produced them. Each finding is reproduced against **canonical BK01
source** (not the KMO downstream fork), classified, and given a fix-type direction plus a
Junction A dependency flag.

This document is the authority for what the pilot found. R1–R6 remediation docs reference
finding IDs from the table below (`KMO-01` … `KMO-09`, plus `KMO-X*` for gaps discovered
during source reproduction that were not in the original nine).

## Evidence basis and limits

- **Real-user layer:** KMO owner operated a live BK01 downstream deployment on a real
  device on 2026-09-09. The nine observations in
  `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md` §5 are the raw pilot output.
- **Source layer:** every observation below is reproduced by inspection of canonical BK01
  source at `edeb49e`. File/line references are canonical, not KMO-fork.
- **Not yet captured:** device screenshots and a screen recording from the KMO session are
  not in this repository. Where a finding still needs a fresh real-user or browser capture
  to satisfy the brief §16 acceptance bar, it is marked **REAL-USER PROOF OWED**.
- **Local runtime constraint:** local Supabase/Docker is unavailable in the current
  workstation (no Docker runtime). Browser proof against live data must run against an
  approved non-production target (`wstera-lab` consumer staging) or the KMO downstream
  pilot, not a local stack. This blocks the browser-evidence portion of R0/R4 until an
  approved target is used; it does not block source classification.

## Classification legend

| Code | Meaning |
|---|---|
| `BUG_GENERIC` | Defect in shared BK01 logic; wrong for essentially all shops. |
| `UX_GENERIC` | Interaction/PMF defect in shared BK01 UI; degrades any shop, no data corruption. |
| `ARCHITECTURE_GAP` | A capability the contract needs does not exist in the model; not a patch. |
| `KMO_CONFIG` | Specific to how KMO is configured; not a product change. |
| `OPERATIONS` | Deployment/runtime/process issue, not application logic. |

Fix-type: `MERCHANT_CONFIG` (shop-settable policy) / `PRODUCT_DEFAULT` (configurable default value) /
`SYSTEM_INVARIANT` (server-enforced, not merchant-overridable) / `UI_ONLY` (presentation).

## Findings table

| ID | Short | Class | Fix-type | Junction A |
|---|---|---|---|---|
| KMO-01 | Shop weekly open/closed appears saveable but has no shop-level source of truth | `ARCHITECTURE_GAP` | `MERCHANT_CONFIG` + `SYSTEM_INVARIANT` | **BLOCKED** (needs schema) |
| KMO-02 | Native time fields hard to operate on tested device | `UX_GENERIC` | `UI_ONLY` | clear |
| KMO-03 | No in-app customer preview; empty service set not explained | `UX_GENERIC` | `UI_ONLY` | clear |
| KMO-04 | Special shop holidays add/delete works | working capability — keep as evidence | — | clear |
| KMO-05 | Saving one staff schedule discards unsaved edits to other staff | `BUG_GENERIC` (+ `ARCHITECTURE_GAP` for shop-weekly split) | `UI_ONLY` (client dirty-state) | clear for the UX fix |
| KMO-06 | Shop profile cannot be saved without PromptPay | `BUG_GENERIC` (contract coupling) | `SYSTEM_INVARIANT` redesign — split profile RPC from payment | **PARTIAL** — RPC signature change; product-local, needs LAB after A |
| KMO-07 | Service duration is minute-only with a 15-minute assumption | `ARCHITECTURE_GAP` | `MERCHANT_CONFIG` (unit + scheduling mode) + `PRODUCT_DEFAULT` | **BLOCKED** (needs schema) |
| KMO-08 | Numeric fields coerce empty input to 0 | `UX_GENERIC` | `UI_ONLY` | clear |
| KMO-09 | Customer page returns HTTP 200 while offering no usable booking flow | `BUG_GENERIC` + `UX_GENERIC` | `UI_ONLY` + `SYSTEM_INVARIANT` (truthful negative states) | clear for UI; server truth flags may need view change |
| KMO-X1 | `customer_reschedule_booking` performs no booking-collision check → server-side double-book | `BUG_GENERIC` | `SYSTEM_INVARIANT` | **PARTIAL** — RPC body change, product-local, needs LAB after A |
| KMO-X2 | Three divergent availability implementations (hold RPC / consumer client / reschedule RPC) | `ARCHITECTURE_GAP` | `SYSTEM_INVARIANT` (one shared precedence) | **PARTIAL** |
| KMO-X3 | Consumer invents PromptPay recipient `0812345678` and deposit `100` as fallbacks | `BUG_GENERIC` | `SYSTEM_INVARIANT` (fail-closed, never invent) | clear (client + view) |
| KMO-X4 | Changing service price auto-overwrites deposit with 30% | `BUG_GENERIC` | `MERCHANT_CONFIG` (deposit is an explicit merchant decision) | clear (client) |
| KMO-X5 | Phone validation policy differs between Booking (`/^0[689]\d{8}$/`) and Ticket (9–15 digit strip) | `ARCHITECTURE_GAP` | `PRODUCT_DEFAULT` (one declared country/normalization policy) | clear |

---

## KMO-01 — Shop weekly closure has no shop-level source of truth

**Pilot observation (§5.1):** owner changed shop weekly configuration and it saved; treated
as a working capability.

**Source reproduction (canonical `edeb49e`):**
- `local_service.shops` has **no** recurring weekday-closed column
  (`BRIEF-BK01-SHOP-WEEKLY-CLOSURE-ADDENDUM-2026-09-09.md` verified this on 2026-09-09).
- Admin "Schedules" tab edits **per-staff** weekly rows only
  (`apps/booking-admin/src/app/dashboard/page.tsx:876`–`965`, `updateScheduleDay` /
  `handleSaveSchedule` write `staff_schedules` via `saveStaffWeeklySchedule`).
- Special (exact-date) closures are a separate mechanism: `shop_holidays` with
  `staff_id IS NULL` (`page.tsx:958`–`1065`, `createShopHoliday`).
- `create_booking_hold` checks exact-date `shop_holidays` then per-staff `staff_schedules`
  — there is no shop weekly step
  (`supabase/migrations/20260807051839_booking_submission_and_availability_guards.sql:123`–`128`, `157`–`218`).
- E3.2 checkpoint explicitly removed unsupported shop-wide recurring hours because no
  backend source of truth existed
  (`docs/technical/PHASE_E3_2_LOCAL_CHECKPOINT_REPORT_2026-08-08.md`).

**What the pilot user actually changed:** individual staff weekly rows and/or exact-date
holidays — not a shop-level "ร้านหยุดทุกวันอังคาร" rule. The perceived capability does
not exist as a shop-level concept.

**Would another shop hit this?** Yes. Any one-person shop or any shop with a fixed weekly
closed day expects to set it once at shop level, not per staff member.

**Fix direction:** new bounded product-local model
`shop_weekly_closures(shop_id, day_of_week)` + owner/admin mutation RPC + inclusion in the
shared availability precedence (see R2). `day_of_week` 0–6 matching `staff_schedules`.
Do not overload `shop_holidays`.

**Junction A:** BLOCKED — needs a forward migration in LAB. Design in R2/R3, implement in R7.

**Real-user proof:** OWED — after implementation, KMO round-2 must set a recurring weekday
closure and confirm public availability returns nothing that day for every staff member.

---

## KMO-02 — Native time fields hard to operate on the tested device

**Pilot observation (§5.2):** the time inputs were difficult to use on the device tested.

**Source reproduction:** every schedule time is a bare `<input type="time">`:
- staff work start/end: `apps/booking-admin/src/app/dashboard/page.tsx:926`–`934`
- staff break start/end: `page.tsx:943`–`951`

Four native time pickers per staff member per day. On the tested mobile browser the native
`type="time"` control is the only entry path — no keyboard `HH:MM` typing affordance, no
larger-target accessible picker.

**Would another shop hit this?** Yes — device-dependent, not KMO-specific. Any merchant
editing schedules on the same class of device hits the same control.

**Fix direction (R4, source-only, no LAB):** replace with a keyboard-friendly `HH:MM`
masked text entry that parses on blur, plus an accessible dropdown/stepper picker.
Keep the value contract (`HH:MM` string) unchanged so no RPC or schema change is needed.

**Junction A:** clear.

**Real-user proof:** OWED — browser/mobile capture on the remediated control (R4).

---

## KMO-03 — No in-app customer preview; empty service set unexplained

**Pilot observation (§5.3):** the customer preview / onboarding path does not clearly prove
readiness, and an empty service set is not explained.

**Source reproduction:**
- Admin's only route to the customer view is an external anchor:
  `apps/booking-admin/src/app/dashboard/page.tsx:723`–`731` (`target="_blank"` to
  `${BOOKING_SITE_URL}/book/${shopSlug}`) and a copy-link bar at `page.tsx:1224`–`1240`.
  There is no embedded preview and no "Preview customer page" action that works before
  setup is complete.
- No readiness surface exists: the dashboard has KPI tiles (`page.tsx:648`–`680`) but no
  per-capability status for profile / schedule / services / staff / payment / public
  availability.
- Consumer with zero active services: `apps/booking-consumer/src/app/book/[slug]/page.tsx:466`–`490`
  renders an empty list; "Next" stays disabled (`page.tsx:493`); nothing explains why.

**Would another shop hit this?** Yes. Every new shop onboarding sees the empty state; every
merchant wants to preview before finishing setup (brief §11).

**Fix direction (R4):** (a) always-available "Preview customer page" action;
(b) readiness checklist with independent capability rows; (c) consumer explicit empty/negative
states (ties to KMO-09).

**Junction A:** clear (UI). Server truth flags for readiness may reuse existing columns; if a
new public projection column is needed that portion defers to R7.

**Real-user proof:** OWED (R4 browser evidence).

---

## KMO-04 — Special shop holidays add/delete works

**Pilot observation (§5.4):** exact-date shop holidays can be added and deleted.

**Source reproduction:** `createShopHoliday` / `deleteShopHoliday`
(`apps/booking-admin/src/app/dashboard/page.tsx:458`–`486`), backed by `shop_holidays`
and enforced in `create_booking_hold`
(`supabase/migrations/20260807051839_...:123`–`128`).

**Classification:** working capability. Preserve as a regression anchor — R2 precedence and
any R7 schema work must not break exact-date closure semantics.

**Junction A:** n/a.

---

## KMO-05 — Saving one staff schedule discards unsaved edits to other staff

**Pilot observation (§5.5):** shop weekly hours and staff schedules are separate; unsaved
edits for other staff are reset after saving one staff member. Flagged P0.

**Source reproduction:**
- All staff schedule cards render from one `schedules` state array
  (`apps/booking-admin/src/app/dashboard/page.tsx:113`, `895`–`963`).
- Edits mutate that array in memory only (`updateScheduleDay`, `page.tsx:488`–`496`).
- `handleSaveSchedule` saves **one** staff member then calls
  `loadDashboardBookings(false)` (`page.tsx:498`–`509`), which re-fetches and overwrites the
  **entire** `schedules` array from the server (`page.tsx:181`–`211`, `setSchedules(data.schedules)`).
- Any card the user had edited but not saved is silently reverted. There is no dirty-state
  tracking, no per-card "unsaved" marker, and no "Save All".

**Would another shop hit this?** Yes — any multi-staff shop editing more than one schedule
in a session. This is the single most likely data-loss-feeling defect for salons/clinics.

**Two sub-issues:**
1. `BUG_GENERIC` / `UI_ONLY` — the reload-clobbers-edits behavior. Fix in R4: after a
   single save, patch only that staff's rows in state instead of reloading all; add
   dirty-state protection and/or "Save All Changes".
2. `ARCHITECTURE_GAP` — the brief's Scheduling Policy V2 requires that when a shop chooses
   `SHOP_WEEKLY` mode, per-staff recurring off-day controls are disabled entirely. That mode
   split does not exist yet. Design in R2.

**Junction A:** clear for the UX fix (client-only). The mode split (R2/R3) needs schema →
R7.

**Real-user proof:** OWED — R4 browser test: edit two staff cards, save one, confirm the
other keeps its edits.

---

## KMO-06 — Shop profile cannot be saved without PromptPay

**Pilot observation (§5.6):** shop profile cannot be saved without PromptPay. Flagged P0,
generic contract coupling.

**Source reproduction:**
- One RPC saves profile **and** payment together:
  `local_service.update_shop_settings(p_shop_id, p_name, p_phone, p_address,
  p_promptpay_number, p_promptpay_name, p_line_oa_id)`
  (`supabase/migrations/20260807191046_phase_e3_3_shop_settings_authorization.sql:47`–`96`).
- It hard-rejects a blank PromptPay number **and** name:
  ```
  IF NULLIF(BTRIM(p_promptpay_number), '') IS NULL THEN RAISE EXCEPTION 'PromptPay number is required' ...
  IF NULLIF(BTRIM(p_promptpay_name), '')   IS NULL THEN RAISE EXCEPTION 'PromptPay account name is required' ...
  ```
  (migration lines 74–80).
- The client mirrors this: both PromptPay inputs are `required`
  (`apps/booking-admin/src/app/dashboard/page.tsx:1446`, `1458`) and the same
  `handleSaveShopSettings` submits name/phone/address/promptpay/line together
  (`page.tsx:379`–`402`, `1160`, `1406`).

**Would another shop hit this?** Yes, and it is a hard blocker for whole merchant classes:
no-deposit shops, Claim/support-only merchants, any shop still in setup. Brief §9 and §12
call this out explicitly.

**Fix direction (R3):** separate concerns.
- Profile RPC: name / phone / address / LINE OA — no payment fields, no PromptPay gate.
- Payment RPC: PromptPay (and future methods), validated only when a deposit-requiring
  policy is active.
- When deposit is required but no verified payment method exists → the **payment flow**
  fails closed with a readiness error; profile stays saveable.
- Never invent a demo recipient (ties to KMO-X3).

**Junction A:** PARTIAL. Splitting one RPC into two is a product-local forward migration —
allowed to **design** now, must land in LAB only after Junction A PASS (R7). No shared-runtime
object is touched.

**Real-user proof:** OWED — KMO round-2: save profile with PromptPay empty; confirm success;
confirm booking with deposit required still fails closed with a clear message.

---

## KMO-07 — Service duration is minute-only with a 15-minute assumption

**Pilot observation (§5.7):** service duration is minute-only with 15-minute assumptions.

**Source reproduction:**
- Admin service form: `serviceDuration` number input `min={15} step={15}`, default `45`
  (`apps/booking-admin/src/app/dashboard/page.tsx:145`, `1296`–`1306`, `516`).
- DB stores `services.duration_minutes` as an integer; `create_booking_hold` computes
  `v_end_tz := v_start_tz + (duration_minutes || ' minutes')::interval`
  (`supabase/migrations/20260807051839_...:131`–`132`).
- No unit concept (minute vs hour vs day), no `TIME_SLOT` vs `DATE_RANGE` scheduling mode,
  no multi-day/date-range semantics anywhere.
- Consumer renders a fixed 30-minute grid `ALL_TIME_SLOTS` 09:00–19:00
  (`apps/booking-consumer/src/app/book/[slug]/page.tsx:22`) independent of the service.

**Would another shop hit this?** Yes — garages (variable multi-hour jobs), fabrication shops
like KMO (multi-day production), any day-based service. Brief §8 and §12.

**Fix direction (R5):** introduce a scheduling model —
`TIME_SLOT` (minute/hour, same-day interval) and `DATE_RANGE` (day-based, spans dates with
real cross-date rules, **not** `days * 1440`). Merchant-facing unit preserved even if
normalized internally. Slot interval becomes merchant-configurable; the 15/30 assumptions
become either a configurable `PRODUCT_DEFAULT` or are removed.

**Junction A:** BLOCKED — needs schema (`services` columns + possibly a new table). Design in
R5, implement in R7.

**Real-user proof:** OWED.

---

## KMO-08 — Numeric fields coerce empty input to 0

**Pilot observation (§5.8):** numeric fields coerce empty input to zero, making natural
editing difficult.

**Source reproduction:** every numeric handler wraps the raw value in `Number(...)`:
- duration: `onChange={(e) => setServiceDuration(Number(e.target.value))}`
  (`apps/booking-admin/src/app/dashboard/page.tsx:1303`)
- price: `const val = Number(e.target.value); setServicePrice(val); ...`
  (`page.tsx:1315`–`1319`)
- deposit: `onChange={(e) => setServiceDeposit(Number(e.target.value))}`
  (`page.tsx:1331`)

`Number('')` is `0`, so clearing a field to retype it snaps the value to `0` immediately and
the field will not display empty. State is typed `number`
(`useState(45)` / `useState(350)` / `useState(100)`, `page.tsx:145`–`147`).

**Would another shop hit this?** Yes — pure client UX, affects everyone.

**Fix direction (R4):** hold the editing value as a string, allow empty during editing,
parse and validate at blur/submit. Keep the same numeric payload to `createService` /
`updateService`.

**Junction A:** clear.

**Real-user proof:** OWED (R4 browser evidence).

---

## KMO-09 — Customer page returns HTTP 200 with no usable booking flow

**Pilot observation (§5.9):** the customer page can return HTTP 200 while still failing to
present a usable booking flow. Flagged P0. HTTP 200 is not a PASS.

**Source reproduction:**
- The page always renders once shop data loads
  (`apps/booking-consumer/src/app/book/[slug]/page.tsx:307`–`768`). The only dedicated
  negative screen is `isBookingBlocked` (`is_accepting_online_bookings === false`,
  `page.tsx:130`, `354`–`368`).
- All other failure modes fall through to the normal stepper:
  - no active services → empty list, disabled Next (`page.tsx:466`–`499`)
  - no staff → "Any staff" only; slots computed against an empty `staffList` →
    `hasAvailableStaff` false for every slot (`page.tsx:186`–`206`)
  - no schedules → `staffSchedules.find(...)` undefined → slot unavailable
    (`page.tsx:194`–`198`)
  - data/runtime load error → `catch { setShop(null) }` (`page.tsx:92`–`96`) → falls to the
    same "shop not found"-ish path as a genuinely missing slug, no distinct error state.
- Client availability uses the hardcoded `ALL_TIME_SLOTS` grid and never queries existing
  bookings, so it can also show a slot as available that the RPC will then reject
  (ties to KMO-X2).

**Would another shop hit this?** Yes — every partially-configured shop, and every shop with
a transient backend error.

**Fix direction (R4 + partial R7):** implement the brief §11 distinct states —
shop unavailable / online-booking disabled / no active services / no active provider when
required / schedule not configured / no slot for the selected date / payment config missing
when required / actual runtime load failure. HTTP 200 with a truthful negative state is
acceptable; HTTP 200 with a dead stepper is not. Customer E2E PASS requires the full
visible chain (shop → service → provider policy → date → valid slot → hold/create) plus the
truthful negatives.

**Junction A:** clear for the UI states. If the truthful "schedule not configured" /
"payment missing" signals require a new field on `shop_public_profile`, that projection
change defers to R7; the rest is client-only.

**Real-user proof:** OWED — customer E2E positive + every negative path (brief §16.5).

---

## KMO-X1 — `customer_reschedule_booking` has no collision check

**Discovered during KMO-05/§6 source reproduction.**

`local_service.customer_reschedule_booking`
(`supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql:514`–`576`) validates:
staff still active, staff weekly schedule + break window, exact-date `shop_holidays`
(shop or that staff). It then `UPDATE`s the booking to the new time.

It does **not** check for an overlapping existing booking on that staff member. Contrast
`create_booking_hold`, which does
(`...20260807051839_...:175`–`182`, 219–228, `tstzrange && tstzrange`).

**Impact:** a customer holding a valid recovery token can reschedule their confirmed
booking onto a slot already occupied by another confirmed booking for the same staff →
server-side double-book. This is a `SYSTEM_INVARIANT` violation (brief §7 "server-side
collision prevention", §6 "same rule must be enforced by … reschedule").

**Would another shop hit this?** Yes — any shop that enables customer reschedule.

**Fix direction (R2 contract + R7 implementation):** the shared availability precedence must
be enforced identically by `customer_reschedule_booking`. Add the same `tstzrange` overlap
guard (excluding the row being rescheduled).

**Junction A:** PARTIAL — RPC body change, product-local, no shared-runtime object. Design
in R2, land in R7.

**Real-user proof:** OWED — negative concurrency test in R6.

---

## KMO-X2 — Three divergent availability implementations

**Discovered during §6 reproduction.**

| Path | Shop exact-date closure | Shop weekly closure | Staff exact-date off | Staff weekly / hours / break | Booking collision |
|---|---|---|---|---|---|
| `create_booking_hold` (RPC) | yes | **n/a (doesn't exist)** | yes | yes | **yes** |
| consumer `availableTimeSlots` (client) | yes (whole-shop only) | n/a | yes | yes | **no** |
| `customer_reschedule_booking` (RPC) | yes (shop or that staff) | n/a | — | yes | **no** |

Brief §6 requires one precedence, enforced identically by consumer availability, create
hold, reschedule and any trusted mutation. Today each path is hand-written and they
disagree on collision and (once KMO-01 lands) will disagree on shop weekly closure.

**Fix direction (R2):** define the single precedence
(`shop inactive/billing → exact-date shop closure → recurring weekly policy → staff
exact-date off → staff working time/break → existing collision → available`) and specify
one shared enforcement primitive (a SQL function all trusted paths call; the client calls a
read-only projection of the same logic).

**Junction A:** PARTIAL.

---

## KMO-X3 — Consumer invents PromptPay recipient and deposit amount

**Discovered during KMO-06 reproduction.**

`apps/booking-consumer/src/app/book/[slug]/page.tsx`:
- `const promptpayNumber = shop?.promptpay_number || '0812345678';` (`page.tsx:124`)
- `const promptpayName = shop?.promptpay_name || shop?.name || t('fallbackShopName');` (`page.tsx:125`)
- `const depositAmount = selectedService?.deposit_amount ?? shop?.default_deposit_amount ?? 100;` (`page.tsx:131`)
- deposit `?? 100` repeated at `page.tsx:486` and `page.tsx:693`.

The QR is generated from whatever `promptpayNumber` resolves to
(`createPromptPayPayload({ recipient: promptpayNumber, amount: depositAmount })`,
`page.tsx:132`–`138`), so a misconfigured shop shows customers a **QR paying an arbitrary
hardcoded phone number** a real amount.

Brief §9 / §13: "Never invent or fall back to a demo PromptPay recipient or guessed deposit
amount." Direct violation.

**Fix direction (R4 client + R3 payment contract):** if a deposit-requiring flow has no
verified PromptPay recipient and no explicit amount, the payment step fails closed with a
readiness error. No default recipient string, no default amount.

**Junction A:** clear (client + possibly a `shop_public_profile` boolean for
"payment configured"; the boolean projection may defer to R7).

**Real-user proof:** OWED.

---

## KMO-X4 — Service price change auto-overwrites deposit with 30%

**Discovered during KMO-08 reproduction.**

`apps/booking-admin/src/app/dashboard/page.tsx:1315`–`1319`:
```
onChange={(e) => {
  const val = Number(e.target.value);
  setServicePrice(val);
  setServiceDeposit(Math.round(val * 0.3));
}}
```

Editing the price silently rewrites the deposit the merchant previously chose. Brief §9:
"Changing a service price must not silently overwrite the merchant's deposit decision (for
example, automatic 30%)."

**Fix direction (R4):** remove the coupled write. Deposit is an explicit merchant field;
offer a "set to 30%" affordance if wanted, never automatic.

**Junction A:** clear (client only).

---

## KMO-X5 — Divergent phone validation policy (Booking vs Ticket)

**Discovered during §13 reproduction.**

- Booking consumer: `const thaiMobilePhonePattern = /^0[689]\d{8}$/;` then
  `value.replace(/[\s-]/g, '')` (`apps/booking-consumer/src/app/book/[slug]/page.tsx:23`, `29`–`31`).
  Thai mobile only; rejects landlines and any non-`0[689]` prefix.
- Ticket domain: `normalizePhone = value.replace(/\D/g, '')`, valid if 9–15 digits
  (`apps/booking-admin/src/lib/ticket-domain.ts:175`–`181`,
  `MIN_PHONE_DIGITS = 9`, `MAX_PHONE_DIGITS = 15`).

Two different notions of a valid customer phone in the same product. Brief §13: if BK01 is
Thailand-first, that must be an explicit product policy with one normalization, not
scattered regex.

**Fix direction (R3/R5):** one declared phone policy module (country, accepted formats,
normalization) used by Booking and Ticket/Claim alike.

**Junction A:** clear.

---

## Preserved constants inventory (feeds R1)

Raw list captured here so R1 starts from evidence, not a fresh scan:

| Constant | Location | Note |
|---|---|---|
| duration `min=15 step=15`, default 45 | `dashboard/page.tsx:145,1300-1306` | KMO-07 |
| deposit `= price * 0.3` | `dashboard/page.tsx:1318` | KMO-X4 |
| deposit fallback `?? 100` | `book/[slug]/page.tsx:131,486,693` | KMO-X3 |
| PromptPay fallback `'0812345678'` | `book/[slug]/page.tsx:124` | KMO-X3 |
| hold expiry `INTERVAL '15 minutes'` | all `create_booking_hold` migrations | R1/R2 — lead-time/hold policy |
| client hold timer `900` seconds | `book/[slug]/page.tsx:65,263` | mirrors the 15-min server value |
| `ALL_TIME_SLOTS` 09:00–19:00, 30-min grid | `book/[slug]/page.tsx:22` | KMO-07 / KMO-X2 — slot interval + business hours |
| link token `INTERVAL '24 hours'` | `create_booking_hold` migrations | R1 — recovery-window policy |
| `require_deposit` COALESCE default `true` | `create_booking_hold` | R1 — deposit-required default |
| Thai mobile regex `/^0[689]\d{8}$/` | `book/[slug]/page.tsx:23` | KMO-X5 |
| phone 9–15 digits | `ticket-domain.ts:178-181` | KMO-X5 |
| `Asia/Bangkok` timezone literal | `create_booking_hold`, `customer_reschedule_booking`, `dashboard/page.tsx:52` | R1 — declare as product policy |
| reschedule rate-limit `5` attempts / `30 minutes` | `bk_a_v1_contract_remediation.sql:58-60` | R1 — abuse policy, likely invariant |
| default staff assignment order (least-loaded, then `created_at`) | `create_booking_hold:183-188` | R1 — assignment policy |

## R0 verdict

**KMO EVIDENCE:** LOCKED at `edeb49e`.

- 9 pilot findings reproduced against canonical source. KMO-04 is a working capability;
  the other 8 are confirmed defects/gaps.
- KMO-01 reclassified: the "working" weekly-closure capability the pilot user believed they
  used **does not exist** as a shop-level concept — it is an `ARCHITECTURE_GAP`.
- 5 additional findings (KMO-X1…X5) discovered during source reproduction; KMO-X1 (reschedule
  double-book) and KMO-X3 (invented PromptPay recipient) are severity-equivalent to the
  pilot P0s.
- No KMO-specific value was found that would need to become generic product code
  (brief stop-condition clear).
- Nothing in this phase changed code. Evidence is preserved.

**Next:** R1 hardcode audit consumes the constants inventory and the KMO-X findings.
