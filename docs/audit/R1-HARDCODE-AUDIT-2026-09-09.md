# R1 — BK01 Hardcoded Merchant-Policy Audit

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Phase:** R1 of `BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
**Mode:** SOURCE AUDIT — no code change in this phase
**Branch:** `docs/bk01-real-shop-hardening`
**Source scanned at:** HEAD `cbc2397` (canonical BK01, `edeb49e` + R0 lock)
**Predecessor:** `docs/audit/R0-KMO-EVIDENCE-LOCK-2026-09-09.md`

## Purpose

Enumerate every place BK01 embeds a merchant business decision in code or schema instead of
reading it from configuration. Each entry is classified: is this a value a shop may
reasonably want different (`MERCHANT_CONFIG`), a starting value that should be an
overridable product default (`PRODUCT_DEFAULT`), a genuine non-negotiable system rule
(`SYSTEM_INVARIANT` — stays in code, but must be **stated** as policy), or a cosmetic
default string (`COSMETIC`).

Brief §2: *do not hardcode merchant business policy; hard-lock system invariants.*
Brief §7 lists what is configurable vs invariant — this audit maps the code against that
list.

## Method

- `grep` for numeric/interval/time literals across `supabase/migrations/**`, `apps/**`.
- Full read of the admin dashboard, admin-service, consumer booking page, booking-service,
  `create_booking_hold` (all 6 historical definitions), `customer_reschedule_booking`,
  `update_shop_settings`, ticket domain.
- Order preparation: `docs/order/**` Phase 0 docs only (no Order runtime code exists on this
  branch; Order safe scaffold lives on `feature/bk01-order-safe-scaffold`, out of scope for
  R1 and re-audited at Junction B).
- Cross-referenced against R0 findings KMO-07, KMO-X2, KMO-X3, KMO-X4, KMO-X5.

## Severity key

- **P0** — creates false business/payment truth, or forces a merchant class out entirely.
- **P1** — wrong for many shops; blocks the diversity matrix (brief §12).
- **P2** — friction / cosmetic / safe default that should still become configurable per the
  long-term plan.

---

## Inventory

### A. Deposit & payment policy

| ID | Location | Current hardcoded value | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-01 | `apps/booking-admin/src/app/dashboard/page.tsx:1318` | `setServiceDeposit(Math.round(price * 0.3))` on price change | `MERCHANT_CONFIG` | shop (explicit deposit decision) | **P0** | clear (client) |
| HC-02 | `apps/booking-consumer/src/app/book/[slug]/page.tsx:124` | `promptpay_number \|\| '0812345678'` | `SYSTEM_INVARIANT` (never invent recipient) | — fail closed | **P0** | clear (client + view flag) |
| HC-03 | `book/[slug]/page.tsx:131,486,693` | `deposit ?? shop.default ?? 100` | `SYSTEM_INVARIANT` (never guess amount) | — fail closed | **P0** | clear (client) |
| HC-04 | `supabase/migrations/20260807051615_local_service_initial_schema.sql:20` | `shops.default_deposit_amount NUMERIC DEFAULT 100.00` | `PRODUCT_DEFAULT` | platform default, shop-overridable | P2 | schema — R7 |
| HC-05 | `initial_schema.sql:19` | `shops.require_deposit BOOLEAN DEFAULT true` | `PRODUCT_DEFAULT` | shop | P1 | schema — R7 |
| HC-06 | `create_booking_hold` (all defs, e.g. `20260807052329_fix_service_deposit_override.sql:62`) | `v_deposit_required := COALESCE(v_shop.require_deposit, true)` | `PRODUCT_DEFAULT` | shop | P1 | RPC — R7 |
| HC-07 | `book/[slug]/page.tsx:1446,1458` + `update_shop_settings` RPC (`20260807191046_...:74-80`) | PromptPay number **and** name `RAISE EXCEPTION ... required` — blocks all profile saves | `SYSTEM_INVARIANT` misplacement — payment gate on profile RPC | split (R3) | **P0** (= KMO-06) | RPC split — R7 |
| HC-07b | `provision_owner_shop` RPC (`20260807161412_...:58-60`) | registration `RAISE EXCEPTION 'All shop and owner fields are required'` includes `p_promptpay_number` + `p_promptpay_name` — a shop **cannot be created** without PromptPay | `SYSTEM_INVARIANT` misplacement — second payment gate, on provisioning | split (R3) | **P0** (= KMO-06) | RPC — R7 |
| HC-07c | `provision_owner_shop` RPC (`...:99,112`) | `line_oa_id` hardcoded to literal `'central_booking_oa'` on every new shop | `PRODUCT_DEFAULT` (matches LINE commercial override, but a literal) | platform | P2 | RPC — R7 |
| HC-08 | `dashboard/page.tsx:535` | `if (serviceDeposit > servicePrice)` client-only guard | `SYSTEM_INVARIANT` (should also be server-side) | server | P1 | RPC — R7 |

### B. Duration, slot interval, business hours

| ID | Location | Current hardcoded value | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-09 | `dashboard/page.tsx:1300-1301` (client) **and** `create_service`/`update_service` RPC `RAISE EXCEPTION 'Duration must be a positive multiple of 15 minutes'` (`20260807175455_...:89,155`) | duration `min/step 15` client + server-enforced 15-minute multiple | `MERCHANT_CONFIG` (unit + granularity) | shop | **P1** (= KMO-07) | client input clear; server rule needs R5/R7 |
| HC-10 | `dashboard/page.tsx:145,516` | `serviceDuration` default `45` | `PRODUCT_DEFAULT` | shop | P2 | clear |
| HC-11 | `initial_schema.sql:43` | `services.duration_minutes INTEGER NOT NULL DEFAULT 30` | `PRODUCT_DEFAULT` | shop | P2 | schema — R7 |
| HC-12 | `book/[slug]/page.tsx:22` | `ALL_TIME_SLOTS = ['09:00',...,'19:00']` 30-min grid, service-independent, client-only | `MERCHANT_CONFIG` (slot interval + open hours) | shop | **P1** (= KMO-X2) | clear (client reads config); needs a config source R3/R7 |
| HC-13 | `book/[slug]/page.tsx:50` | `selectedTime` initial `'11:00'` | `COSMETIC` | — | P2 | clear |
| HC-14 | `staff_schedules.sql:11-14` | `work_start DEFAULT '10:00'`, `work_end '19:00'`, `break_start '12:00'`, `break_end '13:00'` | `PRODUCT_DEFAULT` | shop/staff | P2 | schema — R7 |
| HC-15 | `staff_schedules.sql:10` | `is_working_day BOOLEAN DEFAULT true` | `PRODUCT_DEFAULT` | shop/staff | P2 | schema — R7 |
| HC-16 | `apps/booking-admin/src/lib/admin-service.ts:375-382` | missing schedule row → fabricated `{workStart:'10:00', workEnd:'19:00', breakStart:'12:00', breakEnd:'13:00', isWorkingDay:false}` shown in admin UI | `PRODUCT_DEFAULT` (invented default schedule surfaced to merchant) | shop | P2 | clear (client) |
| HC-17 | *(gap)* no shop-level recurring weekly closure exists at all | `ARCHITECTURE_GAP` (= KMO-01) | shop `MERCHANT_CONFIG` | **P1** | schema — R7 |

### C. Hold / recovery / lifecycle timers

| ID | Location | Current hardcoded value | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-18 | `create_booking_hold` all defs (`20260807051839_...:149` etc.); `product_rules_v1.sql:52,268,431`; `phase_a_...:126,462` | hold `expires_at := NOW() + INTERVAL '15 minutes'` | `PRODUCT_DEFAULT` (deposit payment window) — arguably `MERCHANT_CONFIG` | shop | P1 | RPC — R7 |
| HC-19 | `book/[slug]/page.tsx:65,263` | client countdown `timeLeft = 900` seconds | mirror of HC-18 — must derive from server `expires_at`, not a second literal | — | P1 | clear (client) |
| HC-20 | `product_rules_v1.sql:408,413`; `phase_a_...:414` | `extend_booking_hold` grants `+ INTERVAL '5 minutes'` | `PRODUCT_DEFAULT` | shop | P2 | RPC — R7 |
| HC-21 | `create_booking_hold` all defs (`...:249`) | `link_token_expires_at := NOW() + INTERVAL '24 hours'`; also `bk_a_v1_...:469` | `PRODUCT_DEFAULT` (customer recovery window) | shop | P2 | RPC — R7 |
| HC-22 | `bk_a_v1_contract_remediation.sql:58-60` | recovery abuse: reset after `15 minutes`, block `30 minutes` after `>= 5` failed attempts | `SYSTEM_INVARIANT` (abuse control) — state it | — | P2 | RPC — R7 |
| HC-23 | `bk_a_v1_...:378,565` | reminder scheduled at `start_timestamptz - interval '24 hours'`; `reminder_1h` implied | `MERCHANT_CONFIG` (reminder/notification policy, brief §7) | shop | P1 | RPC — R7 |
| HC-24 | `initial_schema.sql:22` / `phase_e1_...:114` | `trial_ends_at DEFAULT NOW() + INTERVAL '14 days'` | `PRODUCT_DEFAULT` (commercial) — out of hardening scope, note only | platform | P2 | schema — R7 |
| HC-25 | `bk_a_v1_...:237` | stripe webhook stale-reclaim `5 minutes` | `SYSTEM_INVARIANT` (infra) | — | P2 | n/a |

### D. Staff assignment & availability precedence

| ID | Location | Current hardcoded value | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-26 | `create_booking_hold` auto-assign (`20260807052329_...:110-115`) | `ORDER BY (count of bookings that day) ASC, st.created_at ASC` — least-loaded round-robin | `PRODUCT_DEFAULT` (assignment strategy; some shops want fixed/priority) | shop | P2 | RPC — R7 |
| HC-27 | `create_booking_hold` vs `book/[slug]/page.tsx:164-214` vs `customer_reschedule_booking` | three independent availability implementations; only the hold RPC checks collision | `SYSTEM_INVARIANT` (= KMO-X2) — one shared precedence primitive | — | **P0** | contract R2, impl R7 |
| HC-28 | `customer_reschedule_booking` (`bk_a_v1_...:514-576`) | no `tstzrange` overlap check → server double-book (= KMO-X1) | `SYSTEM_INVARIANT` | — | **P0** | RPC — R7 |
| HC-29 | `phase_c_fail_closed_staff_schedules.sql` header | missing `staff_schedules` row ⇒ unavailable (fail-closed) | `SYSTEM_INVARIANT` — correct, keep; state it | — | — | keep |

### E. Phone / identity / locale

| ID | Location | Current hardcoded value | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-30 | `book/[slug]/page.tsx:23,29-31` | `thaiMobilePhonePattern = /^0[689]\d{8}$/` | `PRODUCT_DEFAULT` (country policy — declare it) | platform policy | **P1** (= KMO-X5) | clear |
| HC-31 | `apps/booking-admin/src/lib/ticket-domain.ts:175-181` | `normalizePhone = \D strip`; valid `9..15` digits | same policy must be shared with HC-30 | platform policy | **P1** (= KMO-X5) | clear |
| HC-32 | `create_booking_hold` (`...:130`), `customer_reschedule_booking` (`:540`), `dashboard/page.tsx:52`, `admin-service` | `AT TIME ZONE 'Asia/Bangkok'` / `timeZone: 'Asia/Bangkok'` literal in ≥4 places | `PRODUCT_DEFAULT` (declare Thailand-first as policy, one constant) | platform policy | P1 | mixed — client clear, RPC R7 |
| HC-33 | `book/[slug]/page.tsx:37` | slug fallback `'good-cuts-barber'` | `COSMETIC` (dev seed leak) | — | P2 | clear |
| HC-34 | `book/[slug]/page.tsx:20` | `CENTRAL_LINE_OA_ID` env fallback `'central_booking_oa'` | `COSMETIC` / config | platform | P2 | clear |
| HC-35 | `dashboard/page.tsx:48` | `BOOKING_SITE_URL` env fallback `'http://localhost:3000'` | `COSMETIC` (dev) | platform | P2 | clear |

### F. Cancellation / reschedule windows

| ID | Location | Current state | Class | Owner | Sev | Junction A |
|---|---|---|---|---|---|---|
| HC-36 | `bk_a_v1_...:463-464` | `shops.customer_cancel_before_hours` / `customer_reschedule_before_hours` columns **exist**, nullable, `CHECK >= 0` | `MERCHANT_CONFIG` — **already modeled correctly** | shop | — | — |
| HC-37 | *(gap)* — **no admin UI** writes HC-36; `update_shop_settings` RPC does not accept them; `customer_reschedule_booking` `RAISE EXCEPTION 'Customer reschedule policy is not configured'` when null | `ARCHITECTURE_GAP` (config exists, unreachable) | shop | **P1** | admin UI + RPC param — R3/R4 design, R7 land |

### G. Cosmetic defaults (COSMETIC — low priority, listed for completeness)

| ID | Location | Value |
|---|---|---|
| HC-38 | `admin-service.ts:310` | staff role label default `'พนักงานให้บริการ'` |
| HC-39 | `admin-service.ts:388` | holiday reason default `'วันหยุดพิเศษร้านค้า'` |
| HC-40 | `admin-service.ts:322-325` | booking relation fallbacks `'ไม่พบชื่อลูกค้า'` etc. |
| HC-41 | `book/[slug]/page.tsx:125` | `promptpayName` fallback chain ends at `t('fallbackShopName')` |
| HC-42 | `local_service_tickets.sql:432,462` | ticket cutoff `p_cutoff_date + INTERVAL '1 day'` (retention op) |

---

## Cross-cut observations

### 1. Deposit truth is invented in three layers

`create_booking_hold` resolves deposit as `service.deposit_amount` → `shop.default_deposit_amount`
→ none (HC-06). The consumer client **independently** re-derives it with a different fallback
chain ending in a literal `100` (HC-03), and generates a PromptPay QR from a literal phone
number `0812345678` if the shop has none (HC-02). A misconfigured shop therefore shows a
customer a **real QR paying a real amount to an arbitrary number**. This is the most
dangerous cluster in the audit. R3 must make the payment step fail closed and the server the
single source of the deposit figure.

### 2. Slot model is hardcoded on the client, invisible to the server

The bookable grid (`09:00`–`19:00`, 30-min steps, HC-12) exists only in the consumer bundle.
The server (`create_booking_hold`) accepts **any** `p_start_time` and only checks staff
working-hours/break/collision — it does not enforce a slot interval at all. So the "30-minute
slot" is simultaneously (a) hardcoded for the customer and (b) unenforced server-side. R2
must decide where slot interval lives (merchant config) and R7 must enforce it in the RPC.

### 3. Availability precedence is written three times and disagrees (HC-27/28)

See R0 KMO-X2 table. This is a `SYSTEM_INVARIANT` that must collapse to one primitive. R2
delivers the contract; the collision gap in reschedule (HC-28) is a live P0.

### 4. Some merchant config already exists but is unreachable (HC-36/37)

`customer_cancel_before_hours` / `customer_reschedule_before_hours` are correctly modeled as
nullable shop columns, but nothing in the admin app sets them and `update_shop_settings`
does not carry them. `customer_reschedule_booking` then hard-fails with "policy is not
configured". Net effect: customer reschedule is dead for every shop. R3/R4 add the UI +
RPC parameter path.

### 5. Timezone is Thailand-first by accident, not by declaration (HC-32)

`Asia/Bangkok` is a string literal in at least four files. Brief §13 requires this be an
explicit product policy with one normalization point, not scattered assumptions.

## Junction A partition

**Can be remediated now (source/client/docs only, no LAB):**
HC-01, HC-02, HC-03, HC-12 (client side of reading config), HC-13, HC-16, HC-19, HC-30,
HC-31, HC-32 (client portions), HC-33, HC-34, HC-35, HC-38…HC-41, and all UI work for
HC-09 (input control), HC-37 (admin form), plus every R2/R3/R5 **design** document.

**Blocked by Junction A (needs a product-local LAB forward migration in R7):**
HC-04, HC-05, HC-06, HC-07 (RPC split), HC-08 (server guard), HC-09 (model), HC-11, HC-14,
HC-15, HC-17 (`shop_weekly_closures`), HC-18, HC-20, HC-21, HC-22, HC-23, HC-26, HC-27
(shared primitive), HC-28 (collision guard), HC-32 (RPC portions), HC-36→37 (RPC param).

**Keep as invariant, just document:** HC-22, HC-25, HC-29, HC-08-server, HC-02/03 fail-closed
behavior.

**Out of hardening scope (commercial, note only):** HC-24 (trial length).

## R1 verdict

**HARDCODE AUDIT:** COMPLETE. 42 entries; 6 are P0.

- P0 cluster: HC-01 (auto-30%), HC-02 (invented PromptPay), HC-03 (invented deposit), HC-07
  (profile blocked by payment), HC-27 (divergent precedence), HC-28 (reschedule double-book).
- No KMO-only constant was found that a fix would push into generic product code
  (brief stop-condition clear).
- The `customer_cancel/reschedule_before_hours` columns show the intended pattern
  (nullable shop config) — R3 should extend that pattern to slot interval, weekly closure,
  reminder policy, lead time, and booking horizon rather than invent a new mechanism.

**Next:** R2 locks the scheduling contract (SHOP_WEEKLY / STAFF_WEEKLY / overrides /
precedence / missing-data behavior / authority / one shared enforcement), consuming HC-17,
HC-27, HC-28, HC-36/37 and R0 KMO-01, KMO-05, KMO-X1, KMO-X2.
