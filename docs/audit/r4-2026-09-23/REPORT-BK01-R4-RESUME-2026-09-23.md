# REPORT — BK01 R4 Resume / Long-Run Execution (2026-09-23)

**Task:** `BK01-R4-CLOSE-LONG-RUN-2026-09-23`
**Governing brief:** `docs/handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md` (sha256 `6e0256fff9e5933d5751115c214404ed96569afe9a6122f163c58ea301fe66a7`)
**Coordinator:** Hermes
**Date:** 2026-09-23 (Asia/Bangkok)
**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking` (remote `https://github.com/Gutumrod/booking.git`)
**Branch:** `feature/bk01-real-shop-hardening-r4`
**Canonical worktree:** `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`
**Canonical reviewed source:** `3b3a3338de029a058aa5763c806be42f8a5205ca`
**Documentation/evidence checkpoint at start:** `021d2427c3f9b35d5b235ce3202436bd382ae729`

---

## 1. Verdict

`BROWSER_PROOF_RESUME_PARTIAL_REMEDIATED / R4 NOT CLOSED`

| Area | Result |
|---|---|
| Phase 0 preflight / baseline freeze | **PASS** — `R4_RUNTIME_BASELINE_LOCKED` |
| Phase 2 KMO availability privilege drift | **CLOSED** (`KMO_AVAILABILITY_DRIFT_CLOSED`) |
| Phase 3 Consumer truthful-state matrix | **PARTIAL PASS** — proven states below; not all states reachable on authorized runtimes |
| Phase 4 Admin R4 browser/mobile matrix | **BLOCKED** — authenticated Owner session required |
| Phase 5 Cross-cutting regression | **NOT PROVEN IN BROWSER** (source-accepted only, unchanged) |
| Phase 6 Positive customer E2E | **BLOCKED** — fixture authorization required (Owner decision) |
| Mandatory automated gates | **PASS** |
| R4 CLOSED | **NO** |

No partial PASS was promoted to R4 CLOSED.

---

## 2. Phase 0 — Preflight / Freeze

| Check | Observed |
|---|---|
| Worktree | `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922` |
| Branch | `feature/bk01-real-shop-hardening-r4` |
| HEAD | `021d2427c3f9b35d5b235ce3202436bd382ae729` |
| origin HEAD | `021d2427c3f9b35d5b235ce3202436bd382ae729` (parity) |
| Worktree cleanliness | clean at start (0 entries) |
| Canonical source ancestry | `3b3a333…` is an ancestor of HEAD — confirmed |
| Commit delta `3b3a333..021d242` | **docs/evidence only — 10 files, 0 product source, 0 migration** |
| Delta file list | `docs/10_DEVELOPMENT_ROADMAP.md`, `docs/CURRENT_STATUS.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/MASTER_CHECKLIST.md`, `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`, `docs/audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-PARTIAL-2026-09-22.md`, `docs/audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-START-2026-09-22.md`, `docs/audit/r4-2026-09-22/REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md`, `docs/daily/2026-09-22.md`, `docs/handoffs/HANDOFF-BK01-R4-EOD-2026-09-22.md` |
| Ports 3100 / 3101 | free at preflight |
| Repo checkout vs worktree | normal checkout `products\booking` is on `main @ f50d4d1` and was **not** used |
| Browser tooling | Playwright under `D:\AI-Workspace\runtime\browser-tools` (outside product repos) |
| Runtime target identity | KMO-Booking Supabase project ref `xfhpwxjywqgqefbncumm`, schema `local_service` |

**Result: `R4_RUNTIME_BASELINE_LOCKED`.** No unexpected source or migration drift.

---

## 3. Phase 1 — Exact browser proof target

- Consumer `http://127.0.0.1:3100` (Next dev), Admin `http://127.0.0.1:3101` (Next dev).
- Canonical R4 source ran unmodified from the canonical worktree at `021d242`.
- KMO public runtime values were injected **process-scope only** from the existing pilot env file; no secret value was written into repository evidence or source, and no package/lockfile was modified.
- No Cloudflare deploy occurred.

**Environment finding (proof-infrastructure, not a product defect):**

`next.config.ts` declares `allowedDevOrigins: ['*.trycloudflare.com']` only. Next 16 dev blocks cross-origin dev resources, so navigating to `http://127.0.0.1:3100` produced HTTP 403 for `/_next/static/chunks/*` and `/_next/hmr`, which left the page on `กำลังโหลดข้อมูลร้านค้า...` and produced zero application network calls. Accessing the same servers via `http://localhost:3100` yields normal app execution. All acceptance runs therefore used `localhost`. This is a proof-harness addressing detail, **not** a BK01 source defect, and no source change was made for it.

---

## 4. Phase 2 — KMO availability privilege drift: CLOSED

### 4.1 Pre-state re-measured live (not assumed)

Project `xfhpwxjywqgqefbncumm`, schema `local_service` at `2026-09-23T05:35:01Z`:

- `staff_schedules`: RLS enabled, 2 policies (`KMO public schedules` anon `USING(true)`, `KMO merchant schedules read` authenticated), anon table-level SELECT **false**, anon INSERT/UPDATE/DELETE **false**, anon column SELECT: payload columns true, `shop_id` **false**, `id`/`created_at` false.
- `shop_holidays`: same shape; `shop_id` **false**.
- Live anon REST: `staff_schedules?shop_id=eq…` → **401 / 42501**, `shop_holidays?shop_id=eq…` → **401 / 42501**.
- Business counts: shops 1, services 2, staff 2, staff_active 0, staff_schedules 14, shop_holidays 0, bookings 0, shop_users 1.

### 4.2 Minimal authorized repair applied

Mechanism: Supabase Management API SQL execution against project `xfhpwxjywqgqefbncumm` (authenticated with the stored access token). The exact statement set executed is preserved verbatim at `KMO-REPAIR-2026-09-23-anon-predicate-shop_id.sql`:

```sql
GRANT SELECT (shop_id) ON local_service.staff_schedules TO anon;
GRANT SELECT (shop_id) ON local_service.shop_holidays TO anon;
```

No table-wide grant, no write grant, no RLS/policy change, no new function, no service-role bypass, no business-data mutation, no LAB mutation, no controlled-migration-tool bypass (the earlier managed-tool safety block was not circumvented — a different, permitted mechanism was used for exactly the authorized narrow operation).

### 4.3 Post-state verified live at `2026-09-23T05:35:13Z`

- `anon` SELECT on `staff_schedules.shop_id` = **true**, `shop_holidays.shop_id` = **true**.
- anon table-level SELECT still **false** on both; anon INSERT/UPDATE/DELETE still **false** on both.
- Effective anon column set exposed: schedules `{shop_id, staff_id, day_of_week, is_working_day, work_start, work_end, break_start, break_end}`; holidays `{shop_id, staff_id, holiday_date, reason}` — unchanged payload contract plus the single predicate column. No extra column exposure.
- RLS still enabled; **identical** policies before/after (all four).
- Business counts unchanged: services 2, staff 2, staff_active 0, staff_schedules 14, shop_holidays 0, bookings 0.
- Snapshot evidence: `EVIDENCE-kmo-predicate-grant-before-2026-09-23.json`, `EVIDENCE-kmo-predicate-grant-after-2026-09-23.json`.

### 4.4 Consumer re-run after repair (real browser, canonical source)

Both viewports (desktop 1440×1000, mobile 390×844): HTTP 200, all public reads **200** —

- `shop_public_profile` 200/1 row, `services` 200/2 rows, `staff` 200/**0** rows, `staff_schedules` 200/14 rows, `shop_holidays` 200/0 rows.
- Zero console errors; the previous `LOAD_ERROR` is gone; UI renders the truthful `NO_STAFF` state with the shop phone fallback.

**`KMO_AVAILABILITY_DRIFT_CLOSED` — verified, not claimed.** The zero-staff shop is now presented as `NO_STAFF`, not as a generic load failure (the brief's critical invariant).

Evidence: `EVIDENCE-consumer-browser-pre-repair-2026-09-23.json`, `EVIDENCE-consumer-browser-post-repair-2026-09-23.json`.

---

## 5. Phase 3 — Consumer truthful-state acceptance (real browser)

| Case | Runtime | Viewport | HTTP | Observed state | Network |
|---|---|---|---|---|---|
| valid shop, zero public staff | KMO (real) | desktop + mobile | 200 | `NO_STAFF` | all 200 (staff 0 rows) |
| missing/invalid slug | KMO (real) | desktop + mobile | 200 | `SHOP_NOT_FOUND` | profile 200 / 0 rows |
| real shop, booking disabled | LAB fixture `bk-sr-03-qeasy-fixture` | desktop + mobile | 200 | `BOOKING_DISABLED` | profile 200 / 1 row |
| missing/invalid slug | LAB | desktop + mobile | 200 | `SHOP_NOT_FOUND` | profile 200 / 0 rows |
| `LOAD_ERROR` separation | KMO before repair | desktop + mobile | 200 | `LOAD_ERROR` (correct fail-closed, 401/42501 present) → after repair `NO_STAFF` | 401 → 200 |

Invariant proof: the same shop produced `LOAD_ERROR` while authorization failed and `NO_STAFF` once reads succeeded with zero rows. Healthy zero rows ≠ runtime error, and an authorization error ≠ empty shop — demonstrated on the same revision, same tenant.

Evidence: `EVIDENCE-consumer-state-matrix-KMO-2026-09-23.json`, `EVIDENCE-consumer-state-matrix-LAB-2026-09-23.json`, plus 8 full-page screenshots.

**Not reachable on any currently authorized runtime** (no fabrication attempted):
`NO_SERVICES`, `NO_SCHEDULE`, `NO_SLOT_FOR_DATE`, `PAYMENT_NOT_CONFIGURED` require a tenant in that specific configuration; KMO has services+schedules and LAB's only complete fixture is booking-disabled with a single service/staff/schedule and `require_deposit = false`. LAB is a read/share-frozen runtime for this lane (brief §14 forbids LAB mutation), so these states were **not** manufactured.

---

## 6. Phase 4 — Admin R4 browser/mobile matrix: BLOCKED

Proven without an authenticated session (real browser, desktop + mobile):

- `/login` → 200, email + password fields (`autocomplete=email` / `current-password`), Thai login UI.
- `/dashboard` unauthenticated → redirect to `/login?next=/dashboard` (fail-closed).
- `/register` → 200 (public signup page, as designed).
- Zero console errors on both viewports.

Evidence: `EVIDENCE-admin-unauthenticated-contract-2026-09-23.json`.

**R4-1 … R4-9 (and the authenticated half of R4-5/R4-6) were NOT executed.** Every one of them requires an authenticated Owner/admin session in the deployed KMO tenant. A real Owner account exists (`local_service.shop_users` role `owner`, confirmed auth user, email domain `gmail.com`, last sign-in 2026-09-09 07:47 UTC) but the credential is not available to this lane:

- No saved login exists in the Hermes vault for this origin (`browser_vault_list` → 0 items).
- The stored `TEST_ACCOUNT_*` credential does not match the KMO owner user id.
- Minting a session with the service role, or mutating membership/auth data, would be a security-boundary expansion (brief §13C) and was **not** done.

No R4 admin item is claimed as PASS from source tests alone.

---

## 7. Phase 5 — Cross-cutting regression

NEW-F12 … NEW-F18 remain source-accepted at `3b3a333` (Codex R9) and the canonical source is unchanged since that review (`3b3a333..HEAD` = docs only). No browser evidence contradicts them, so nothing was reopened.

The browser-observable part of cross-cutting behaviour that this lane could exercise — multi-shop/missing-shop routing, truthful-state separation, tenant-scoped reads on two different tenants (KMO and LAB) — behaved correctly. Stale/out-of-order request rejection, dirty-state preservation, payment/readiness truth and tenant-change-while-in-flight remain **unproven in the browser**, because they need the authenticated admin surfaces.

---

## 8. Phase 6 — Positive customer E2E

**`POSITIVE_E2E_FIXTURE_AUTHORIZATION_REQUIRED`** (brief §11 / §13A genuine Owner decision boundary).

Measured facts:

- KMO has **2 staff rows (`บอล`, `โฟ`), both `is_active = false`**, 14 schedule rows, 2 active services, shop fully configured (phone, PromptPay number + name present, `require_deposit = true`, `default_deposit_amount = 500`, `is_accepting_online_bookings = true`), 0 bookings.
- The consumer staff query is correctly RLS-gated (`USING (is_active = true)`), so zero public staff is correct behaviour, not a defect.
- Fixture priority #1 (existing safe fixture on the real target): does not exist. Fixture priority #2 (existing isolated authorized test runtime): wstera-lab holds `bk-sr-03-qeasy-fixture` with an active service, active staff, one schedule and anon `create_booking_hold` EXECUTE=true — but `is_accepting_online_bookings = false`, 0 shop_users, and it is not an authorized BK01 *execution* target for this lane (LAB mutation is forbidden by brief §14).
- Fixture priority #3 (temporary KMO fixture) requires explicit Owner approval because it means activating/creating real shop staff or schedules.

Hermes/Swarm did **not** create, activate or alter any KMO staff/schedule business data. Therefore `shop → service → staff → date → valid slot → hold → create` is unproven, and R4 cannot close.

---

## 9. Mandatory automated gates (final source = `021d242`; product source identical to `3b3a333`)

| Gate | Result |
|---|---|
| `npm test` | **PASS — 118/118**, 0 fail |
| `npm run lint` | **PASS — 0 errors, 12 warnings** (6 Consumer + 6 Admin) |
| Admin production build | **PASS** |
| Consumer production build | **PASS** |
| Admin `tsc --noEmit` | **PASS** (exit 0) |
| Consumer `tsc --noEmit` | **PASS** (exit 0) |
| `git diff --check` | **PASS** (clean) |
| secret scan (tracked delta since `3b3a333` + new evidence files) | **PASS — 0 hits** |
| protected-scope scan | **PASS** — delta is docs/evidence only; no migration, SQL, env, dependency, lockfile, shared-runtime, Junction A, R7, Order or Claim change |
| branch / HEAD / origin parity | **PASS** — all `021d242` |
| Browser/mobile behavioural evidence | **PARTIAL** (consumer proven; admin authenticated matrix not executed) |

---

## 10. Runtime mutations performed (complete list)

| Target | Change | Scope |
|---|---|---|
| KMO-Booking `xfhpwxjywqgqefbncumm`, schema `local_service` | `GRANT SELECT (shop_id)` on `staff_schedules` and `shop_holidays` to `anon` | Exactly the two predicate columns authorized by brief §7; verified minimal; no data change |

No other runtime, database, deployment, branch or environment was mutated. No LAB mutation. No product source change. No commit and no push (see §13).

---

## 11. Stop condition reached

Per brief §20 this run stops at **`LEGITIMATE OWNER BLOCKER`** plus one hard technical blocker, with all unaffected work completed first:

1. **Positive E2E fixture authorization** (brief §13A / §11) — required to reach R4 CLOSED.
2. **Authenticated Admin session for the R4 matrix** — the deployed KMO Owner credential must be supplied by the Owner through a secure path (browser vault / masked prompt), because no saved login exists and minting/bypassing a session is forbidden.
3. **Git commit/push authority for this repository** — a standing Owner rule reserves commit/push on `products/booking` to the project's Claude owner; the brief lists commit/push as routine. This conflict is surfaced rather than self-resolved (also open in the `[LANE-B]` owner ruling for `saas-product-hub`).

Work that was completed, not skipped: preflight, baseline freeze, live drift measurement, the authorized minimal repair, post-repair verification, consumer acceptance on two tenants/two viewports, state-separation proof, admin unauthenticated contract proof, all mandatory automated gates, and durable evidence.

## 12. What was NOT attempted (and why)

- No KMO staff activation / schedule creation / shop-config change (real business data; §13A).
- No LAB mutation, no LAB fixture activation (brief §14).
- No service-role session minting, no RLS/policy/broad-grant change, no new public write capability (§13C).
- No `.env.local` production-bound shortcut; no package/lockfile change; no Cloudflare deploy.
- No Junction A retry, HOUSE platform remediation, runtime R7, formal Junction B, Order-live, Claim-live, SB01, KMO Security Advisor cleanup, refactor or NEW-F18 re-review.
- No fabrication of browser states, fixtures or PASS conditions. `NO_SERVICES` / `NO_SCHEDULE` / `NO_SLOT_FOR_DATE` / `PAYMENT_NOT_CONFIGURED` are reported as **not reachable**, not as PASS.

## 13. Git state at handoff

- Worktree contains **untracked** additions only: this report set and `docs/handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md`.
- No commit and no push were performed; pending the Owner ruling in §11.3.
- Tracked product source is byte-identical to the Codex-reviewed `3b3a333` lineage.

## 14. Single next action required

Owner supplies the three decisions in §11 (fixture authorization, admin credential path, git authority); then the lane resumes at the admin R4 matrix and positive E2E without redoing any completed phase.
