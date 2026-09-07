# BK-SR-03 — Staging + External-System Rehearsal Evidence

**Date:** 2026-09-06
**Branch:** `feature/bk-a-v1-contract-remediation`
**Baseline checkpoint:** `e65366f` (staging-isolation)
**Portfolio mode:** BUILD-TO-SELL
**Scope:** Verify the current staging-isolation implementation and prove BK-SR-03 on approved non-production runtime only. Closed gates BK-A/CONT-04 and BK-SR-02 were NOT reopened. Order implementation was NOT started.

## 1. Branch / HEAD / divergence / git status

- Branch: `feature/bk-a-v1-contract-remediation`
- HEAD: `e65366f983f15922358c35aba83782f781d96cbe` (staging-isolation checkpoint)
- Divergence vs origin: `0 left / 3 right` (3 local commits ahead, none behind; nothing pushed)
- Pre-run working status: `docs/BUILD-TO-SELL-EXECUTION-2026-09-06.md` was already modified by the prior Claude session-release note. During BK-SR-03 evidence capture, this evidence file was created and therefore appears as untracked until the reconciliation commit.
- No push, no merge, no production access performed.

## 2. Exact changed paths (this run)

- `docs/BUILD-TO-SELL-EXECUTION-2026-09-06.md` (pre-existing working change; within allowed path `docs/`)
- `docs/audit/BK-SR-03-STAGING-REHEARSAL-EVIDENCE-2026-09-06.md` (new durable evidence created in this run; untracked until reconciliation commit)
- No product/runtime source file was modified by the evidence-capture run. All working changes are within `allowed_paths`.

## 3. Local release checks (frozen machine_checks) — ALL PASS

| Check | Result |
|---|---|
| `npm test` | PASS — 20/20 tests, exit 0 (incl. "staging Workers are isolated and staging notifications are not scheduled") |
| `npm run lint` | PASS — 0 errors (pre-existing warnings only), exit 0 |
| `npm run build` | PASS — consumer + admin production builds, exit 0 |
| `npm audit --omit=dev --audit-level=high` | PASS — 0 vulnerabilities, exit 0 |
| diff-check / write-scope | PASS — only `docs/` changed, within allowed paths |

The staging-isolation implementation at `e65366f` is independently verified: staging Workers (`wstera-admin-staging`, `wstera-consumer-staging`) are isolated from production names, staging crons are disabled, and the `sync-env.js` source-path guard keeps env files inside the repo.

## 4. Cloudflare staging deploy / smoke / rollback — MISSING APPROVED PREREQUISITE

Cloudflare staging deploy/smoke/rollback could NOT be executed because the approved non-production runtime access does not exist on this host:

- `wrangler whoami` → **"You are not authenticated. Please run `wrangler login`."**
- No `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` environment variable.
- No `~/.wrangler` or `~/.config/.wrangler` credentials/config present.
- `.env.staging.local` is **MISSING** (only `.env.staging.example` with placeholder values exists), so even `npm run cf:dry-run:staging` cannot run.

**Exact missing approved prerequisite:** an authenticated Cloudflare account (wrangler login / API token) with a non-production staging Worker environment (`wstera-admin-staging`, `wstera-consumer-staging`), plus a populated `.env.staging.local` with real non-production values. No production target was touched.

## 5. LINE / payment V1 external rehearsal — MISSING APPROVED PREREQUISITE

LINE and Stripe/payment V1 external behavior could NOT be rehearsed because no non-production/test credentials are configured:

- `.env.staging.local` is MISSING; `.env.staging.example` contains only placeholders (`your-staging-line-oa`, `sk_test_replace-me`, `whsec_replace-me`, `your-non-production-project-ref.supabase.co`).
- No real non-production LINE OA channel, Stripe test keys, or non-production Supabase project are configured.

**Exact missing approved prerequisite:** a populated `.env.staging.local` with real non-production LINE channel secret/access token, Stripe test keys, and a non-production Supabase project ref. No production credentials were used or exposed.

## 6. Secret-boundary / logging review (static, code-level)

- LINE webhook (`apps/booking-consumer/src/app/api/line/webhook/route.ts`): HMAC-SHA256 signature verification via `crypto.timingSafeEqual`; rejects invalid signatures with 401 before processing. Logs only `eventIndex`, `bookingCode`, and error message — never tokens/secrets.
- Notification dispatch (`apps/booking-consumer/src/app/api/notifications/dispatch/route.ts`): Bearer `NOTIFICATION_DISPATCH_SECRET` gate; LINE push uses `X-Line-Retry-Key` (idempotency) and records per-attempt failure/retry evidence via `complete_line_notification` RPC. Retry policy (`lib/notification-policy.ts`): exponential backoff `min(3600, 60 * 2^attempt)`, capped at 5 attempts, stops on cancelled booking.
- Secrets are read from `process.env` only (server-side); no secret values are logged or written to client-readable surfaces. `.env.staging.example` contains only placeholders.
- No production/KMO/Order/push/merge activity occurred.

## 7. Remaining next action

BK-SR-03 external rehearsal is blocked on approved non-production runtime access. Next action: obtain an authenticated Cloudflare staging account and a populated `.env.staging.local` (non-production LINE + Stripe test + non-production Supabase), then run `npm run cf:dry-run:staging` and the staging deploy/smoke/rollback rehearsal. Local implementation and all local release checks are verified PASS.

## 2026-09-07 follow-up ? approved shared lab target

Owner explicitly approved `wstera-lab` (`ykxlqnshaaxmzzocpjlj`) as the shared non-production test runtime for BK01; `Shared SaaS Runtime` (`gyleqrjdzwwlqierdwcy`) is production-only after test/pilot/release gates pass.

Verified without database mutation:
- Wrangler OAuth authentication PASS.
- BK01 local Supabase link was safely changed from `Shared SaaS Runtime` to `wstera-lab`; Git remained clean.
- `supabase migration list --linked` shows local/remote BK01 migration history aligned `29/29`; no `db push` is required.
- BK01 application objects are isolated under schema `local_service` (21 base tables).
- Project-global surfaces are shared: 5 auth users, private bucket `deposit-slips`, global migration ledger, and 8 active generically named HTTP/net cron jobs. Cron ownership was not inferred and no cron job was modified.

Guard: do not mutate unknown shared/global resources; preserve `local_service` isolation, namespace new shared resources by product where practical, and never use production/KMO credentials as staging substitutes. Remaining BK-SR-03 prerequisite is `.env.staging.local` population with `wstera-lab` API values plus non-production LINE OA and Stripe test credentials.

## 2026-09-07 follow-up ? provider credential and Cloudflare target audit

Read-only checks only; no provider secret was copied or exposed.

- Cloudflare account authentication remains valid. Neither `wstera-consumer-staging` nor `wstera-admin-staging` exists yet; neither production-name Worker (`wstera-consumer`, `wstera-admin`) exists on this account either. BK01 will therefore be a first Worker deployment on this account, and rollback proof must be created within the staging deployment sequence rather than relying on an older production deployment.
- `.env.local` metadata confirms `NEXT_PUBLIC_SUPABASE_URL` points to production `Shared SaaS Runtime` (`gyleqrjdzwwlqierdwcy`), so the file remains forbidden as a staging source.
- `.env.local` contains a Stripe test-class secret and webhook secret, and contains LINE channel secret/access token, but their staging approval/provenance is not established. No values were copied.
- `.env.local` lacks `NOTIFICATION_DISPATCH_SECRET` and has no merchant channel mapping configured.

Current bounded blocker: approved non-production LINE OA credentials, approved Stripe test credentials for BK01 staging, notification dispatch secret generation, and final assembly of `.env.staging.local`.

## 2026-09-07 follow-up - staging internal dispatch secret

- Canonical vault policy re-verified: `D:\AI-Workspace\.secrets\keys.txt` is the single secret store; secret values must not appear in chat, docs, logs, or commits.
- Generated a dedicated 32-byte staging internal secret under the vault-only key name `NOTIFICATION_DISPATCH_SECRET_BK01_STAGING`.
- Verification: exactly one key entry exists, encoded as 64 hex characters; the value was not printed, copied into the repo, or sent to Cloudflare.
- Vault inventory sanity after write: 123 assignments / 123 unique key names / 0 duplicates; required WSTERA Lab and existing provider key names remain present.
- Provider blocker remains bounded to approved BK01 non-production LINE OA credentials and approved Stripe test/webhook credentials; `.env.staging.local` is still intentionally absent.

## 2026-09-07 follow-up - Queueeasy LINE staging E2E and reminder defect

Queueeasy was used only as the canonical `WSTERA Shared LINE OA Test Fixture` under BK-SR-03. Provider identity was verified as `Queueeasy` / Basic ID `@264iezuj`; no secret values were recorded.

- Cloudflare consumer staging deployed successfully at `wstera-consumer-staging.titazmth.workers.dev`, version `cf65c2f7-b81b-427a-8fd3-139a8437df65`; staging cron remained disabled.
- LINE webhook endpoint was configured to `/api/line/webhook`; provider webhook verification returned HTTP 200 / success and webhook usage was confirmed active.
- `wstera-lab` required the documented manual Data API step to expose `local_service`; after Owner completed it, application-schema reads succeeded.
- Public `create_booking_hold` RPC created a staging booking; Owner sent the prefilled binding command through Queueeasy and received the Flex confirmation.
- DB evidence confirmed the customer LINE UID is present, one `line_users` binding exists, and the webhook Flex audit row reached `sent`.
- Subsequent server-side dispatcher push succeeded without another binding action, proving persisted UID reuse.

Duplicate-like delivery investigation found two distinct due jobs, not one duplicated idempotency key: immediate `booking_created` plus `reminder_24h`. The test appointment was created inside the 24-hour window, so the reminder's `scheduled_for` timestamp was already in the past and was claimed together with confirmation.

Remediation: migration `20260907181500_skip_overdue_line_reminders.sql` adds a DB-boundary invariant that suppresses only newly inserted pending `reminder_24h` rows whose `scheduled_for <= now()`. It does not cancel correctly queued reminders that later become delayed by an outage.

Verification:
- `npm test` PASS 21/21 including the new scheduling contract test.
- lint PASS with 0 errors / 13 pre-existing warnings; `git diff --check` PASS.
- Migration applied only to linked `wstera-lab`.
- Fresh <24h public booking `BK-J24DX2` produced exactly one notification job: `booking_created`; no `reminder_24h` row was created.
- Live staging dispatch returned `CLAIMED=1`, `SENT=1`, `FAILED=0`.

## 2026-09-07 Owner external acceptance after reminder remediation

Owner reported receipt of exactly one new LINE notification for the fresh regression booking after the overdue-reminder fix:

`ยืนยันคิว BK-J24DX2 ที่ BK-SR-03 QEASY Fixture วันที่ 2026-09-08 เวลา 16:00`

This matches the server-side evidence for that run: one `booking_created` job, no newly-created `reminder_24h`, and dispatcher result `CLAIMED=1 / SENT=1 / FAILED=0`. The earlier duplicate-like symptom is therefore externally resolved for the reproduced <24h case.

Queueeasy remains a shared non-production fixture. After this approved LINE slice, BK01 must release/reset the fixture before another product claims it. Final BK-SR-03 closure still requires the remaining rollback/redeploy, Stripe test/webhook, and closure-review evidence.
