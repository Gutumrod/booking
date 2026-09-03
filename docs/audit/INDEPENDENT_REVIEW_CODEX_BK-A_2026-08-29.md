# Independent Review — BK-A V1 Contract Remediation (Codex FINAL-AUDITOR)

**Reviewer:** agent-codex (fresh read-only independent reviewer, FINAL-AUDITOR)
**Date:** 2026-09-03
**Branch:** `feature/bk-a-v1-contract-remediation`
**HEAD reviewed:** `908108c3f88bccaeb132d19601c94d31ec1e0f14`
**Scope:** current BK-A implementation vs locked BK-0 docs. Read-only; no product code was modified.
**Context mode:** INDEPENDENT-QA — this report was produced independently, before reading any prior reviewer's expected verdict.

## Method

Reviewed the BK-A remediation migration (`supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql`), the new/changed application routes and libs, and the unit/static contract tests. Re-ran the non-DB gates live on the real repo at HEAD `908108c`. Separated **code/design defects** (severity P0/P1/P2) from **environment evidence missing** (BLOCKED_ENVIRONMENT).

## Verdict

**PASS — no P0 or P1 code/design defect found.** Two P2 cosmetic items. DB-backed gates remain BLOCKED_ENVIRONMENT (not code defects). Continuation 04 is required to close the DB/provider runtime gates before any public V1 release.

## Live gate results (re-run by this reviewer at HEAD 908108c)

| Gate | Command | Exit | Result |
|---|---|---|---|
| G1 unit/static | `npm test` | 0 | PASS — 19/19 tests |
| G1 lint | `npm run lint` | 0 | PASS — 0 errors, 13 warnings (7 consumer + 6 admin) |
| G1 build | `npm run build` | 0 | PASS — consumer + admin production builds (Next.js 16.3.0) |
| whitespace (working tree) | `git diff --check` | 0 | PASS |
| whitespace (committed range) | `git diff --check 3aee2a5..HEAD` | 2 | P2 — see below |
| static absence | `promptpay.io` in `apps/` source | 0 hits | PASS — no runtime path in current source |
| static absence | annual offer in `apps/` source | only `annualCloseDefault` | PASS — no annual billing offer |
| static absence | legacy 100/500 paid claim in `apps/` source | 0 hits | PASS |
| static absence | unsupported absolute claim (`ปลอดภัย 100%`, guaranteed, risk-free) in `apps/` source | 0 hits | PASS |
| secret scan | `git diff 3aee2a5..HEAD -- apps/` + `supabase/config.toml` | 0 hits | PASS — no real secrets |

Note on static absence: `grep` across `apps/` (including `.next` build cache) surfaces stale `promptpay.io` and `ปลอดภัย 100%` strings in the gitignored `.next` dev cache/source maps. These are **stale build artifacts, not current source**. The current `apps/booking-consumer/src/app/book/[slug]/page.tsx` uses a local `QRCodeSVG` with `createPromptPayPayload` (no `promptpay.io`), and the footer renders `t('footer')` = "Powered by {brand}" / "Powered by {brand} • Secure booking" (no `ปลอดภัย 100%`). The `.next` directory is gitignored and not part of the deliverable. PASS on current V1 surfaces.

## Findings by review area

### 1. Tenant / staff / storage / privileged authorization — PASS (code)
- `current_staff_id()` is `SECURITY DEFINER` with `SET search_path = ''` (no search-path hijack), joins `staff`↔`shop_users` on `user_id` and `role='staff'`, requires `is_active`. Sound.
- Staff self-scope: `BK-A scoped staff reads` allows owner/admin OR `id = current_staff_id(shop_id)`. Bookings/customers reads similarly scoped. Staff cannot read shop-wide tickets (`BK-A owner admin view shop tickets` + `enforce_ticket_owner_admin` trigger on tickets/timeline). Matches A12 / FR-STF-002 / FR-SUP-001.
- Deposit-slip storage: bucket set `public=false`, size/mime limits; `submit_deposit_slip` validates the object path is booking-scoped (regex + rejects `..`/`://`), requires the object to exist in the private bucket, and requires booking in `hold` + unexpired. Owner/admin read policy joins to booking via `storage.foldername`. Sound (SEC-STO-001 / PD-007).
- Platform-admin mutation audit: `audit_platform_admin_update` trigger on `shops`/`subscriptions` writes `audit_events` only when `is_platform_admin()`. Sound (FR-OPS-001).
- `submit_deposit_slip` is granted to `anon` — intentional: the customer submits a slip using a recovery token, and the function itself enforces `authorize_booking_recovery_attempt` (rate-limited, fail-closed). Not a bypass.

### 2. Reschedule atomicity / concurrency — PASS (design), RUNTIME PENDING
- `customer_reschedule_booking` locks the booking row `FOR UPDATE`, re-validates staff active, schedule availability (incl. break overlap), holidays, and policy window; writes booking + notification + audit in one transaction. Atomic.
- Overlap protection on reschedule is enforced by the pre-existing `prevent_overlapping_staff_bookings` EXCLUDE constraint on `bookings` (`staff_id WITH =`, `booking_range WITH &&`, WHERE status IN hold/pending_review/confirmed). This is a DB-level authoritative guard that fires on UPDATE as well as INSERT, so a reschedule into an overlapping slot is rejected at the database. Not re-verified live (no local DB). Marked RUNTIME PENDING / BLOCKED_ENVIRONMENT.
- `customer_cancel_booking` similarly locks and enforces the nullable policy window (fail-closed when unconfigured — no default invented, per owner blocker).

### 3. Deposit / auto-slip fail-safe — PASS (code)
- `classifyAutoSlipResult` auto-confirms **only** an exact positive (`verified` + amount + recipient + transaction reference). `timeout`/`unknown`/`ambiguous`/`provider_error` all route to `manual_review`. No public auto-slip claim is made; `get_tier_limits` returns `auto_slip_limit = 0` for all plans (consistent with "no auto-slip claim" stance). Sound (FR-DEP-004 / PD-004).
- Duplicate transaction reference: `idx_bookings_trans_ref` unique index on `bookings(trans_ref)` (partial, where not null) rejects a second accepted deposit with the same trans_ref at the DB level. Sound (FR-DEP-004).

### 4. LINE / Stripe signature + idempotency — PASS (code)
- LINE: HMAC-SHA256 over raw body, `crypto.timingSafeEqual` (length-checked). Merchant channel resolved server-side only (`merchant-line-config.ts` imports `server-only`; credentials from `LINE_MERCHANT_CHANNELS_JSON`, never `NEXT_PUBLIC_*`). The retired admin LINE webhook returns 410 (no weaker alternate ingress). Sound (FR-LINE-002 / PD-005).
- Stripe: `constructEvent` on raw body with `STRIPE_WEBHOOK_SECRET`; invalid signature → 400 before any DB write. Idempotency via `claim_stripe_webhook_event` (ON CONFLICT, retryable after 5 min or on failed). Out-of-order guard via `last_stripe_event_created_at` in `sync_subscription_state_bk_a`. Sound (FR-BILL-001 / REL-002).
- LINE notification idempotency via unique `idempotency_key`; `claim_due_line_notifications` uses `FOR UPDATE ... SKIP LOCKED`; `complete_line_notification` guards on `attempt_count`. Sound.
- Reminder scheduler: consumer Worker has a `*/5 * * * *` cron calling `/api/notifications/dispatch` with `NOTIFICATION_DISPATCH_SECRET` bearer auth. Sound (PD-010).

### 5. Monthly-only / no legacy quota / public copy truth — PASS (code)
- `commercial-contract.ts` accepts only `basic_490`/`pro_990`; `resolveMonthlyPlan('basic_annual'|'pro_annual')` → null. `getPublicPlanPresentation` marks prices `pilot-reference-not-final`, `paidBookingLimit: null` (no 100/500 wall). Public copy uses pilot/reference wording; `ปลอดภัย` appears only as "secure deposit" (supported), no `ปลอดภัย 100%`/guarantee. Static searches confirmed 0 hits for `promptpay.io` runtime, annual offer, legacy 100/500 paid claim, and unsupported absolute claim on current V1 surfaces. Sound (PD-002/PD-003/PD-008).

### 6. Secret leakage — PASS
- No real secret values in changed files. `.env.example` uses placeholders (`your-...`, `replace-with-...`, `price_monthly_...`). `.env.local` is untracked and gitignored. `supabase/config.toml` uses `env(...)` substitution only. No `sk_`/`pk_live`/`whsec_`/private-key blocks in changed app files or config.

### 7. Tests do not bypass authority — PASS
- All 19 tests are unit/static contract tests (pure functions + file-content assertions). No test calls a live DB, RPC, or provider. No authority bypass.

## P2 (cosmetic, non-blocking)
- `git diff --check 3aee2a5..HEAD` reports whitespace issues in the committed range: blank-line-at-EOF in `commercial-contract.ts`, `deposit-slip-contract.ts`, `line-channel-config.ts`, `merchant-line-config.ts`, and three test files; trailing whitespace in `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md` (markdown line-break spaces). No functional impact. The working-tree `git diff --check` passes (exit 0); the builder evidence's "PASS exit 0" refers to the working-tree check, which is accurate, but the committed range is not whitespace-clean.
- `get_tier_limits` returns `auto_slip_limit = 0` for every plan; harmless given the no-auto-slip-claim stance, but the column is effectively dead until an owner decision sets a real allowance.

## BLOCKED_ENVIRONMENT (not code defects)
- G2 (clean migration replay, db lint, pgTAP) and all DB-backed portions of G3–G9 (live RLS/tenancy denial, concurrent overlap, Stripe ordering, LINE provider delivery, reminder scheduler invocation, CSV database content, platform-admin audit persistence) cannot be verified: no local PostgreSQL at `127.0.0.1:54322`, no `psql`, no Docker (per brief, Docker must not be installed). No production/remote DB was opened.

## Stop boundary
No push, merge, deploy, remote migration apply, or secret write was performed. This review is read-only evidence.

## Continuation 04 required?
**YES.** Continuation 04 (DB runtime gates) is required to close G2 and the DB-backed portions of G3–G9 before any public V1 release. The code/static/build surface is PASS; the remaining blockers are environmental (no approved PostgreSQL/Supabase runtime), not code defects.
