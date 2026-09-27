# Handoff: E4.3 + E4.4 — Stripe Webhook Idempotency Table & Handler

**Date:** 2026-08-10
**Author:** Qwen Code agent
**Scope:** Checkpoints E4.3 and E4.4 from `docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md`

---

## Files Created

| File | Purpose |
| :--- | :--- |
| `supabase/migrations/20260810000000_phase_e4_3_stripe_webhook_events.sql` | Idempotency log table `local_service.stripe_webhook_events` per design doc §4.3.1. |
| `supabase/migrations/20260810000100_phase_e4_4_sync_subscription_state_rpc.sql` | SECURITY DEFINER RPC function `sync_subscription_state` for atomic subscription + shop status writes. |
| `apps/booking-admin/src/lib/bk01-runtime.ts` | Current server-only House runtime JWT adapter; it supersedes the historical privileged-client implementation. |
| `apps/booking-admin/src/app/api/webhooks/stripe/route.ts` | Next.js App Router POST handler — Stripe webhook endpoint. |
| `docs/technical/QWEN_E4_3_E4_4_HANDOFF.md` | This file. |

No existing files were edited.

---

## Webhook Route Control Flow

```
POST /api/webhooks/stripe
  │
  1. Read raw body via req.text() (before any JSON parsing)
  │
  2. Verify Stripe signature:
     stripe.webhooks.constructEvent(rawBody, stripe-signature, STRIPE_WEBHOOK_SECRET)
     → Failure: return 400, do NOT touch the DB
     → Missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET: return 500
  │
  3. Idempotency guard:
     upsert into stripe_webhook_events with { onConflict: 'id', ignoreDuplicates: true }
     → No row returned (duplicate event): return 200 { received: true, duplicate: true }
     → Row returned (new event): proceed
  │
  4. Dispatch by event.type:
     ├─ checkout.session.completed
     │    Extract: shop_id from client_reference_id/metadata, customer, subscription
     │    Fetch full subscription object for status + current_period_end
     │    → RPC sync_subscription_state (UPSERT path)
     │
     ├─ customer.subscription.updated
     │    Extract: sub.id, items.data[0].price.id → plan, status, period_end, cancel_at_period_end
     │    → RPC sync_subscription_state (UPDATE path)
     │
     ├─ customer.subscription.deleted
     │    Extract: sub.id
     │    → RPC sync_subscription_state (canceled path)
     │
     ├─ invoice.paid
     │    Extract: subscription ID from invoice.parent.subscription_details
     │    Use invoice.period_end as current_period_end
     │    → RPC sync_subscription_state (active path)
     │
     └─ invoice.payment_failed
          Extract: subscription ID from invoice.parent.subscription_details
          → RPC sync_subscription_state (past_due path)
  │
  5. Return 200 { received: true }
  │
  Error handling:
     Any DB/processing error after signature verification → log server-side, return 200
     (prevents Stripe retry-storm; mirrors LINE webhook "always ack" pattern from Phase B)
     Only signature verification failure returns non-200 (400)
```

---

## RPC Function `sync_subscription_state`

The atomic write pattern from design doc §3.4 is implemented as a single PL/pgSQL SECURITY DEFINER function rather than two sequential awaited SQL calls from the Next.js route.

**Why this approach (design decision):**

The brief left this implementation choice open. The two options were:

1. **Raw multi-statement SQL via a direct Postgres client** — would require adding a `pg` or `postgres` npm dependency and a separate connection pool, which the codebase doesn't currently use. All existing DB access goes through the Supabase JS client (`@supabase/supabase-js`).

2. **Single `supabase.rpc()` call to a new Postgres function** — matches the established pattern in `apps/booking-admin/src/lib/admin-service.ts` where every multi-step DB operation uses `supabase.rpc()`. No new dependencies. The function runs in a single implicit transaction, guaranteeing the two UPDATEs (subscriptions + shops) commit atomically or roll back together.

**Decision:** Option 2 (RPC function). It fits the codebase's existing architecture, requires no new dependencies, and gives true transactional atomicity.

The RPC function also implements the out-of-order timestamp guard (design doc §4.3.2 step 4) internally: if `event.created < subscriptions.updated_at`, the state update is skipped but the function returns successfully so the webhook handler can ack 200 to Stripe.

---

## Build Verification

```
npm --workspace apps/booking-admin run build
```

Result: **0 TypeScript errors, build successful.**

```
▲ Next.js 16.3.0 (Turbopack)
✓ Compiled successfully in 671ms
✓ Finished TypeScript in 1733ms
✓ Collecting page data using 13 workers
✓ Generating static pages (12/12)
✓ Finalizing page optimization

Route (app)
├ ƒ /api/webhooks/stripe      ← new route
```

---

## Stripe SDK v22 Type Notes

The installed `stripe` package (v22.x) has different type definitions from older versions:

- **`Subscription.current_period_end`** is NOT declared in the SDK types (replaced by `billing_cycle_anchor` in the typed interface). The Stripe API still returns `current_period_end` in the JSON response. The route accesses it via a type assertion: `SubscriptionWithPeriodEnd = Stripe.Subscription & { current_period_end?: number | null }`.
- **`Invoice.subscription`** is NOT a top-level property in v22. The subscription ID is nested under `invoice.parent.subscription_details.subscription` (type: `string | Subscription`).
- **`Invoice.period_end`** IS available as a top-level property and is used as the source for `current_period_end` in the `invoice.paid` handler (more reliable than fetching the subscription separately).

---

## What's NOT Done Yet

| Item | Checkpoint | Notes |
| :--- | :--- | :--- |
| **Migrations not applied to live Supabase** | E4.3, E4.4 | The two `.sql` files are written but NOT executed against the live database. Run `supabase db push` or apply via Supabase MCP/CLI when ready. |
| **`STRIPE_WEBHOOK_SECRET` unset in `.env.local`** | E4.2 | The webhook endpoint is registered in Stripe Dashboard → Developers → Webhooks. For local dev, `stripe listen --forward-to localhost:3001/api/webhooks/stripe` provides a `whsec_...` secret. Production secret comes from the Dashboard endpoint registration. |
| **`STRIPE_SECRET_KEY` unset in `.env.local`** | E4.2 | Test-mode secret key from Stripe Dashboard. The route returns 500 if this is missing. |
| **`STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` unset** | E4.2 | Price IDs from Stripe Dashboard. The `mapPriceIdToPlan` function has a fallback heuristic until these are set. |
| **No live Stripe CLI verification** | E4.4 DoD | The route is built and type-checks, but end-to-end verification with `stripe trigger` against a running dev server has not been performed. |
| **Checkout Session route** | E4.5 | Not built — the webhook handler processes `checkout.session.completed` events but nothing creates them yet. |
| **Customer Portal route** | E4.6 | Not built. |
| **Dashboard billing tab** | E4.7 | Still shows mock data. |
| **Booking-acceptance gate** | E4.8 | `create_booking_hold` not modified. |
| **Manual config docs** | E4.9 | README and PROJECT_HANDOVER_BRIEF not updated. |
| **Git commit** | — | All changes are left uncommitted for the project owner to review. |

---

## Status Mapping Matrix Verification

The RPC function's CASE statement was diffed against design doc §3.3. Exact match:

| Granular `subscriptions.status` | Legacy `shops.subscription_status` | RPC CASE |
| :--- | :--- | :--- |
| `trialing` | `'trial'` | ✅ `WHEN 'trialing' THEN v_legacy_status := 'trial'` |
| `active` | `'active'` | ✅ `WHEN 'active' THEN v_legacy_status := 'active'` |
| `past_due` | `'past_due'` | ✅ `WHEN 'past_due' THEN v_legacy_status := 'past_due'` |
| `canceled` | `'canceled'` | ✅ `WHEN 'canceled' THEN v_legacy_status := 'canceled'` |
| `incomplete` | `'inactive'` | ✅ `WHEN 'incomplete' THEN v_legacy_status := 'inactive'` |
| `incomplete_expired` | `'canceled'` | ✅ `WHEN 'incomplete_expired' THEN v_legacy_status := 'canceled'` |
| `unpaid` | `'canceled'` | ✅ `WHEN 'unpaid' THEN v_legacy_status := 'canceled'` |

For `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`, the RPC function hardcodes the legacy status (`canceled`, `active`, `past_due` respectively) after setting the granular status, matching the design doc's event handler specs exactly.
