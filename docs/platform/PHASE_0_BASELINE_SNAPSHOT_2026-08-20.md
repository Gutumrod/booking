> [!NOTE]
> **BK-0 AUTHORITY NOTICE (2026-08-28):** Historical/implementation evidence only. Current product and production contract is governed by docs/DOCUMENTATION_INDEX.md and the numbered BK-0 SSOT. Preserve this file for evidence; do not treat older architecture, pricing, deployment or completion wording as current authority.

# Phase 0 Baseline Snapshot — `local_service` on Project B (2026-08-20)

Recorded per `docs/platform/SHARED_SAAS_RUNTIME_PROJECT_B_PLAN.md` Phase 0 exit evidence
requirements. All values pulled live from the deployed project via the Supabase Management
API and a live anon REST probe — not from local files or self-reports.

## Project

- Name: "Shared SaaS Runtime", ref `gyleqrjdzwwlqierdwcy`, org `abucebchexnxhrdkxgsn`
- Region: `ap-southeast-1`, Postgres `17.6.1.147`, status `ACTIVE_HEALTHY`
- Created: 2026-07-20

## Migration history reconciliation

`supabase migration list --linked` run 2026-08-20: **26/28 local migrations match remote
exactly** (timestamps identical, no divergence, no repair needed). 2 are local-only, not yet
applied:

- `20260818000000_local_service_tickets.sql`
- `20260819000000_quota_staff_topup_enforcement.sql` (QA PASS=6/FAIL=0 against local dev DB
  `booking_qa2`, per `docs/platform/ROADMAP.md` §0 gate 3 — not yet verified in production)

No conflicting/diverged history found. `git status` on `products/booking` is clean (no
uncommitted platform-admin migration/UI work outstanding — that concern from the plan's
Phase 0 scope is already resolved).

## Data API exposed schemas

`db_schema: public,graphql_public,local_service` (confirmed via Management API postgrest
config). `local_service` is the only product schema exposed — matches expectation, no other
product schema accidentally exposed.

## E3.3 live RLS verification — PASSED

Live-tested against the real deployed database with the anon publishable key (same method
used to originally catch this bug):

1. `GET /rest/v1/shop_public_profile` (Accept-Profile: local_service) → `200`, returns only
   the intended column set (id, name, slug, phone, address, line_oa_id, promptpay_number,
   promptpay_name, require_deposit, default_deposit_amount, is_accepting_online_bookings).
2. `GET /rest/v1/shops` direct table access → `401 permission denied for table shops` (anon
   SELECT correctly revoked).
3. `GET /rest/v1/shop_public_profile?select=subscription_status,trial_ends_at,owner_name` →
   `400 column does not exist` — sensitive columns are structurally absent from the view, not
   just unused by the current app.

## Storage buckets

- `deposit-slips` — public, 5 MB file size limit, `image/jpeg|png|webp` only. Created
  2026-08-07. Single bucket, no others provisioned.

## Edge Functions

None deployed (`[]`).

## Secrets inventory (names only, no values recorded here)

Per `.env.local` var names already tracked in `D:\AI-Workspace\.secrets\keys.txt`
(`SUPABASE_PUBLISHABLE_KEY_BOOKING2`, `SUPABASE_SECRET_KEY_BOOKING2`, plus Stripe/LINE keys
local to the app, not project-level secrets). Legacy JWT-based anon/service_role keys
disabled 2026-08-20 (see `agy-governance-verify-not-trust` / credential-rotation session
notes) — confirmed dead via live test, not just claimed.

## Quota / usage

Not pulled this pass — Management API billing/usage endpoints need a different path than
tried today. Flag as a follow-up if usage thresholds matter before Phase 3 admits a second
product schema.

## Exit evidence checklist (plan's own criteria)

- [x] Reviewed baseline commit — this file
- [x] Migration list agrees with the approved source of truth — 26/28 synced, 2 known-pending
- [x] Live REST/browser negative tests pass — E3.3 tests above, all 3 passed
- [x] No unreviewed product schema work — `git status` clean, only `local_service` exposed
- [x] The 2 pending migrations applied to remote — pushed 2026-08-20 via `supabase db push
      --linked`, owner confirmed beforehand. `supabase migration list --linked` re-run after:
      **28/28 local matches remote exactly.** No errors; NOTICEs were routine idempotent
      `DROP ... IF EXISTS` skips, not failures.

**Phase 0: CLOSED.** All 5 exit-evidence items satisfied. Project B is now clear to admit its
second product schema per the admission order in `docs/platform/ROADMAP.md` (`line_oa_ai` →
`headless_commerce` → `pawspace`), subject to each product's own admission review.
