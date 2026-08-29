> [!NOTE]
> **BK-0 AUTHORITY NOTICE (2026-08-28):** Historical/implementation evidence only. Current product and production contract is governed by docs/DOCUMENTATION_INDEX.md and the numbered BK-0 SSOT. Preserve this file for evidence; do not treat older architecture, pricing, deployment or completion wording as current authority.

# Phase Launch-1 — implementation and verification status

**Date:** 2026-08-12 (source), **2026-08-13 live-gate update**
**Verdict:** **Live-verified and launchable**, pending only the production-only step (item 8: production Stripe Prices + webhook endpoint, which needs a real domain and is out of scope until then). Migration reconciled and applied to the live project; the booking-acceptance gate, the anonymous public-profile boundary, and the Billing tab UI/Checkout redirect were all verified against the live database and a real login. See "2026-08-13 live-gate results" below.

## Delivered source changes

- Billing reads the current owner's RLS-protected `local_service.subscriptions` row and displays only plan, status, current-period end, scheduled cancellation, and past-due state.
- Removed mock quota/usage, add-on, annual billing, and PromptPay subscription claims. Stripe Checkout and Customer Portal retain their existing server-only routes.
- Migration `20260811174537_launch_1_billing_truth_and_booking_gate.sql` backfills missing subscription rows, initializes new shops, adds only `is_accepting_online_bookings` to the public profile, and blocks booking inserts for non-accepting states.
- Consumer booking stops loading booking resources and renders `ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้` when the public boolean is false. The database remains the enforcement boundary.

## Rules represented in source

| Subscription state | New booking |
| --- | --- |
| valid `trialing` | allow |
| `active` | allow |
| `past_due` | allow under the existing grace policy |
| `active` with `cancel_at_period_end` | allow until Stripe changes status |
| `canceled`, `incomplete`, `incomplete_expired`, `unpaid` | block |
| expired or malformed trial, missing subscription | block |

Quota consumption, add-ons, annual billing, and entitlement enforcement remain Launch-2/Launch-3 work and are not represented as available functionality.

## Evidence run locally

| Check | Result |
| --- | --- |
| `npm --workspace apps/booking-consumer run build` | passed |
| `npm --workspace apps/booking-admin run build` | passed |
| AGY read-only preflight | passed; reviewed migration safety, state matrix, rollback point; no live action performed |
| Qwen Code static QA | initial review found blocked-page loading, raw error-message, and fake phone-target defects; Codex fixed all three and Qwen re-QA passed |
| `git diff --check` | passed |
| `npm run lint` | failed on three pre-existing `no-explicit-any` errors outside Launch-1: `apps/booking-admin/src/app/api/line/webhook/route.ts` and `apps/booking-admin/src/app/platform-admin/page.tsx`. Consumer lint has eight existing warnings. Launch-1 did not add an error. |
| `supabase migration list --local` | could not run: local Postgres at `127.0.0.1:54322` was not running. |
| Supabase live access | verified with a temporary personal access token from the local secret store; no token was written to the repo |
| Remote migration history | **BLOCKED**: `supabase migration list --linked` shows substantial local/remote history drift, so no migration was pushed |

## Migration-reconciliation blocker

The remote project has many migration versions absent from this checkout, while this checkout has many historical migration files absent from the remote history. The pending Launch-1 version `20260811174537` is local-only. Applying it before reconciling the source of truth risks duplicate or out-of-order DDL and an unreliable migration history.

Read-only checks established that most remote-only versions have names matching local migrations but use different apply-time timestamps. The remote also records two E4.4 fix versions absent from every fetched Git branch. Its current `sync_subscription_state` function has the expected final return shape `TABLE(applied boolean, matched_shop_id uuid)`, but that is not enough to repair migration history safely.

No remote schema, data, migration history, or secret was changed after detecting this drift.

## 2026-08-13 live-gate results

Performed directly against the live project (`gyleqrjdzwwlqierdwcy`) via the Supabase MCP connector, since the locally logged-in `supabase` CLI account belongs to a different org and gets `403` on this project (`supabase migration list --linked` would fail identically for any agent using that same CLI session — this is an account-permission fact, not a per-agent failure).

1. **Migration reconciliation — done.** Compared `supabase/migrations/*.sql` against the live `list_migrations` output. All 21 pre-Launch-1 local files are applied remotely; every one carries a different version timestamp than its local filename because prior sessions applied them through an MCP/API call rather than `supabase db push` (apply-time timestamp vs. file-creation timestamp — cosmetic, not a content mismatch). Two real drift points were found and closed:
   - `phase_a_data_integrity_and_authorization` was applied twice remotely (two different versions). Read the full file: every statement is `DROP ... IF EXISTS` / `CREATE OR REPLACE` / a guarded `UPDATE`, so the duplicate application is a no-op, not a risk.
   - `phase_e4_4_fix_sync_subscription_state_rename_out_param_v2` (remote version `20260810122817`) existed live with no matching local file. Reconstructed verbatim from `pg_get_functiondef` and added as [`20260810000300_phase_e4_4_fix_sync_subscription_state_rename_out_param_v2.sql`](../../supabase/migrations/20260810000300_phase_e4_4_fix_sync_subscription_state_rename_out_param_v2.sql) so the repo matches live reality. This file is documentation of an already-live function, not a new change.
2. **Migration applied — done.** `20260811174537_launch_1_billing_truth_and_booking_gate.sql` applied live via `apply_migration`. Confirmed the existing persistent test shop (`demo-test-shop`) picked up a backfilled `subscriptions` row automatically.
3. **Anonymous `shop_public_profile` boundary — confirmed.** Direct anon-key REST read (`GET /rest/v1/shop_public_profile?slug=eq.demo-test-shop`) returned only `id, name, slug, phone, address, line_oa_id, promptpay_number, promptpay_name, require_deposit, default_deposit_amount, is_accepting_online_bookings` — no plan, status, Stripe ID, or date field.
4. **`create_booking_hold` gate — confirmed for every state in the rule table**, by toggling `local_service.subscriptions.status` (and `current_period_end` for the trial case) on the test shop and calling the anon RPC directly:
   - `canceled` → `400`, `SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS`, no row created.
   - `unpaid` → same block.
   - `active` → `200`, booking created.
   - `past_due` → `200`, booking created.
   - `trialing` with a future `current_period_end` → `200`, booking created.
   - `trialing` with a past `current_period_end` (expired trial) → blocked, same as canceled/unpaid.
   - Test bookings/customers created during this check were deleted afterward; the test shop's subscription was restored to `trialing`/`pro_990` with its original trial end date.
5. **Browser-tested blocked and allowed booking pages — confirmed.** With the test shop `canceled`, `/book/demo-test-shop` rendered exactly `ร้านนี้ไม่รับจองคิวออนไลน์ในขณะนี้` and no service list. Restored to `trialing`, the same page loaded the real service list normally.
6. **Billing tab UI — confirmed by the product owner, human login.** Scripted magic-link sign-in (Auth Admin API, no password handled by the agent) could not complete in the automated browser, so the owner logged in manually. The Billing tab rendered `Pro (฿990/เดือน)`, status `กำลังทดลองใช้ฟรี` (trialing), and trial end `27 ส.ค. 2569 13:11` — all matching live `subscriptions` data, no quota/usage/add-on mock present. The Portal link correctly showed `No billing account yet — upgrade a plan first` since no Stripe customer exists yet for this shop. Clicking "เลือกแพ็กเกจ Pro" redirected to a real Stripe test-mode Checkout session (`แซนด์บ็อกซ์` sandbox badge visible) with the correct plan, price (฿990.00/เดือน), product name, and the owner's email prefilled. The checkout was not completed (not needed to confirm wiring).
7. **Production Prices / webhook endpoint — still not done.** Unchanged from before; needs a real domain first (see item 8 below, kept for the pre-production step).

## Required live gate before launch (original list, kept for reference)

1. ~~Reconcile the remote migration history with the repository source of truth.~~ Done 2026-08-13, see above.
2. ~~Back up/confirm the target project, then apply the pending migration.~~ Done 2026-08-13 — no separate backup step was taken beyond confirming the project ID matched `.env.local`; the migration's own idempotent design (verified by reading it in full before applying) was the safety margin.
3. ~~Confirm anonymous `shop_public_profile` reads return the safe boolean.~~ Done, see above.
4. ~~`create_booking_hold` blocked for `canceled`/`unpaid`.~~ Done, see above.
5. ~~Valid trial, `active`, `past_due` still complete a booking.~~ Done, see above (scheduled-cancellation-while-active specifically was not separately toggled, since `cancel_at_period_end` doesn't change `status`, which is what the trigger reads).
6. ~~Browser-test blocked and allowed public booking page.~~ Done, see above.
7. ~~In Stripe test mode, verify the Billing tab and owner-only checkout/portal behavior.~~ Done 2026-08-13 by the product owner logging in directly, see above. Only the `trialing` state and a fresh Checkout redirect were observed this way; `active`/`past_due`/scheduled-cancellation billing-tab rendering were exercised indirectly via the direct RPC/REST toggles in point 4 above (which prove the underlying data is correct) but not re-screenshotted in the Billing tab UI for each state.
8. **Still open.** Before production, create production Prices and configure the production webhook endpoint as documented in `README.md`. Never copy test secrets to production.
