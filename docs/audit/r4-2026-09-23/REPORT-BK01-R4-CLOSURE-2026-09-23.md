# REPORT — BK01 R4 CLOSURE (2026-09-23)

**Task:** `BK01-R4-CLOSE-LONG-RUN-2026-09-23`
**Governing brief:** `docs/handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md` (sha256 `6e0256fff9e5933d5751115c214404ed96569afe9a6122f163c58ea301fe66a7`)
**Owner ruling:** `RBK01 R4 CLOSE CONTINUATION` (2026-09-23) — 3 decisions: isolated fixture approved, temporary test admin approved, git authority stays with the Claude owner.
**Coordinator:** Hermes
**Date:** 2026-09-23 (Asia/Bangkok)
**Branch:** `feature/bk01-real-shop-hardening-r4`
**Canonical worktree:** `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`
**Canonical reviewed source:** `3b3a3338de029a058aa5763c806be42f8a5205ca`
**Checkpoint at start:** `021d2427c3f9b35d5b235ce3202436bd382ae729` (local = origin)

---

## 1. R4 CLOSE GATE

| Required closure state | Result | Evidence |
|---|---|---|
| SOURCE PASS | **PASS** | Codex R9 `SOURCE_REVIEW_PASS` at `3b3a333`; no product source changed since (delta to `021d242` = docs only) |
| CONSUMER ACCEPTANCE PASS | **PASS** | state matrix + positive E2E, desktop 1440x1000 and mobile 390x844 |
| ADMIN ACCEPTANCE PASS | **PASS** | R4-1 … R4-9 executed authenticated against the fixture tenant |
| CROSS-CUTTING REGRESSION PASS | **PASS** | tenant consistency, current-shop authority, route transition, stale navigation, dirty-state, payment/readiness truth |
| POSITIVE CUSTOMER E2E PASS | **PASS** | `shop -> service -> staff -> date -> valid slot -> hold -> create` on the isolated fixture |
| MANDATORY AUTOMATED GATES PASS | **PASS** | tests 118/118; lint 0 errors/12 warnings; both builds; both typechecks; diff/secret/protected-scope clean |
| EVIDENCE COMPLETE | **PASS** | `docs/audit/r4-2026-09-23/` (index + sha256) |

**R4 CLOSED.**

---

## 2. Owner-approved fixture and test admin (provisioning)

Authorized by the Owner ruling: a synthetic tenant inside the same KMO Supabase project, plus a temporary auth user with membership limited to that tenant. Service-role/Admin path was used for provisioning and cleanup of this fixture only — never for browser authentication and never to bypass authorization.

| Item | Value |
|---|---|
| Project | KMO-Booking `xfhpwxjywqgqefbncumm`, schema `local_service` |
| Fixture tenants | `r4-test-fixture-20260923`, `r4-test-fixture-deposit-20260923`, `r4-state-no-services`, `r4-state-no-schedule`, `r4-state-no-slot`, `r4-state-deposit-hold` |
| Temporary auth user | `r4-test-admin-<random>@example.invalid` (random 32-char credential, in-memory/temp file only, never committed, never written to evidence) |
| Membership | `owner` on the fixture tenants only |
| Real KMO tenant | untouched — no staff/service/schedule/shop/booking/membership change |

Credential handling: generated at runtime, stored only in `%LOCALAPPDATA%\Temp\bk01-r4\r4-admin.env` (outside all product repos, mode 600), used for a normal `supabase.auth.signInWithPassword` browser login, never printed in logs or evidence, deleted with the fixture.

### Isolation proof (before any browser test)
- Real KMO: staff 2 (`บอล`, `โฟ`, active 0), services 2, schedules 14, holidays 0, bookings 0, shop_users 1 (`owner`), notif logs 0 — unchanged.
- Fixture: own shop, 1–4 services, 1–2 staff, 7–14 schedules, 7 weekly rows, 1 membership, 0 bookings at provisioning time.
- Membership scope check: the test user held `owner` on fixture tenants only; the real KMO membership still belonged to its own user.

Evidence: `EVIDENCE-fixture-isolation-2026-09-23.json`.

---

## 3. Phase 2 — KMO availability privilege drift (completed earlier this run)

`GRANT SELECT (shop_id)` on `local_service.staff_schedules` and `local_service.shop_holidays` to `anon`, applied through a permitted controlled mechanism, verified live:

- both predicate columns readable by anon; table-level SELECT absent; anon INSERT/UPDATE/DELETE absent;
- effective anon column set unchanged except the one predicate column; all four policies identical; RLS unchanged; business counts unchanged.

Evidence: `KMO-REPAIR-2026-09-23-anon-predicate_shop_id.sql`, `EVIDENCE-kmo-predicate-grant-before/after-2026-09-23.json`, `EVIDENCE-consumer-browser-pre-repair/post-repair-2026-09-23.json`.

---

## 4. Phase 3 — Consumer truthful-state acceptance (real browser)

All cases below ran on the exact canonical source, desktop **1440x1000** and mobile **390x844**, with network + console + full-page screenshot capture. Every public read returned HTTP 200; console errors 0.

| State | Tenant | Observed | Network |
|---|---|---|---|
| `NO_STAFF` | real KMO (`kmo-rackbarcustom`) | truthful "ยังไม่มีพนักงานรับจอง" + shop phone | staff 200/0 rows |
| `SHOP_NOT_FOUND` | real KMO (invalid slug) | "ไม่พบร้านค้า" | profile 200/0 rows |
| `OK_STEPPER` | fixture | stepper step 1 with service list | services 200/1, staff 200/2, schedules 200/14 |
| `NO_SERVICES` | `r4-state-no-services` | "ยังไม่มีบริการ" | services 200/0 rows |
| `NO_SCHEDULE` | `r4-state-no-schedule` | schedule-not-configured screen | schedules 200/0 rows |
| `NO_SLOT_FOR_DATE` | `r4-state-no-slot` (staff works Mondays only) | every slot rendered "ไม่ว่าง" for the chosen date | schedules 200/1 row |
| `PAYMENT_NOT_CONFIGURED` | `r4-state-deposit-hold` before payment config + `r4-test-fixture-deposit-20260923` | "ยังไม่ได้ตั้งค่าการรับมัดจำ" — no QR, no amount | profile/services 200 |
| `BOOKING_DISABLED` | wstera-lab `bk-sr-03-qeasy-fixture` | "ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้" | profile 200/1 row |
| `LOAD_ERROR` vs zero rows | real KMO before/after privilege repair | `LOAD_ERROR` while authorization failed → `NO_STAFF` once reads succeeded with zero rows | 401/42501 → 200 |

Critical invariant proven on the same revision and tenant: **healthy zero rows is not a runtime error, and an authorization failure is not an empty shop.**

Evidence: `EVIDENCE-consumer-state-matrix-KMO/LAB/FIX/ST-*.json` + screenshots.

---

## 5. Phase 4 — Admin R4 browser/mobile matrix (authenticated)

| Item | Required contract | Observed result |
|---|---|---|
| login | normal Supabase Auth | authenticated, landed on `/dashboard`, 0 console errors |
| **R4-1** | deposit survives price edit/save/reload | price 500→750 with merchant deposit 250 → save `update_service` 204 → reload shows price **750** / deposit **250**; a second price edit to 900 left deposit **250**. Deposit never overwritten. |
| **R4-2** | numeric input contract | clearing price leaves the field **empty** (not 0); `-5` is **visibly invalid** (`Value must be greater than or equal to 0`, `min=0`, `required`); invalid submit produced **0 RPC calls** (no mutation); valid values persist (204). |
| **R4-3** | keyboard-friendly HH:MM | 8 time fields, **all `inputMode=numeric`** with `HH:MM` placeholder; typing bare `93` stays as typed during edit, blur canonicalises to `08:00`; an invalid `2500` reverts to the last valid value. |
| **R4-4** | dirty Staff A/B preservation | 2 staff sections; edited Staff A and Staff B, saved A only → **Staff B kept its unsaved value**; UI showed the dirty-banner "บันทึกทั้งหมด (1) … กรุณาบันทึกแต่ละคน หรือกด บันทึกทั้งหมด". |
| **R4-5** | Preview + Readiness truth | "ดูตัวอย่างหน้าลูกค้า" opened the real tenant URL `/book/r4-test-fixture-20260923`; readiness panel listed โปรไฟล์ร้าน / บริการ / พนักงาน / ตารางการจอง / การรับเงิน (PromptPay) / เปิดรับจองออนไลน์, with the public-booking row truthfully reported as server-verified only (not a false green). |
| **R4-6** | consumer truthful states | proven in §4 (admin-side data drives them). |
| **R4-7** | payment truth | configured-deposit shop renders **1 QR**, amount **฿500** matching the hold RPC response `deposit_amount`, recipient name/number taken from shop config (`R4 Synthetic PromptPay` / `0000000000`) — no hardcoded `0812345678` and no client-invented `100`; unconfigured shop renders the not-configured screen with no QR/amount. |
| **R4-8** | countdown follows server `expires_at` | hold RPC returned `expires_at`; UI countdown observed running 14:56 → 14:44 (desktop) and 14:55 → 14:43 (mobile) — server-derived, not a fixed local 900 s. |
| **R4-9** | durations 1/2/37/90 | all four rendered as selectable services (`1/2/37/90 นาที`); a 1-minute booking completed through `create_booking_hold` → 200. |

Evidence: `EVIDENCE-admin-*.json`, `EVIDENCE-r4-1-r4-2-*.json`, `EVIDENCE-r4-3-r4-4-*.json`, `EVIDENCE-r4-7-r4-8-*.json`, `EVIDENCE-r4-9-*.json` + screenshots.

---

## 6. Phase 5 — Cross-cutting regression

| Area | Result |
|---|---|
| multi-shop tenant consistency | admin dashboard served exactly the fixture tenant's data (1 service, 2 staff, 14 schedule rows, 2 bookings after E2E) |
| current-shop authority | admin reads scoped to the authenticated membership tenant; no cross-tenant data appeared |
| route transition | fixture → KMO → no-services rendered the correct tenant identity each time |
| stale/out-of-order response | rapid tenant-to-tenant navigation finished on the **last** requested slug; no stale tenant render |
| cross-tenant leak | **none** — fixture text never appeared on the KMO page and vice versa |
| dirty-state preservation | Staff B unsaved edit survived saving Staff A (R4-4) |
| payment truth | §5 R4-7 |
| readiness truth | §5 R4-5 |
| tenant change while async work in flight | rapid navigation case above |

NEW-F12 … NEW-F18 were **not** reopened: no browser evidence contradicted the accepted source behaviour.

---

## 7. Phase 6 — Positive customer E2E

`shop → service → staff/resource → date → valid slot → hold → create` proven through the real UI on the isolated fixture, desktop + mobile:

- `rpc/create_booking_hold` returned **200** with `booking_id`, `booking_code`, `status = confirmed`, `deposit_status = not_required`, `staff_id` auto-assigned.
- DB confirmation: bookings `BK-QHJGJG` / `BK-WMUUTR` — `status=confirmed`, `2026-09-23 09:00–09:30`, staff linked, `total_price 500`, deposit 0, synthetic customer `R4 Synthetic Customer`.
- Deposit path separately proven: hold with `status=hold`, `deposit_status=awaiting`, `deposit_amount=500`, server `expires_at` present.

External side effects: **disabled by construction, not by hope.**

- The consumer booking path touches only `local_service.*`, the public KMO project REST/Auth endpoints and the fixture's own notification **rows**.
- `enqueue_booking_notifications` only inserts `line_notification_logs` rows (`booking_created`, `reminder_24h`, status `pending`, `sent_at` NULL). No LINE/notification/Stripe/webhook call is made from that path, and the fixture shop has no LINE channel, no OA credentials and no payment provider.
- All 7 KMO `pg_cron` jobs were inspected: none references `local_service.line_notification_logs`; the LINE cron jobs operate on `public.*` KMO chat tables only. No dispatch job targets fixture rows.
- `require_deposit = false` on the positive-E2E shop, so no financial step existed; the deposit shop used a synthetic PromptPay identity and never uploaded/approved a real slip.

Evidence: `EVIDENCE-e2e-booking-db-state-2026-09-23.json`, `EVIDENCE-r4-9-*.json`.

---

## 8. Cleanup and residue proof

Cleanup (Owner-authorized fixture scope only), one ordered transaction per table family:

| Object | Deleted |
|---|---|
| line_notification_logs | 6 |
| bookings | 5 |
| customers | 2 |
| staff_schedules | 36 |
| staff | 7 |
| shop_weekly_schedules | 42 |
| services | 9 |
| subscriptions | 6 |
| shop_users | 6 |
| shops | 6 |
| auth.identities / auth.users (test admin) | 1 / 1 |

Residue after cleanup — **all zero**:

`residual_shop_rows 0 · residual_services 0 · residual_staff 0 · residual_sched 0 · residual_bookings 0 · residual_customers 0 · residual_notif 0 · residual_members 0 · residual_subs 0 · residual_weekly 0 · residual_auth_users 0 · residual_identities 0`

Project totals returned to the KMO-only baseline: shops 1, staff 2, services 2, bookings 0, customers 0, notif logs 0.

Real KMO non-interference proven by content-level fingerprint (md5 over the real tenant's rows) before vs after cleanup — **identical on all six sets** (shops, staff, services, schedules, shop_users, weekly), and a post-cleanup anon probe returned profile 200/services 200 (2 rows)/staff 200 (0 rows)/schedules 200 (14 rows)/holidays 200 (0 rows) and rendered the same `NO_STAFF` and `SHOP_NOT_FOUND` states as before.

Evidence: `EVIDENCE-fixture-inventory-before-cleanup-2026-09-23.json`, `EVIDENCE-fixture-cleanup-residue-2026-09-23.json`, `EVIDENCE-kmo-unmodified-fingerprint-2026-09-23.json`, `EVIDENCE-consumer-state-matrix-KMO-post-cleanup-2026-09-23.json`.

---

## 9. Mandatory automated gates (final state)

| Gate | Result |
|---|---|
| `npm test` | **PASS — 118/118** |
| `npm run lint` | **PASS — 0 errors, 12 warnings** |
| Admin production build | **PASS** |
| Consumer production build | **PASS** |
| Admin / Consumer `tsc --noEmit` | **PASS / PASS** |
| `git diff --check` | **PASS** |
| secret scan (tracked delta + new evidence) | **PASS — 0 hits** |
| protected-scope scan | **PASS** — delta is docs/evidence only; no migration, SQL, env, dependency, lockfile, shared-runtime, Junction A, R7, Order or Claim change |
| branch / HEAD / origin parity | **PASS** at `021d242` (no commit performed by Hermes) |

---

## 10. Runtime mutations performed (complete list)

| Target | Change | Scope |
|---|---|---|
| KMO `local_service.staff_schedules`, `shop_holidays` | `GRANT SELECT (shop_id)` to `anon` | exactly the two predicate columns authorized by brief §7 |
| KMO `local_service.*` | synthetic fixture tenants, services, staff, schedules, weekly rows, subscriptions, memberships, bookings, customers, notification rows | Owner ruling Decision 1; all deleted, residue 0 |
| KMO `auth.users` / `auth.identities` | temporary test admin | Owner ruling Decision 2; deleted, residue 0 |

No other runtime, deployment, branch, environment or repository was mutated. No LAB mutation. No product source change.

---

## 11. Boundaries respected

Not performed: Junction A retry · HOUSE platform remediation · WSTERA LAB/shared-runtime mutation · runtime R7 · formal Junction B · Order-live · Claim-live · SB01 · KMO Security Advisor cleanup unrelated to R4 · architecture refactor · feature expansion · NEW-F18 re-review · broad grants / RLS weakening / policy expansion / service-role browser bypass / new public write capability · real KMO business-data mutation.

`work-sync` control projection: recorded once as a known control-plane blocker (`dead_letter / 422 unresolved product identity`); not retried to manufacture success, and R4 scope was not expanded to fix the Control Plane.

Proof-infrastructure finding retained: Next 16 dev blocks cross-origin dev resources for `127.0.0.1` (only `*.trycloudflare.com` allowed); `localhost` is the correct local proof origin. No BK01 source change was made for this.

---

## 12. Git state — VERIFIED_READY_FOR_CLAUDE_COMMIT

Hermes does **not** hold commit/push authority for `products/booking` (Owner ruling Decision 3, standing `claude-owns-git-commits`).

- HEAD = `021d2427c3f9b35d5b235ce3202436bd382ae729` = `origin/feature/bk01-real-shop-hardening-r4`.
- Worktree contains **only** documentation/evidence additions and updates (no source, no migration, no env, no lockfile).
- Final diff is verified: tests/lint/builds/typechecks/diff/secret/protected-scope all clean at this state.
- **Status: `VERIFIED_READY_FOR_CLAUDE_COMMIT`** — Claude reviews the diff and performs commit + push under the existing governance; after push, HEAD must equal origin and the worktree must be clean.

Changed paths (for review convenience):

```
M  docs/CURRENT_STATUS.md
M  docs/MASTER_CHECKLIST.md
M  docs/DOCUMENTATION_INDEX.md
M  docs/10_DEVELOPMENT_ROADMAP.md
M  docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md
?? docs/daily/2026-09-23.md
?? docs/handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md
?? docs/audit/r4-2026-09-23/            (report, evidence index, evidence JSON/PNG set)
```

---

## 13. Final handoff summary

| Field | Value |
|---|---|
| Repo | `D:\AI-Workspace\projects\saas-product-hub\products\booking` (remote `https://github.com/Gutumrod/booking.git`) |
| Branch | `feature/bk01-real-shop-hardening-r4` |
| Checkpoint | `021d2427c3f9b35d5b235ce3202436bd382ae729` |
| Canonical reviewed source | `3b3a3338de029a058aa5763c806be42f8a5205ca` |
| R4 status | **R4 CLOSED** |
| Browser status | consumer PASS · admin PASS · cross-cutting PASS · positive E2E PASS (desktop + mobile) |
| Tests | 118/118 PASS |
| Builds | admin PASS · consumer PASS |
| Typechecks | admin PASS · consumer PASS |
| Runtime mutations | KMO narrow predicate grant (verified) + Owner-authorized synthetic fixture and test admin (fully cleaned, residue 0); real KMO business data unchanged (fingerprint-verified) |
| Evidence | `docs/audit/r4-2026-09-23/` (index with sha256) |
| Remaining blocker | none for R4 acceptance |
| Owner decision required | none outstanding for R4 |
| Next action | Claude reviews the diff and commit/push under `claude-owns-git-commits`; then verify origin parity + clean worktree |
