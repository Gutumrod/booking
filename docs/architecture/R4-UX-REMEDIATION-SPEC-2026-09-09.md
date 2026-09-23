# R4 — UX Remediation Spec

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R4 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** DESIGN + IMPLEMENTATION SPEC — source changes allowed (no LAB); each item ships
only with browser/mobile proof on an approved target
**Branch:** `docs/bk01-real-shop-hardening`
**Consumes:** R0 (KMO-02, KMO-03, KMO-05, KMO-08, KMO-09, KMO-X4), R1 (HC-01, HC-09, HC-16, HC-19), R3 (§5, §7)

## Execution status override — 2026-09-23 (R4 CLOSED)

The specification below remains the locked R4 contract; this block records the closure evidence without rewriting historical design text.

- **R4 CLOSED.** All nine items were accepted on real browser/mobile evidence, not on automated suites alone.
- Owner ruling approved an isolated synthetic fixture inside the KMO project and a temporary fixture-scoped test admin; both were created, used and removed with residue 0, and the real `kmo-rackbarcustom` tenant was proven unchanged (md5 fingerprint over shops/staff/services/schedules/shop_users/weekly, 6/6 identical).
- R4-1 deposit survives price edit/save/reload (deposit 250 preserved across a 500→750 save and a later 900 edit); R4-2 empty-during-edit allowed, invalid visibly invalid with zero RPC and no mutation; R4-3 all eight HH:MM fields use `inputMode=numeric` with blur canonicalisation and invalid revert; R4-4 dirty Staff B edits survive saving Staff A with a dirty-state banner; R4-5 Preview opens the real tenant page and readiness rows are truthful; R4-6 consumer states proven (`OK_STEPPER`, `NO_STAFF`, `SHOP_NOT_FOUND`, `NO_SERVICES`, `NO_SCHEDULE`, `NO_SLOT_FOR_DATE`, `PAYMENT_NOT_CONFIGURED`, `BOOKING_DISABLED`); R4-7 QR renders only with a server-sourced amount and config-sourced recipient; R4-8 countdown follows server `expires_at`; R4-9 durations 1/2/37/90 verified with a successful 1-minute booking.
- Positive customer E2E proven on desktop and mobile, plus cross-cutting regression (no cross-tenant leak, route transition, stale navigation, dirty-state, payment/readiness truth).
- Automatic gates at closure: tests 118/118; lint 0 errors / 12 warnings; both builds and typechecks PASS; diff/secret/protected-scope clean.
- Git: `VERIFIED_READY_FOR_CLAUDE_COMMIT` — Claude owns commit/push for this repository.
- Evidence: `docs/audit/r4-2026-09-23/REPORT-BK01-R4-CLOSURE-2026-09-23.md` and `EVIDENCE-INDEX-2026-09-23.json`.

## Execution status override — 2026-09-23 (resume, superseded by the closure block above)

The specification below remains the locked R4 contract; this block records current execution evidence without rewriting historical design text.

- Frozen baseline: `feature/bk01-real-shop-hardening-r4 @ 021d2427c3f9b35d5b235ce3202436bd382ae729` (delta from reviewed source `3b3a333` = docs/evidence only).
- Independent source verdict: `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME` after NEW-F18 (still current).
- Fresh gates: tests 118/118 PASS; lint 0 errors / 12 warnings; Admin + Consumer builds PASS; both typechecks PASS; secret/protected-scope/diff checks PASS.
- KMO availability privilege drift: **CLOSED** — controlled anon `SELECT (shop_id)` repair applied on `staff_schedules` and `shop_holidays` and verified live; no table-wide/write privilege, no extra column, policies unchanged.
- Consumer desktop/mobile proof: public reads 200; truthful `NO_STAFF` at the real KMO shop; `SHOP_NOT_FOUND` (invalid slug); `BOOKING_DISABLED` and `SHOP_NOT_FOUND` on wstera-lab.
- Truthful-state separation proven: `LOAD_ERROR` under authorization failure vs `NO_STAFF` with zero rows, same revision and tenant.
- Not reachable on authorized runtimes (not fabricated): `NO_SERVICES`, `NO_SCHEDULE`, `NO_SLOT_FOR_DATE`, `PAYMENT_NOT_CONFIGURED`.
- Admin unauthenticated contract proven in browser; authenticated Admin R4 matrix (R4-1 … R4-9) remains owed and needs an Owner/admin session.
- Positive customer hold/create proof is blocked by the KMO `staff = 0` public runtime until an authorized fixture exists.
- Therefore R4 is **NOT CLOSED**. Current disposition: `BROWSER_PROOF_RESUME_PARTIAL_REMEDIATED / R4 NOT CLOSED`.
- Evidence: `docs/audit/r4-2026-09-23/` and `docs/daily/2026-09-23.md`.

## Execution status override — 2026-09-22 (retained)

The specification below remains the locked R4 contract; this block records current execution evidence without rewriting historical design text.

- Canonical source: `feature/bk01-real-shop-hardening-r4 @ 3b3a3338de029a058aa5763c806be42f8a5205ca`.
- Independent source verdict: `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME` after NEW-F18.
- Fresh gates: tests 118/118 PASS; lint 0 errors / 12 warnings; Admin + Consumer builds PASS; both typechecks PASS.
- NEW-F18 Services/Staff runtime proof is PASS against KMO.
- Browser/mobile acceptance remains partial because KMO availability reads still lack anon SELECT on `shop_id` for `staff_schedules` and `shop_holidays`.
- Positive customer hold/create proof is blocked by KMO public `staff = 0` until an authorized fixture exists.
- Admin browser/mobile behavioral proof remains owed.
- Therefore R4 is **NOT CLOSED**. Current disposition: `BROWSER_PROOF_PARTIAL / KMO_RUNTIME_AND_FIXTURE_BLOCKED`.
- Evidence: `docs/audit/r4-2026-09-22/` and `docs/daily/2026-09-22.md`.

## Scope and constraint

R4 covers UX defects fixable in `apps/**` source without a WSTERA LAB migration. Per brief
§16, none of these is "accepted" until browser + mobile proof passes. The local workstation
has **no runnable backend** (`.env.local` is production-bound and forbidden as a dev source;
local Supabase/Docker unavailable). Therefore R4 delivers:

1. an exact, reviewable change spec per item (below),
2. pure-logic unit tests where the change has testable logic (`tests/*.test.ts`, `npm test`),
3. a **browser-proof checklist** to run against approved consumer/admin staging or the KMO
   downstream pilot before any item is marked accepted.

Baseline at spec time: `npm test` = 27/27 pass (HEAD `cbc2397`-descendant).

Items are ordered by isolation (safest first).

---

## AMENDMENT 1 — 2026-09-09 R0–R6 Review Gate (CEO)

Frozen pre-amendment: `520bb08`. Log: `docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`.

**New item R4-9 — free-minute service duration input (from KMO-07 / R5 AMENDMENT 1).**
- File: `apps/booking-admin/src/app/dashboard/page.tsx:1296-1306`.
- Change `min={15} step={15}` → `min={1} step={1}` (or `step={5}` for convenience; not a
  hard rule). Duration becomes any positive integer of minutes.
- The server-side "multiple of 15" rejection in `create_service`/`update_service` is R7
  (blocked by Junction A) — until then the RPC still rejects non-multiples-of-15, so R4-9's
  client change is cosmetically ahead of the server. **Sequencing:** land R4-9's client
  freedom together with the R7 RPC change, OR land R4-9 now but keep a client-side
  "multiple of 5" hint until R7 removes the server rule. Recommend the latter — the client
  should not offer values the current RPC will reject.
- Optional pure-UI minute↔hour display toggle (`90` ⇄ `1 ชม 30 น`) — presentation only.
- Test: fold into `useNumericField` (R4-2) — `{ min: 1, integer: true }`.

**R4-7 deposit logic uses B1 rules:**
- Consumer removes `?? 100` and `'0812345678'` (unchanged intent).
- Deposit figure shown = the hold RPC response value only; step-1 preview shows
  `selectedService.deposit_amount` when set, else "ร้านกำหนดมัดจำ" placeholder — never `100`,
  never `default_deposit_amount` client-side.
- `PAYMENT_NOT_CONFIGURED` state (R4-6) triggers when: a deposit-required service is selected
  **and** (`promptpay_number` is null/blank **or** no resolvable amount). With B1 defaults
  (`require_deposit=false`, `default_deposit_amount=NULL`) most fresh shops simply have no
  deposit step — the not-configured screen only appears for a shop that opted into deposit
  but hasn't finished payment setup.

**R4-5 readiness `payment` capability:** GREEN when `require_deposit = false` (N/A) OR
(`require_deposit = true` AND valid PromptPay number+name AND a resolvable amount). Attention
otherwise.

**No change to R4-1..R4-4, R4-6, R4-8** beyond the above.

R4 total after amendment: **9 items**, all Junction-A-clear (source only), browser/mobile
proof owed.

---

## R4-1 — Remove auto-30% deposit overwrite (KMO-X4 / HC-01)

**File:** `apps/booking-admin/src/app/dashboard/page.tsx:1315-1319`

**Now:**
```tsx
onChange={(e) => {
  const val = Number(e.target.value);
  setServicePrice(val);
  setServiceDeposit(Math.round(val * 0.3));
}}
```

**Change:** price `onChange` sets only `servicePrice`. Deposit keeps whatever the merchant
last set. Optionally add a small "= 30%" button next to the deposit field that does a
one-shot `setServiceDeposit(Math.round(servicePrice * 0.3))` on click.

**Risk:** minimal — removes a side effect. Existing client guard
`if (serviceDeposit > servicePrice)` (`:535`) stays.

**Test:** none needed (deletion). Browser proof: edit a service price, confirm the deposit
field does not move.

---

## R4-2 — Numeric inputs allow empty during editing (KMO-08 / HC-08 area)

**Files:** `apps/booking-admin/src/app/dashboard/page.tsx` — `serviceDuration`, `servicePrice`,
`serviceDeposit` state (`:145-147`) and their inputs (`:1296-1334`).

**Now:** state typed `number`; `onChange={(e) => setX(Number(e.target.value))}` →
`Number('')` is `0`, field snaps to 0 when cleared.

**Change:**
- Hold each editing value as `string` state (`serviceDurationInput`, etc.) initialised from
  the numeric prop.
- `onChange` stores the raw string (allow `''`).
- On `blur` and on form submit: parse (`Number`), validate (`> 0` for duration/price,
  `>= 0` for deposit, integer for duration), clamp/flag invalid, and write the canonical
  numeric value back into the string.
- `handleSaveService` parses from the string state, rejects invalid with the existing
  `managementError` channel before calling `createService` / `updateService`.
- The RPC payload is unchanged (still numbers).

**Extract a helper** `useNumericField(initial, { min, integer })` returning
`{ value, setValue, commit, numeric, error }` — one implementation, used by all three fields,
and reusable by R4-6 (booking config numeric fields) and R3 D2. Put it in
`apps/booking-admin/src/lib/` so it is unit-testable.

**Test (`tests/`):** `useNumericField` pure reducer — empty string is allowed transiently,
`commit('')` → error + no numeric change, `commit('45')` → numeric 45, `commit('12.5')` with
`integer:true` → error, `commit('-3')` with `min:0` → error.

**Browser proof:** clear the duration field, confirm it shows empty (not 0), type `60`,
blur, confirm 60; submit with an empty required numeric, confirm a clear error and no RPC.

---

## R4-3 — Keyboard-friendly HH:MM time entry (KMO-02 / HC-16)

**Files:** `apps/booking-admin/src/app/dashboard/page.tsx:926-951` (4 `<input type="time">`
per staff-day: work start/end, break start/end).

**Change:** new component `apps/booking-admin/src/components/time-field.tsx`:
- Controlled, value contract `"HH:MM"` (unchanged — same string the schedule state and
  `saveStaffWeeklySchedule` already use).
- Text `<input inputMode="numeric">` with an input mask accepting `H`, `HH`, `HH:`, `HHMM`,
  `HH:MM`; auto-inserts the colon; parses on blur to canonical `HH:MM` (00:00–23:59).
- Paired `<select>` / stepper popover for accessible non-keyboard selection, options at the
  shop's `slot_interval_minutes` (default 30 until R3 D2 lands; hardcode 30 for now with a
  `// R5: read slot_interval_minutes` note).
- Invalid input on blur → revert to last valid value + inline hint, do not emit.
- Full keyboard: arrow up/down = ±interval, typing digits fills the mask.
- `disabled` prop preserved (schedule rows disable when `!isWorkingDay` or
  `!canManageSchedules`).

**Risk:** medium — a real component. Contained to the schedule tab; value format unchanged so
no RPC/schema impact.

**Test (`tests/`):** the parse/format functions — `parseTimeInput('9')`→`'09:00'`,
`'930'`→`'09:30'`, `'9:5'`→`'09:05'`, `'25:00'`→ invalid, `'12:60'`→ invalid,
`format('9:00')`→`'09:00'`.

**Browser proof (mobile is the point here):** on the tested mobile browser class, type a
time with the keyboard only; confirm no native wheel is required; confirm the picker
fallback works; confirm break/work validation still gates save.

---

## R4-4 — Staff schedule edits survive saving another staff member (KMO-05)

**File:** `apps/booking-admin/src/app/dashboard/page.tsx` — `schedules` state (`:113`),
`updateScheduleDay` (`:488`), `handleSaveSchedule` (`:498-509`), `loadDashboardBookings`
(`:181-211`).

**Root cause (R0):** `handleSaveSchedule` → `saveStaffWeeklySchedule(one staff)` →
`loadDashboardBookings(false)` → `setSchedules(data.schedules)` overwrites the **whole**
array, discarding unsaved edits on every other staff card.

**Change:**
1. **Dirty tracking:** `dirtyStaffIds: Set<string>` — `updateScheduleDay` adds the staffId;
   a successful single save removes it.
2. **Patch, don't reload:** after `saveStaffWeeklySchedule(staffId, days)` succeeds, update
   only that staff's entry in `schedules` from the known-saved `days` (no full refetch).
   Keep a `loadDashboardBookings` call **only** for the failure path / other tabs.
3. **Per-card unsaved marker** + disable navigation-away confirm (`beforeunload` /
   in-app guard) while `dirtyStaffIds.size > 0`.
4. **"Save all changes"** button at the section level: iterates dirty staff, calls
   `saveStaffWeeklySchedule` per staff (sequential, stop-on-error, report which failed),
   clears dirty set on full success. (Batch RPC is a nicer R7 option; sequential is fine
   for V1 and needs no schema.)
5. When R2's `SHOP_WEEKLY` mode lands (R7), this section additionally disables per-staff
   *recurring weekly off-day* toggles — out of R4 scope, leave a `// R2 mode gate` note.

**Risk:** medium — state-management change on a tab that currently loses data, so the
downside is bounded.

**Test (`tests/`):** extract the schedule-merge reducer (`applySavedStaffSchedule(state,
staffId, days)`) and test: saving staff A does not change staff B's entry; dirty set
transitions.

**Browser proof:** edit staff A and staff B, save A, confirm B keeps edits; reload, confirm
A persisted; try to leave with B dirty, confirm the guard fires.

---

## R4-5 — "Preview customer page" action + Readiness panel (KMO-03 / R3 §5)

**File:** `apps/booking-admin/src/app/dashboard/page.tsx` — currently only an external `<a>`
(`:723-731`) and a copy-link bar (`:1224-1240`).

**Change:**
- **Preview button** always visible on the dashboard header / landing, regardless of setup
  state: opens `${BOOKING_SITE_URL}/book/${shopSlug}` (new tab is acceptable for V1; an
  embedded responsive `<iframe>` preview is a nice-to-have).
- **Readiness panel** on the "bookings" landing tab: one row per capability from R3 §5
  (`profile`, `services`, `staff`, `schedule`, `payment`, `public_booking`), each computed
  **client-side** from data `fetchAdminDashboardData` already returns (plus one extra count
  query if needed for active services/staff — those are already loaded). Each row: state
  chip + a link that switches to the tab that fixes it.
- No schema, no new RPC for the Junction-A-clear version. `get_shop_readiness` RPC (R3) is
  the R7 upgrade.

**Risk:** low — additive UI.

**Test:** extract `computeReadiness(dashboardData)` pure function → unit test each capability
GREEN/attention transition.

**Browser proof:** load a half-configured shop, confirm each readiness row is truthful;
click Preview before setup is complete, confirm it opens.

---

## R4-6 — Consumer truthful empty / negative states (KMO-09)

**File:** `apps/booking-consumer/src/app/book/[slug]/page.tsx`.

**Now:** only `isBookingBlocked` (`is_accepting_online_bookings === false`, `:354-368`) has a
dedicated screen. Everything else falls through to a dead stepper.

**Change:** compute a `bookingState` before rendering the stepper, from data already
fetched (`shop`, `services`, `staffList`, `staffSchedules`):

| state | condition | screen |
|---|---|---|
| `LOADING` | `isLoadingShop` | spinner (exists) |
| `SHOP_NOT_FOUND` | `shop === null` after load | "shop unavailable" (distinct from load error) |
| `LOAD_ERROR` | fetch threw (track a `loadError` flag in the `catch`) | "temporary problem, try again" + retry |
| `BOOKING_DISABLED` | `is_accepting_online_bookings === false` | existing blocked screen |
| `NO_SERVICES` | `services.length === 0` | "no services offered yet" + shop phone |
| `NO_STAFF` | `staffList.length === 0` (and services need a provider) | "no provider available" + shop phone |
| `NO_SCHEDULE` | staff exist but `staffSchedules.length === 0` | "booking schedule not set up" + shop phone |
| `NO_SLOT_FOR_DATE` | all `availableTimeSlots` unavailable for the chosen date | inline (already partly there) — keep, make copy explicit |
| `PAYMENT_NOT_CONFIGURED` | deposit required for the chosen service and no valid `promptpay_number` | block step 3 with "shop hasn't finished payment setup" (pairs with R4-7) |
| `OK` | none of the above | the stepper |

Each non-OK state: clear heading, one line of explanation, the shop's phone as a fallback
action (mirroring the existing blocked screen). HTTP status is unchanged — a truthful 200
negative state is acceptable (brief §11); a 200 dead stepper is not.

**Risk:** low-medium — a render gate in front of the stepper; data already present.

**Test:** extract `resolveBookingState({shop, services, staffList, staffSchedules, loadError})`
→ unit test every row.

**Browser proof:** point at shops in each broken state (no services / no staff / no schedule
/ payment missing), confirm the right screen; confirm a genuine network failure shows
`LOAD_ERROR` not `SHOP_NOT_FOUND`.

---

## R4-7 — Consumer stops inventing PromptPay recipient / deposit (KMO-X3 / HC-02, HC-03)

**File:** `apps/booking-consumer/src/app/book/[slug]/page.tsx:124-138, 486, 693`.

**Now:**
```ts
const promptpayNumber = shop?.promptpay_number || '0812345678';
const depositAmount = selectedService?.deposit_amount ?? shop?.default_deposit_amount ?? 100;
```

**Change (client half — server `PAYMENT_NOT_CONFIGURED` guard is R7):**
- Remove the `'0812345678'` and `?? 100` literals.
- `promptpayNumber` = `shop?.promptpay_number ?? null`; `depositAmount` = the value the
  **hold RPC response** returns (`holdResult.deposit_amount`), not a client re-derivation.
- If a deposit-required service is selected and `promptpay_number` is null → `bookingState`
  = `PAYMENT_NOT_CONFIGURED` (R4-6), never render a QR.
- Step 1 / step 3 deposit display reads `selectedService?.deposit_amount` when set, else
  shows "deposit set by shop" placeholder — no `100`.
- The QR is only rendered when `promptpayPayload` is non-null **and** the amount came from
  the server.

**Risk:** medium — touches the payment display path. But the current behaviour is a P0
(customer pays a real amount to a hardcoded stranger's number), so the downside of the change
is strictly better.

**Test:** `promptpay.test.ts` already covers payload generation; add a case asserting the
page-level guard: `resolvePaymentDisplay({promptpayNumber: null, depositRequired: true})`
→ `{ state: 'NOT_CONFIGURED', showQr: false }`.

**Browser proof:** a shop with `require_deposit = true` and no PromptPay → step 3 shows the
not-configured state, no QR; a properly configured shop → QR renders with the server amount.

---

## R4-8 — Client hold countdown derives from server `expires_at` (HC-19)

**File:** `apps/booking-consumer/src/app/book/[slug]/page.tsx:65, 263`.

**Now:** `useState<number>(900)` and `setTimeLeft(900)` — a second copy of the server's
15-minute value.

**Change:** compute `timeLeft` from `holdResult.expires_at` minus now, recomputed on tick.
If `expires_at` is null (no deposit path) the timer is not shown. Removes the magic `900`;
stays correct if R7 makes the hold window merchant-configurable (HC-18).

**Risk:** minimal.

**Test:** none needed; browser proof: start a hold, confirm the countdown matches the
server `expires_at`.

---

## Not in R4 (needs LAB — see R7)

- `update_shop_profile` / `update_shop_payment` RPC split (R3) — the admin tab reorg (R3 §7)
  can be **staged** in R4 UI but the two-RPC save cannot land until R7; until then the admin
  keeps calling `update_shop_settings`. **Decision:** hold the Profile/Payment tab split for
  R7 so the UI and RPC change together; R4 does items 1–8 only.
- `create_booking_hold` `PAYMENT_NOT_CONFIGURED` guard — R7.
- slot interval from config — R5/R7 (R4-3 hardcodes 30 with a note).
- `SHOP_WEEKLY` mode UI — R7.

## Implementation order & proof gate

1. Land R4-1, R4-8 (trivial, low risk) — proof: quick manual check.
2. Land R4-2 + `useNumericField` + its test.
3. Land R4-5 (additive).
4. Land R4-6 + `resolveBookingState` + test.
5. Land R4-7 (pairs with R4-6).
6. Land R4-3 (`time-field.tsx`) + parse tests.
7. Land R4-4 (schedule dirty-state) + merge-reducer test.

Each step: `npm test` green, `npm run lint` green (needs a lint-safe env — run in a
worktree with a placeholder `.env.local`, never the real one), then the per-item browser
proof against approved staging. Nothing is marked accepted on `npm test` alone (brief §16.4).

## R4 verdict

**UX REMEDIATION:** SPEC LOCKED, 8 items, implementation-ready.

- All 8 are Junction-A-clear (source only).
- 3 shared helpers extracted (`useNumericField`, `time-field.tsx` parse/format,
  `resolveBookingState`) — each unit-testable without a backend.
- Profile/Payment tab split deferred to R7 to co-land with the RPC split.
- **BROWSER/MOBILE PROOF OWED** for every item — blocked on an approved runtime target,
  not on the code.

**Next:** R5 — service scheduling model (TIME_SLOT vs DATE_RANGE, configurable slot
interval, kill the 30-minute assumption).
