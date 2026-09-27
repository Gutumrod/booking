# Brief: local-service-booking-saas — Phase A-E execution plan

Source: consolidated from Claude's own review + Codex's two independent audit rounds (23 findings total). This brief sequences remaining work into 5 phases, each with an explicit Definition of Done (DoD). Work proceeds phase-by-phase, in order — no phase starts until the prior one's DoD is met and confirmed against the live Supabase project (ref `gyleqrjdzwwlqierdwcy`) and the local repo.

---

## Phase A — Close data-integrity & authorization holes (DB migrations)

**Why first:** these are structural flaws in the database layer. Cheapest to fix now, before any real customer data exists, and every later phase builds on top of a DB that's actually sound.

**Tasks:**
1. **Exclusion constraint fix.** `prevent_overlapping_staff_bookings` was never actually created — its `WHERE` predicate referenced `NOW()` (non-immutable), which Postgres rejects in an index/exclusion predicate, and the failure was silently swallowed by a `WHEN OTHERS THEN RAISE NOTICE` block. Rewrite the predicate to drop the `NOW()` comparison (keep only `status IN ('hold','pending_review','confirmed')`), confirm via `pg_constraint` that it actually exists this time, and wrap `create_booking_hold`'s INSERT in exception handling so a real constraint violation returns a clean "unavailable" error instead of a raw Postgres error leaking to the client.
2. **Lock down `reject_deposit_slip` and `extend_booking_hold`.** Currently `GRANT ALL ... TO anon` (from the blanket schema grant in migration 4) makes both callable by anyone who knows a `booking_id` UUID, with no ownership check. `REVOKE EXECUTE ... FROM anon` on both; leave `authenticated` only, and add an `is_shop_member` check inside `reject_deposit_slip` (shop-owner action). Note: `extend_booking_hold` may be intended as a *customer* self-service action (extend their own hold before it expires) — until Phase E's auth exists, there's no way to scope "extend only your own hold" for an anonymous customer. Decision for this phase: revoke from anon entirely and leave it admin/authenticated-only for now; customer self-extend can be reconsidered once there's a real session concept for customers (out of scope here — flag it, don't build it).
3. **Harden `submit_deposit_slip` slip URL validation.** Currently accepts any arbitrary string as `p_slip_url`. Add a check that the URL matches the `deposit-slips` bucket's public URL pattern AND that the path's first UUID segment equals `p_booking_id` (so a customer can't submit someone else's slip URL, or an arbitrary external link, as "proof").
4. **Basic input validation in `create_booking_hold`.** Reject empty/blank `p_customer_name` or `p_customer_phone`. Reject `p_booking_date < CURRENT_DATE`.
5. **Commit immediately** once these migrations are applied and verified — do not leave uncommitted local changes sitting around (a Codex audit session with shell write access silently reverted an earlier uncommitted fix mid-session; don't repeat that).

**DoD (all must hold, verified via REST with the anon key, not just `execute_sql`):**
- [ ] `pg_constraint` shows `prevent_overlapping_staff_bookings` exists with a valid (non-NOW()) predicate.
- [ ] Two concurrent `create_booking_hold` calls for the same staff+overlapping time cannot both succeed (one must fail at the DB level, not just the app-level pre-check).
- [ ] `POST /rest/v1/rpc/reject_deposit_slip` and `.../extend_booking_hold` with the anon key return an authorization error (403/401-equivalent), not 200.
- [ ] `submit_deposit_slip` rejects a slip URL that doesn't belong to the target booking.
- [ ] `create_booking_hold` rejects empty name/phone and past dates.
- [ ] New migration file(s) exist under `supabase/migrations/`, applied live, and **committed to git**.

---

## Phase B — LINE webhook: historical instructions superseded

**2026-09-27 update:** Do not restore a privileged client or credential in BK01. The current implementation uses the House-issued short-lived `bk01_runtime` JWT and narrow RPC allowlist. Trial LINE binding remains blocked until a follow-up RPC accepts booking code without a trusted shop UUID; merchant routes use the frozen WU-B RPC. Follow the current WU-C brief and report as authority.

The original Phase B task list and gates have been retired. Do not execute or hand off those instructions.

---

## Phase C — Frontend correctness fixes

**Why third:** these depend on Phase A's RPC responses being final and stable.

**Tasks:**
1. **No-deposit flow (finding #15).** In `apps/booking-consumer/src/app/book/[slug]/page.tsx`, after `createBookingHold` returns, branch on `holdResult.status`: if `"confirmed"` (no-deposit path), skip step 3 (QR/slip upload) entirely and go straight to the success/confirmation view; only go to step 3 when `status === "hold"`.
2. **Schedule fail-open decision (finding #17).** Currently a staff member with no `staff_schedules` row for a given day is treated as available (fail-open). This is a product decision, not a pure bug — confirm with the project owner whether "no schedule row = available" or "no schedule row = unavailable" is the intended behavior for shops that haven't finished onboarding a staff member's schedule, then make the RPC and the frontend's `availableTimeSlots` logic consistent with that decision (they must agree — right now both fail-open the same way, so they're at least *consistent*, just possibly wrong).

**DoD:**
- [ ] Booking a no-deposit service (e.g. โกนหนวด) end-to-end in the actual browser goes straight from step 2 to a success screen — no QR code, no forced slip upload, no `submit_deposit_slip` call attempted.
- [ ] Schedule fail-open behavior is a documented, deliberate choice (written down in `PRODUCT_RULES_V1.md` or equivalent), not an accidental gap.
- [ ] `npm run build` passes with 0 TypeScript errors in `booking-consumer` after these changes.

---

## Phase D — Documentation for the non-automatable config step

**Why fourth:** quick, low-risk, but important — without this, a fresh deploy of this repo to a new Supabase project silently breaks (406 PGRST106) with no clue why, exactly as happened this session.

**Tasks:**
1. Add a clearly-flagged manual step to `README.md` and `PROJECT_HANDOVER_BRIEF.md`: after running all migrations on a new/fresh Supabase project, go to Dashboard → Project Settings → API → **Exposed schemas** and add `local_service`. Note explicitly that this cannot be done via SQL, the Management API (as far as currently known), or any Supabase MCP tool — it is Dashboard-UI-only.

**DoD:**
- [ ] Both docs updated and committed.

---

## Phase E — Wire the admin dashboard to the real backend (separate, larger effort)

**Why last:** this is not a bug fix — it's unfinished product surface. `apps/booking-admin/src/lib/admin-service.ts` already exists with the right functions (`fetchShopBookings`, `approveBookingDeposit`, `rejectBookingDeposit`, `cancelBooking`, `registerNewShop`) but is imported nowhere; the dashboard still renders a hardcoded `INITIAL_BOOKINGS` mock array. This phase needs its own scoping conversation before implementation starts — it's not something to squeeze into this brief's DoD-per-task format, because it depends on a decision this brief doesn't make: **how shop owners authenticate.**

**Before implementation can start, decide:**
- Supabase Auth (email/password or magic link) for shop owners, tied to `local_service.shop_users` (the table already exists with an `auth.users` FK, but currently has zero RLS policies — Codex flagged this as `rls_enabled_no_policy`, INFO-level, in an earlier advisor check).
- Whether `/register` (currently a simulated-success mock) creates both a `shops` row and the first `shop_users` row + a real Supabase Auth account in one flow, or if these are separate steps.

**Not started until Phase A-D are done and this auth decision is made explicitly with the project owner.**

---

## Sequencing rule
Do not start Phase N+1 until Phase N's DoD is fully checked off **and verified against the live REST API with the anon key** (not just `execute_sql`, which bypasses RLS/PostgREST and has already produced false confidence once this session). Commit after each phase.
