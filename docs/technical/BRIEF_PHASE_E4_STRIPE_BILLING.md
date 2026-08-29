> [!NOTE]
> **BK-0 AUTHORITY NOTICE (2026-08-28):** Historical/implementation evidence only. Current product and production contract is governed by docs/DOCUMENTATION_INDEX.md and the numbered BK-0 SSOT. Preserve this file for evidence; do not treat older architecture, pricing, deployment or completion wording as current authority.

# Brief: Phase E4 — Stripe Billing (Checkout + Webhook + Portal)

Source: consolidated from [`STRIPE_SUBSCRIPTION_STATE_MACHINE.md`](STRIPE_SUBSCRIPTION_STATE_MACHINE.md) (state machine, webhook payloads, sync strategy already designed there — this brief sequences the *build* work only) + [`PROJECT_HANDOVER_BRIEF.md`](../../PROJECT_HANDOVER_BRIEF.md) status as of 2026-08-10.

Same sequencing rule as Phase A-E: do not start E4.N+1 until E4.N's DoD is checked off and verified against the live Supabase project (`gyleqrjdzwwlqierdwcy`) + live Stripe test mode — not just `execute_sql`/reading code. Commit after each sub-phase.

**Single Payment Provider Rule (CLAUDE.md):** Stripe is the sole provider for subscriptions. No parallel billing path.

---

## E4.1 — Subscriptions table schema ✅ DONE

Commit `53f3be9`. `local_service.subscriptions` table live, owner-only RLS SELECT, no writer grants to `anon`/`authenticated` (only `service_role` will write, via the webhook handler built in E4.4).

Also done: `stripe` SDK added to `booking-admin` (commit `72ea9af`), plus `scripts/sync-env.js` to stop the `.env.local` hardlink from silently drifting.

---

## E4.2 — Stripe product/price setup (manual, Dashboard-only)

**Why this can't be automated:** same category as "Exposed schemas" and "Auth Redirect URLs" in `PROJECT_HANDOVER_BRIEF.md` §6 — no MCP tool or SQL creates live Stripe Products/Prices; this is done once by the project owner in Stripe Dashboard (test mode first).

**Tasks:**
1. Create 2 Products in Stripe Dashboard: `Basic` (฿490/mo), `Pro` (฿990/mo), recurring monthly, THB.
2. Record the resulting `price_id`s (`price_xxx`) somewhere the app can read — env vars (`STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`) is simplest, matches existing single-source `.env.local` pattern.
3. Confirm `STRIPE_SECRET_KEY` (test mode) and `STRIPE_WEBHOOK_SECRET` (from E4.4's endpoint registration, chicken-and-egg — CLI `stripe listen` gives a local one first) are in `.env.local`.

**DoD:**
- [ ] Two live test-mode Prices exist in Stripe, IDs recorded in `.env.local`.
- [ ] `STRIPE_SECRET_KEY` present in `.env.local`, confirmed never referenced under `apps/*/src/app/**/page.tsx` (server-only, same rule as `SUPABASE_SERVICE_ROLE_KEY` in Phase B).

---

## E4.3 — Idempotency table migration

**Tasks:**
1. Apply the `local_service.stripe_webhook_events` table exactly as specced in `STRIPE_SUBSCRIPTION_STATE_MACHINE.md` §4.3.1 (id = Stripe event id PK, type, created_at, processed_at).
2. No grants to `anon`/`authenticated` — `service_role` only (webhook handler runs server-side with service_role, same pattern as the LINE webhook's admin client from Phase B).

**DoD:**
- [ ] Migration file under `supabase/migrations/`, applied live, confirmed via `pg_tables`/REST that `anon` gets 401 on any access.
- [ ] Committed to git.

---

## E4.4 — Webhook handler (`/api/webhooks/stripe`)

**Why before Checkout route:** Checkout Session creation (E4.5) is low-risk to build first technically, but nothing is verifiable end-to-end without the webhook — sequence it first so E4.5 can be tested against a real completed session immediately.

**Tasks:**
1. New route in `apps/booking-admin/src/app/api/webhooks/stripe/route.ts`. Read raw body (no JSON parsing before signature check) — same discipline as the LINE webhook's `crypto.timingSafeEqual` precedent (Phase B).
2. Verify signature: `stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)`. Reject (400) on failure before touching the DB.
3. Idempotency guard first: `INSERT INTO stripe_webhook_events (id, type, created_at) ... ON CONFLICT (id) DO NOTHING RETURNING id`. No row → return 200 `{duplicate:true}` immediately.
4. Out-of-order guard: skip DB state update if `event.created` < `subscriptions.updated_at` for the target row (design doc §4.3.2 step 4).
5. Implement the 5 handlers per `STRIPE_SUBSCRIPTION_STATE_MACHINE.md` §2.2 exactly (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`) — each a single transaction that writes `subscriptions` AND syncs `shops.subscription_status` per the mapping matrix (§3.3/§3.4), not two separate writes that can drift.
6. Use the `booking-admin` server-only Supabase admin client (service_role) — create one if it doesn't already exist, following the exact pattern of `apps/booking-consumer/src/lib/supabase-admin.ts` from Phase B (never imported client-side).

**DoD (verified with `stripe trigger` / Stripe CLI against the running dev server, not just reading code):**
- [ ] Unsigned/tampered request body → 400, no DB write.
- [ ] Duplicate `event.id` sent twice → second call returns `{duplicate:true}`, no double-write (confirm via row count, not assumption).
- [ ] Each of the 5 events, fired via `stripe trigger <event>` or a real test-mode checkout, produces the exact `subscriptions.status` + `shops.subscription_status` pair from the design doc's mapping matrix — checked via REST read, not `execute_sql`.
- [ ] Route still returns 200 to Stripe even when the internal DB write fails (log the failure, don't let Stripe retry-storm on a bug — mirrors the LINE webhook's "always 200, log real errors" fix from Phase B), except for signature-verification failures which stay 400.

---

## E4.5 — Checkout Session route + wire-up

**Tasks:**
1. New route (e.g. `apps/booking-admin/src/app/api/billing/checkout/route.ts`): authenticated owner only, creates a Stripe Checkout Session for the selected plan, sets `client_reference_id`/`metadata.shop_id`, `success_url`/`cancel_url` back to the dashboard billing tab.
2. Wire the "อัปเกรด" button in dashboard billing tab (currently a static link to `/register`, per `PROJECT_HANDOVER_BRIEF.md` §3.2 item 6) to call this route and redirect to the returned Checkout URL.
3. Decide (confirm with project owner before building): does `/register`'s existing plan-selection step (§3.3, 4-step wizard) also go through real Checkout now, or does E4 only wire the *dashboard* upgrade path first and leave `/register` as trial-only for this checkpoint? Flag, don't assume.

**DoD:**
- [ ] Owner-only: a non-owner (`admin`/`staff`) authenticated call to the checkout route returns 403.
- [ ] Real test-mode checkout completed in browser end-to-end → `checkout.session.completed` webhook fires (E4.4) → `subscriptions` row appears with correct `shop_id`, `plan`, `status`.

---

## E4.6 — Customer Portal route + wire-up ✅ DONE

New route `apps/booking-admin/src/app/api/billing/portal/route.ts` (owner-only, same auth/membership pattern as E4.5's checkout route), creates a `stripe.billingPortal.sessions.create` session for the shop's `stripe_customer_id`, returns to `/dashboard?tab=billing`. Dashboard billing tab now has a real "จัดการการชำระเงิน / ประวัติใบแจ้งหนี้" button (`handleManageBilling` in `dashboard/page.tsx`, `startBillingPortal()` in `admin-service.ts`) wired to it — no mock left.

**Bug found + fixed during live verification (2026-08-11), unrelated to E4.6 itself but caught while testing it:** the E4.4 webhook handler's two Stripe-payload readers were wrong for API version `2026-07-29.dahlia` (confirmed by inspecting the raw event JSON via `stripe events retrieve`):
- `current_period_end` does not exist on the top-level `Subscription` object in this API version — it only exists per subscription item (`sub.items.data[0].current_period_end`). The old code's raw-cast fallback silently read `undefined` and every subscription's `current_period_end` landed `NULL` in the DB from E4.4 onward, including right after a successful checkout.
- Scheduling a cancellation via the Billing Portal does **not** set `cancel_at_period_end: true` in this API version — it leaves that boolean `false` and instead sets `cancel_at` (a unix timestamp equal to the period end). The old code read only `cancel_at_period_end`, so a canceled-at-period-end subscription silently stayed indistinguishable from an active one in the DB.

Fixed in `apps/booking-admin/src/app/api/webhooks/stripe/route.ts`: `getSubscriptionPeriodEnd()` now reads `sub.items.data[0]?.current_period_end`; new `isCancelScheduled()` treats either `cancel_at_period_end` or a non-null `cancel_at` as "scheduled to cancel". Re-verified live: forced a fresh `customer.subscription.updated` event (`stripe subscriptions update ... --metadata`) after the fix and confirmed `subscriptions.cancel_at_period_end=true` + `current_period_end=2026-09-11` now match the Portal's own "Cancels Sep 11" display exactly.

**DoD:**
- [x] Owner-only enforcement: unauthenticated call → 401 (curl-verified). Non-owner → 403 uses the identical `membership.role !== 'owner'` check already live-verified for E4.5's checkout route — same code path, not re-tested standalone.
- [x] Real Portal session opened in browser (`billing.stripe.com`, test-mode sandbox) for a throwaway shop (`e4portal-test-shop`) with an active test subscription (completed a real Checkout with card `4242...` first). Canceled there → Portal showed "Cancels Sep 11" → `customer.subscription.updated` webhook fired (200) → `subscriptions.cancel_at_period_end` confirmed `true` via direct DB read (dashboard billing tab itself is still the E4.7 mock, so "reflected on next dashboard load" is verified at the data layer, not yet the UI — that's E4.7's job).

---

## E4.7 — Dashboard billing tab: replace mock with real data

**Tasks:**
1. Remove the mock billing tab content in `apps/booking-admin/src/app/dashboard/page.tsx` (§3.2 item 6 of `PROJECT_HANDOVER_BRIEF.md`).
2. Load real `subscriptions` row for the shop (owner-only, matches RLS from E4.1).
3. Render per the Business Rules Matrix (`STRIPE_SUBSCRIPTION_STATE_MACHINE.md` §4.1): plan name, status, `current_period_end`, `cancel_at_period_end` banner ("จะสิ้นสุดวันที่..."), `past_due` urgent warning banner (7-day grace period language).

**DoD:**
- [ ] Billing tab shows live values for `trialing`, `active`, and `past_due` states (force each via `stripe trigger` in test mode), not hardcoded strings.
- [ ] `npm run build` passes with 0 TypeScript errors in `booking-admin`.

---

## E4.8 — Booking-acceptance gate enforcement

**Tasks:**
1. Enforce the Booking Acceptance Rules Matrix (design doc §4.1) at the RPC layer: `create_booking_hold` must reject new bookings when the shop's `subscription_status` is `canceled`/`unpaid`/`inactive` (mapped legacy values from §3.3).
2. Frontend (`apps/booking-consumer/src/app/book/[slug]/page.tsx`): show the "ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้" message instead of the booking form when blocked, per §4.1.
3. `past_due` stays fully bookable (7-day grace) — do not block it, this is a deliberate business rule, not an oversight.

**DoD:**
- [ ] A shop forced into `canceled`/`unpaid` via `stripe trigger` cannot create a booking hold via REST with the anon key (checked directly, not just UI).
- [ ] Same shop's public booking page shows the blocked-state message in a real browser.
- [ ] A `past_due` shop still completes a full booking end-to-end (grace period not accidentally blocking).

---

## E4.9 — Manual config docs

**Tasks:**
1. Add `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` to the `.env.local` setup instructions in `README.md`.
2. Document registering the production webhook endpoint in Stripe Dashboard → Developers → Webhooks (same "Dashboard-UI-only, can't be done via SQL/MCP" callout style as Exposed Schemas / Auth Redirect URLs in `PROJECT_HANDOVER_BRIEF.md` §6) once a real domain exists.
3. Update `PROJECT_HANDOVER_BRIEF.md` §5 roadmap line for E4 from ⬜ to ✅ with a completion report following the `PHASE_E3_3_COMPLETION_REPORT_2026-08-08.md` format (what changed, live verification performed, what's still out of scope).

**DoD:**
- [ ] Both docs updated and committed.
- [ ] Completion report written.

---

## Explicitly out of scope for E4

- Annual billing / other currencies.
- Proration UI beyond what Stripe Portal provides natively.
- Per-shop custom LINE OA Channel Token (already deliberately not built — Phase E3.3 note, unrelated to billing but mentioned here so it isn't confused with an E4 dependency).
- Migrating `shops.subscription_status` reads elsewhere in the app to query `subscriptions` directly — design doc §3.2.3 marks this a future deprecation, not part of E4.
