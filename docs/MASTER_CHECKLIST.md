# BK01 Master Checklist

**Status:** BK-0 governance checklist retained; current R4 execution checkpoint updated 2026-09-22

## BK-0 documentation lock
- [x] baseline branch/commit recorded (`main @ e99615d`)
- [x] mandatory governing docs/code/routes/migrations audited
- [x] contradictions ledger created
- [x] current market/source ledger created
- [x] segmentation, competitor landscape and ICP/JTBD created
- [x] owner decision queue surfaced and full recommendation set approved
- [x] numbered SSOT 00–10 created
- [x] feature traceability created with one disposition per capability
- [x] marketing/GTM/launch/KPI pack created
- [x] deployment/incident/backup/support/legal-privacy pack created
- [x] authority order and ADR/change-control defined
- [x] final cross-document audit complete with no unresolved P0/P1 documentation contradiction
- [x] independent documentation reviewer PASS
- [x] owner authorizes commit/push

## BK-A implementation blockers from approved V1 contract
Implementation snapshot (2026-08-29): code/static/build work is recorded in `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`. Original blocking condition: clean DB replay, pgTAP, tenancy, and provider-backed gates proven.

**2026-09-06 CONT-04 reconciliation:** DB-backed gates are now PASS — `CONT04_PASS` at HEAD `6e1c0c6`: 29/29 migration replay, pgTAP 26/26, G3 8/8 / G4 10/10 / G5 22/22 / G6A 10/10 / G6B 8/8 / G7 8/8 / G8 9/9 / G9 9/9 — all PASS; WSTERA Lab runtime, production not accessed. Evidence: `docs/CURRENT_STATUS.md` §Verified Current State and `.secretary-relay/t_ef1cef98/CONT04-FINAL-EVIDENCE-2026-09-06.json`. Items blocked solely by DB-backed evidence are marked [x]; items requiring real LINE-provider runtime or Owner pricing approval remain [ ].

- [x] private deposit-slip storage/read path — *CONT04_PASS: deposit RLS/storage gates G5/G6A PASS (HEAD 6e1c0c6)*
- [x] auth-user→staff mapping and staff self-scope — *CONT04_PASS: auth/role gate G4 10/10 PASS (HEAD 6e1c0c6)*
- [x] annual UI/copy removed; monthly billing truth reconciled — *CONT-03 static PASS (no annual offer) + CONT04_PASS G8 billing 9/9 PASS (HEAD 6e1c0c6)*
- [x] legacy paid booking quota wall retired/remediated — *CONT-03 static PASS (no legacy 100/500 paid claim) + CONT04_PASS entitlement gates G3/G4 PASS (HEAD 6e1c0c6)*
- [x] WSTERA Central OA default notification path + server-side secret/config boundary — *live Queueeasy staging PASS; merchant-owned OA moved to optional managed add-on by Owner override 2026-09-08*
- [x] confirmation + reminder automation evidence — *live LINE acceptance PASS: confirmation, 24h reminder, reschedule, cancel, UID reuse, idempotent dispatch, provider retry cap*
- [ ] Pro automatic slip verification + cost/allowance/failure policy — *real auto-slip provider integration evidence required*
- [ ] controlled PromptPay QR generation — *CONT-03 static: no promptpay.io; runtime implementation evidence required*
- [x] customer self-reschedule/cancel atomic flow — *CONT04_PASS: concurrency/atomic gate G5 22/22 PASS (HEAD 6e1c0c6)*
- [x] completion/no-show operational actions + analytics — *CONT04_PASS: completion gate G7 8/8 PASS (HEAD 6e1c0c6)*
- [x] owner CSV export + deletion/account-closure request path — *CONT04_PASS: platform gate G9 9/9 PASS (HEAD 6e1c0c6)*
- [x] platform-admin/support privileged audit verification — *CONT04_PASS: support/platform-admin audit gate G9 9/9 PASS (HEAD 6e1c0c6)*
- [ ] unsupported absolute public copy (including `ปลอดภัย 100%`) removed or replaced using `SHIPPED-VERIFIED` evidence — *CONT-03 static removal confirmed; ongoing SHIPPED-VERIFIED claim management required*
- [ ] commercial UI/copy reconciled with PD-002/PD-003/PD-008: no annual offer, no legacy 100/500 paid wall, and no provisional price presented as final — *Owner pricing approval required (BK-C)*

## BK-A runtime closure checkpoint — 2026-09-06
- [x] CONT-04 final verdict = `CONT04_PASS` on approved WSTERA Lab only
- [x] migration history verified `29/29`
- [x] pgTAP contract `26/26 PASS`; pgTAP extension removed after run
- [x] DB-backed G3-G9 accepted with zero fixture residue
- [x] unit/static `19/19`, lint PASS, consumer build PASS, admin build PASS recorded in final closure evidence
- [x] production not accessed during CONT-04 verification
- [x] closure remediations committed at `6e1c0c6`

The capability checklist above is preserved as the original BK-A implementation checklist. `CONT04_PASS` closes its former database/runtime blocker; it does not convert downstream external-provider, deployment, pricing, legal/privacy, or public-launch evidence into PASS. Canonical closure summary: `docs/audit/CONT04-CLOSURE-EVIDENCE-2026-09-06.md`.

## BK-SR-02 / BK-B release checkpoint — 2026-09-06
- [x] dependency audit remediation limited to `package-lock.json`: `qs 6.15.3 -> 6.16.0`
- [x] exact release checkpoint committed at `d2ee14f`
- [x] `npm ci` PASS with 0 vulnerabilities
- [x] `npm audit --omit=dev` PASS with 0 vulnerabilities
- [x] unit/static tests PASS 19/19
- [x] lint PASS with 0 errors (13 existing warnings)
- [x] consumer + admin production builds PASS
- [x] `git diff --check` PASS
- [x] exact clean-clone verification of `d2ee14f` PASS; clone status clean

BK-SR-02 / BK-B is CLOSED. BK-SR-03 staging/external-system rehearsal is next; this does not waive provider, deployment, legal/privacy or commercial gates.

## BK-SR-03 staging + external-system rehearsal - 2026-09-06
- [x] staging Worker identities isolated at `e65366f`: `wstera-consumer-staging` / `wstera-admin-staging`
- [x] staging consumer cron disabled; production Worker names not reused by staging service bindings
- [x] `.env.staging.example` exists with placeholders only; `sync-env:staging` is bounded to `.env.staging.local`
- [x] fresh local verification PASS: tests 20/20, lint 0 errors, consumer/admin builds PASS, production dependency audit 0 vulnerabilities
- [x] static LINE signature/retry/idempotency and secret/logging boundaries reviewed
- [x] approved Cloudflare staging authentication available; Wrangler OAuth verified on 2026-09-07
- [x] Owner-approved shared test Supabase selected and linked: `wstera-lab` (`ykxlqnshaaxmzzocpjlj`); remote BK01 migration history matches local `29/29`
- [x] staging-only internal dispatch secret generated in canonical vault as `NOTIFICATION_DISPATCH_SECRET_BK01_STAGING`; value not logged or committed
- [ ] populated `.env.staging.local` with `wstera-lab` API values, non-production LINE OA and Stripe test values
- [ ] `npm run cf:dry-run:staging` PASS
- [ ] staging consumer/admin deploy + post-deploy smoke PASS
- [ ] LINE external signature/delivery/retry/failure rehearsal PASS
- [ ] applicable Stripe V1 test-mode rehearsal PASS
- [ ] rollback + smoke + redeploy + final smoke PASS
- [ ] BK-SR-03 durable evidence finalized and independent closure review PASS

**Current BK-SR-03 verdict:** `BLOCKED_PENDING_STAGING_SECRETS`. Cloudflare authentication and the Supabase test target are now approved. Remaining provider prerequisites are staging env population plus non-production LINE OA and Stripe test credentials. Production/KMO credentials and `.env.local` are forbidden staging substitutes.

**Shared-Lab guard:** BK01 owns `local_service`; treat project-global `auth`, storage, cron and migration ledger as shared. Do not modify unknown cron jobs or another product's resources. `Shared SaaS Runtime` remains production-only until release gates pass.
## BK-C/BK-D downstream commercial and public-launch gates
- [ ] final Basic/Pro public prices approved by owner
- [ ] final Pro auto-slip provider, included allowance, unit cost/top-up and failure policy approved
- [ ] any WSTERA-managed LINE allowance and cost model approved before it is offered
- [ ] production backup capability verified against proposed targets
- [ ] final RPO/RTO explicitly approved
- [ ] final retention durations approved for booking, customer, slip, ticket, audit and backup data
- [ ] `past_due` grace duration/policy implemented, tested and approved
- [ ] qualified legal/privacy review completed
- [ ] final competitor refresh completed before commercial lock
- [ ] final public marketing claims limited to `SHIPPED-VERIFIED` evidence
- [ ] support hours and customer-facing SLA wording approved, if any is offered
- [ ] all BK-A technical and release gates PASS before public V1

## R4 real-shop hardening checkpoint — 2026-09-22
- [x] R4 source remediation completed through NEW-F18 at `3b3a3338de029a058aa5763c806be42f8a5205ca`
- [x] independent Codex R9 = `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME`
- [x] fresh source gates: tests 118/118; lint 0 errors / 12 warnings; Admin + Consumer build/typecheck PASS
- [x] NEW-F18 Services/Staff runtime path proven on KMO
- [x] KMO availability 42501 root cause isolated to missing anon SELECT on `shop_id` predicates
- [x] reviewed narrow public payload-column repair applied without business-data mutation
- [ ] controlled anon SELECT repair on `staff_schedules.shop_id`
- [ ] controlled anon SELECT repair on `shop_holidays.shop_id`
- [ ] Consumer desktop/mobile browser acceptance after privilege repair
- [ ] authorized positive-flow staff/schedule fixture
- [ ] positive `service -> staff -> date -> slot -> hold/create` E2E proof
- [ ] Admin desktop/mobile R4 acceptance matrix
- [ ] R4 CLOSED with real behavioral evidence

**Current verdict:** `BROWSER_PROOF_PARTIAL / KMO_RUNTIME_AND_FIXTURE_BLOCKED`.

**Hard boundary:** no Junction A retry, LAB/shared-runtime mutation, runtime R7, formal Junction B, Order-live or Claim-live work before durable `HOUSE-A PASS`.

## R4 resume checkpoint — 2026-09-23
- [x] preflight/baseline freeze at `021d242` (delta from `3b3a333` = docs/evidence only) → `R4_RUNTIME_BASELINE_LOCKED`
- [x] canonical R4 source ran locally for consumer 3100 and admin 3101 without source/env/lockfile change
- [x] live pre-state re-measured; anon `shop_id` SELECT on both availability tables confirmed still false
- [x] controlled anon SELECT repair applied on `staff_schedules.shop_id` and `shop_holidays.shop_id` only
- [x] post-repair privilege boundary verified: no table-wide SELECT, no write privilege, no extra column, policies identical, business data unchanged
- [x] Consumer desktop/mobile browser acceptance after privilege repair → `KMO_AVAILABILITY_DRIFT_CLOSED`, truthful `NO_STAFF`
- [x] truthful-state separation proven: `LOAD_ERROR` under authorization failure vs `NO_STAFF` with zero rows, same revision/tenant
- [x] consumer negative-state matrix: `NO_STAFF`, `SHOP_NOT_FOUND` (KMO), `BOOKING_DISABLED`, `SHOP_NOT_FOUND` (wstera-lab)
- [x] Admin unauthenticated contract browser proof (login 200, `/dashboard` → `/login?next=/dashboard`)
- [x] mandatory gates on final checkpoint: tests 118/118; lint 0 errors/12 warnings; both builds PASS; both typechecks PASS; diff/secret/protected-scope PASS
- [x] `NO_SERVICES` / `NO_SCHEDULE` / `NO_SLOT_FOR_DATE` / `PAYMENT_NOT_CONFIGURED` browser states — proven on purpose-built isolated fixture tenants
- [x] Admin authenticated R4 desktop/mobile matrix (R4-1 … R4-9) — executed against the Owner-authorized synthetic fixture
- [x] authorized positive-flow staff/schedule fixture — Owner-approved isolated fixture created, used, then removed
- [x] positive `service -> staff -> date -> slot -> hold/create` E2E proof (desktop + mobile, DB-confirmed)
- [x] cross-cutting regression browser pass (no cross-tenant leak, route transition, stale/out-of-order, dirty-state, payment/readiness truth)
- [x] fixture + temporary test admin cleanup with residue 0 and real-KMO fingerprint unchanged
- [x] R4 CLOSED with real behavioral evidence

**Current verdict (2026-09-23):** `R4 CLOSED`.

**Owner decisions required:** none outstanding for R4 acceptance. Remaining operational step: Claude reviews the verified diff and commit/pushes under `claude-owns-git-commits`, then HEAD = origin and the worktree must be clean.

**Evidence:** `docs/audit/r4-2026-09-23/REPORT-BK01-R4-CLOSURE-2026-09-23.md` (+ `EVIDENCE-INDEX-2026-09-23.json`) and `docs/daily/2026-09-23.md`.
