# Current Status - 2026-09-23

**Product:** Booking by WSTERA (BK01)
**Repository branch:** `feature/bk01-real-shop-hardening-r4`
**Canonical source checkpoint:** `3b3a3338de029a058aa5763c806be42f8a5205ca`
**Documentation/evidence checkpoint:** `50555c14d1c578caabc421dbad995c8f2b80709e`
**Current source gate:** `SOURCE_REVIEW_PASS`
**Current R4 gate:** `R4 CLOSED`
**Git disposition:** `R4 GIT CLOSED` at `50555c14d1c578caabc421dbad995c8f2b80709e` — HEAD = `origin/feature/bk01-real-shop-hardening-r4`, worktree clean
**Portfolio mode:** OWNER HOLD — AWAIT KMO REAL-SHOP EVIDENCE (dated 2026-09-23; supersedes prior "continue BK-SR-03" execution guidance until resumed)

## 2026-09-23 OWNER HOLD — AWAIT KMO EVIDENCE

This is the current controlling status for canonical execution priority. It does not reopen or affect the R4 GIT CLOSED disposition above.

Owner decision: pause canonical BK01 product-core work at this stable R4-closed checkpoint (do not continue BK-SR-03 remainder, BK-SR-04, R7, Junction work, Order-live, Claim-live, or other implementation done merely to self-prove behavior). KMO — a real operating shop with its own GitHub/Supabase/Cloudflare and real Booking/Order/Claim/custom-fabrication operations — is the proving ground; BK01 will selectively promote only generic, reusable, safe findings after reproduction/generalization/design/security review and an explicit Owner decision. No canonical mutation is authorized during the hold except explicit Owner override or a bounded documentation/security-critical emergency. Full rules (classification, promotion, resume conditions): `docs/OWNER-HOLD-BK01-AWAIT-KMO-EVIDENCE-2026-09-23.md`.

**BK-SR-03:** OPEN/PAUSED (not CLOSED). **BK-SR-04:** NOT STARTED/PAUSED. **BK-SR-05:** NOT STARTED (future). **R7 / Junction A / formal Junction B / Order-live / Claim-live:** remain separately BLOCKED by HOUSE-A/platform authority, independent of this hold. No SELL-READY or PUBLIC-LAUNCH-READY claim.

## 2026-09-23 R4 CLOSURE

This section supersedes older execution-status statements below where they conflict; historical closure evidence remains valid for the checkpoint it describes.

- Owner ruling "R4 CLOSE CONTINUATION" approved: a temporary isolated fixture inside the KMO project, a temporary test admin limited to that fixture, and retention of `claude-owns-git-commits` for git authority.
- Fixture provisioning used the service-role/Admin path for fixture lifecycle only — never for browser authentication and never to bypass authorization. The real `kmo-rackbarcustom` tenant was never modified.
- Consumer truthful-state acceptance is PASS on desktop 1440x1000 and mobile 390x844: `OK_STEPPER`, `NO_STAFF`, `SHOP_NOT_FOUND`, `NO_SERVICES`, `NO_SCHEDULE`, `NO_SLOT_FOR_DATE`, `PAYMENT_NOT_CONFIGURED`, `BOOKING_DISABLED`, plus `LOAD_ERROR`-vs-zero-rows separation proven on the same revision and tenant.
- Authenticated Admin R4 matrix is PASS: R4-1 deposit survives price edit/save/reload; R4-2 empty-during-edit plus visibly-invalid-with-no-mutation; R4-3 numeric HH:MM fields with blur canonicalisation and invalid revert; R4-4 dirty Staff B edit preserved when saving Staff A; R4-5 Preview opens the real tenant page with truthful readiness rows; R4-7 QR + server amount + config-sourced recipient with no hardcoded number; R4-8 countdown follows server `expires_at`; R4-9 durations 1/2/37/90 rendered and a 1-minute booking succeeded.
- Positive customer E2E is PASS: `shop -> service -> staff/resource -> date -> valid slot -> hold -> create`, desktop and mobile, with DB-confirmed `confirmed` bookings and a separate deposit `hold`/`awaiting` path.
- External side effects were blocked by construction: notifications remain pending database rows, no LINE/notification/webhook/Stripe call is reachable from that path, all seven KMO cron jobs were inspected and none touches `local_service.line_notification_logs`, and the positive-E2E shop used `require_deposit = false`.
- Cross-cutting regression is PASS: no cross-tenant leakage across fixture, KMO and LAB; route transitions rendered the correct tenant; rapid tenant navigation settled on the last requested slug; dirty-state, payment truth and readiness truth verified.
- Fixture cleanup is complete with **residue 0** on every created object (6 shops, 9 services, 7 staff, 36 schedules, 42 weekly rows, 6 subscriptions, 6 memberships, 5 bookings, 2 customers, 6 notification rows, 1 test auth user). Project totals returned to the KMO-only baseline.
- Real KMO business data is proven unchanged by md5 fingerprint over shops/staff/services/schedules/shop_users/weekly (6/6 identical, before vs after cleanup) and by a post-cleanup anonymous probe returning the same states.
- Mandatory gates at the final state: tests 118/118 PASS; lint 0 errors / 12 warnings; Admin and Consumer builds PASS; both typechecks PASS; `git diff --check` clean; secret scan 0 hits; protected-scope scan PASS; HEAD/origin parity at `021d242`.
- No product source, migration, package/lockfile, env file or deployment was changed. Hermes performed no commit and no push.
- Control-plane note: `work-sync` remains a recorded known blocker (`dead_letter / 422 unresolved product identity`); it was not retried to manufacture success and was not folded into R4 scope.
- Proof-infrastructure note: Next 16 dev blocks cross-origin dev resources for `127.0.0.1` (only `*.trycloudflare.com` is allowed); use `localhost` for local proof. No BK01 source change was made for this.
- Do not retry Junction A, mutate LAB/shared runtime, start runtime R7, formal Junction B, Order-live or Claim-live work until durable `HOUSE-A PASS`.

Durable current evidence:
- `docs/audit/r4-2026-09-23/REPORT-BK01-R4-CLOSURE-2026-09-23.md`
- `docs/audit/r4-2026-09-23/REPORT-BK01-R4-RESUME-2026-09-23.md`
- `docs/audit/r4-2026-09-23/EVIDENCE-INDEX-2026-09-23.json`
- `docs/audit/r4-2026-09-23/` — full evidence set (state matrices, admin matrix, R4-1..R4-9, cross-cutting, E2E, cleanup residue, KMO fingerprint) + screenshots
- `docs/daily/2026-09-23.md`
- `docs/handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md`

## Owner Decisions Required

None outstanding for R4 acceptance. Claude reviewed the verified diff and performed commit/push under `claude-owns-git-commits` at `50555c14d1c578caabc421dbad995c8f2b80709e`; HEAD = origin and the worktree is clean. BK01 R4 is GIT CLOSED.

## 2026-09-22 Previous Execution Override (retained as historical checkpoint evidence)

- R4 source remediation/re-review is complete through NEW-F18 at `3b3a333...`.
- Codex R9 independently returned `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME` at that exact SHA.
- Fresh R9 verification: tests 118/118 PASS; lint 0 errors / 12 warnings; Admin and Consumer builds PASS; both typechecks PASS; diff/secret/protected-scope checks PASS.
- Real KMO runtime proof closed the former Services/Staff `is_active` 42501 path: shop profile 200, services 200 with 2 rows, staff 200 with 0 rows.
- Remaining public availability 42501 is proven KMO downstream privilege drift: anon lacks SELECT on predicate column `shop_id` for `staff_schedules` and `shop_holidays`.
- The approved narrow public payload-column repair was applied on KMO without business-data mutation; the final two-column `shop_id` repair was safety-blocked by managed tooling and was NOT executed. **Superseded on 2026-09-23: that repair is now applied and verified via a permitted controlled mechanism.**
- KMO currently returns zero public staff rows. Positive customer `service -> staff -> date -> slot -> hold/create` proof therefore requires an authorized real or isolated fixture and was not fabricated.
- Admin browser/mobile acceptance remains owed. R4 is NOT CLOSED.

Durable evidence for that checkpoint:
- `docs/audit/r4-2026-09-22/REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md`
- `docs/audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-START-2026-09-22.md`
- `docs/audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-PARTIAL-2026-09-22.md`
- `docs/daily/2026-09-22.md`
- `docs/handoffs/HANDOFF-BK01-R4-EOD-2026-09-22.md`

## Verified Historical / Prior Closed State

Booking Stage 4 migration-history reconciliation is CLOSED at `836943a` and must not be repeated.

CONT-03 non-DB verification is CLOSED/PASS. The previously blocked CONT-04 database-backed runtime gates are now **CLOSED/PASS (`CONT04_PASS`)** against approved WSTERA Lab only. Final evidence records migration history `29/29`, pgTAP `26/26 PASS` with the extension removed after the run, G3-G9 accepted, fixture residue `0`, unit tests `19/19 PASS`, lint PASS, and both production builds PASS. Production was not accessed.

The CONT-04 remediations are present at `6e1c0c6`: billing wrapper result-field correction, platform-admin audit-trigger row handling, and owner/admin-only ticket mutation guards. Durable summary: `docs/audit/CONT04-CLOSURE-EVIDENCE-2026-09-06.md`.

**BK-A V1 Contract Remediation is CLOSED at the current baseline.** This closes the previously environment-blocked database/runtime acceptance for BK-A; it does not claim G10 deployment, real external-provider rehearsal, final commercial pricing, or public-launch readiness.

## Order Capability Overlay

Owner approved BK01 Order Phase 0A/0B on 2026-09-05. Phase 0A Product Boundary and Phase 0B Order V1 Contract are **LOCKED**; Module Reuse Check is COMPLETE, `Reuse Gate: PASS`, and MT01 Bootstrap Check is PASS. Order prototype remains frozen exploration evidence. Order production implementation is NOT authorized.

Canonical Owner correction: parent `docs/council-bk01-order-capability-2026-09-05/OWNER-OVERRIDE-AND-CORRECTION-2026-09-05.md`.

Execution priority: `docs/BUILD-TO-SELL-EXECUTION-2026-09-06.md`.

## Next Authorized Action

**Superseded by the 2026-09-23 OWNER HOLD above.** The items below describe pre-hold execution sequencing and remain historically accurate, but none of them are to be continued while the hold is active. See `docs/OWNER-HOLD-BK01-AWAIT-KMO-EVIDENCE-2026-09-23.md` for resume conditions.

1. BK-SR-02 remains CLOSED at exact release checkpoint `d2ee14f`; do not reopen it without contradictory evidence.
2. BK-SR-03 was ACTIVE pre-hold; LINE integration acceptance is PASS end-to-end and Cloudflare rollback/redeploy proof is PASS. BK-SR-03 is not closed; it is now PAUSED by the Owner Hold, not being continued.
3. Pre-hold plan (not currently authorized): continue BK-SR-03 only on approved non-production runtime. `wstera-lab` is linked with migration history `30/30`; consumer staging is deployed and rollback/redeploy is proven. Queueeasy is RELEASE_PENDING; final fixture reset requires `Use webhook` OFF plus provider verification `active=false`. Remaining BK-SR-03 work is Stripe test/webhook rehearsal and closure review. `.env.local` remains production-bound and forbidden as a staging source.
4. The temporary Claude session lock is RELEASED as of 2026-09-06 14:08 Asia/Bangkok; this note is historical only.
5. Do not use `.env.local`, production/KMO credentials, or production targets as a staging shortcut. Do not start Order implementation automatically.
6. R4 is GIT CLOSED at `50555c1`; do not restart completed R4 phases. Per the Owner Hold, do not resume BK-SR-03/04/05, and continue not starting Junction A retry, LAB/shared-runtime mutation, R7, formal Junction B, Order-live or Claim-live work before durable `HOUSE-A PASS`.

## LINE Commercial Path — Owner Override 2026-09-08

- WSTERA Central OA is the default Trial/Basic/Pro notification path and is bundled with monthly BK01 service.
- Merchant-owned LINE OA is optional future/managed add-on, not a V1 onboarding prerequisite.
- Merchant-owned OA setup/configuration/management/support carries additional WSTERA service pricing; merchant bears its own LINE OA/message-plan charges.
- Exact Central OA fair-use/message allowance and merchant-OA add-on price remain for BK-SR-05 commercial lock.

## Shared WSTERA Lab Boundary ? Owner Decision 2026-09-07

- `wstera-lab` (`ykxlqnshaaxmzzocpjlj`) is the approved shared non-production runtime for BK01 and other WSTERA products.
- BK01 uses application schema `local_service`; remote migration history now matches BK01 local migrations `30/30`, including the staging-proven overdue-reminder suppression migration.
- Project-global `auth`, storage, cron and `supabase_migrations` are shared surfaces. Do not mutate unknown/shared cron jobs or another product's resources. New shared resources should be product-namespaced where practical.
- Existing private bucket `deposit-slips` is grandfathered BK01 state; do not rename it during BK-SR-03.
- `Shared SaaS Runtime` (`gyleqrjdzwwlqierdwcy`) is the production destination only after test/pilot/release gates pass; it must not be used as a staging shortcut.

## Hard Stop for Order Implementation

Order implementation must not begin merely because Phase 0 documentation completes. Default sequencing is to finish the existing Booking V1 release/pilot Owner decision first.

Earliest exception requires BK-A + BK-B closed, Order contracts locked, Reuse Gate PASS, MT01 bootstrap record, isolated migration baseline, and explicit Owner overlap/risk authorization.

**BOOKING CORE BUILD TRACK:** AUTHORIZED / BUILD-TO-SELL
**BK-A:** CLOSED / CONT04_PASS
**BK-SR-02 / BK-B:** CLOSED / exact release checkpoint `d2ee14f`
**BK-SR-03:** ACTIVE / LINE_STAGING_SLICE_PASS at `dba74bd`; remaining rollback + Stripe + closure review
**R4:** CLOSED / `R4_CLOSED` — GIT CLOSED at `50555c14d1c578caabc421dbad995c8f2b80709e`
**ORDER PHASE 0 DOCS:** COMPLETE / LOCKED
**ORDER IMPLEMENTATION:** NOT AUTHORIZED

## Shared-Runtime Junction A Execution Override — 2026-09-08

This section is newer than the 2026-09-06 status above and controls the current shared-runtime execution state.

- A0 live baseline refresh completed against WSTERA LAB.
- The reviewed BK01 platform bootstrap was applied through the platform lane, then **failed A2 isolation/regression acceptance**.
- Live proof reproduced a Booking regression: `local_service.is_shop_member(...)` failed with `42501 permission denied for schema auth` after function ownership transfer to `bk01_migrator`.
- The new BK role also inherited write-capable `net` access from platform `PUBLIC` ACLs. The same platform-level exposure exists for PS01 product roles and therefore requires platform isolation governance rather than a BK01-local ACL workaround.
- The bootstrap was immediately rolled back before any BK01 product-local forward migration was applied.
- Rollback restored BK01, PS01, MT01 and measured shared-surface signatures to the pre-bootstrap values. Booking probe recovered.
- Global history retains `bk01_platform_bootstrap` and `bk01_platform_bootstrap_rollback` as platform audit evidence; history was not repaired or erased.

**JUNCTION A:** FAIL / ROLLED BACK

**BK01 SHARED-RUNTIME ADMISSION:** QUARANTINED / FORWARD RUNTIME MIGRATIONS LOCKED

**ORDER/CLAIM LIVE RUNTIME:** NOT AUTHORIZED

Evidence: `docs/audit/BK01-SHARED-RUNTIME-JUNCTION-A-FAILURE-EVIDENCE-2026-09-08.md`.

## Safe-Lane Review Update — 2026-09-08

Claude and Codex bounded parallel lanes are complete and independently reviewed.

- Claude Portal + Claim safe lane accepted at `45fa3abf5a316dea622b005bfced1acf948cb8bc`.
- Codex Order safe scaffold accepted at `982188170f6a80ce492723786ca1e21cc2435733`.
- Both branches are clean and pushed to origin.
- Both remain migration/shared-runtime clean.
- Independent tests/lint/build/BK01 verification passed for both lanes.
- Product Catalog provenance was rechecked against Module Hub commit `cd88c570ab57f6976d15f85d09973d0cfbf0cd63`; source 213/213 tests + typecheck PASS.

**JUNCTION B INPUTS:** READY

**FORMAL JUNCTION B / MERGE:** BLOCKED BY JUNCTION A FAIL

No Order/Claim live runtime work or integration merge is authorized until House/platform remediation returns and Junction A is re-proven PASS.

Canonical review: `docs/order/JUNCTION-B-SAFE-LANE-INDEPENDENT-REVIEW-2026-09-08.md`.
## Pre-Integration Hygiene Cleanup — 2026-09-08

Independent Codex audit verdict: `PASS WITH CLEANUP REQUIRED`.

Coordinator executed only the approved ignored/generated cleanup set:

- removed redundant coordinator app `.env.local` copies;
- removed Claude root/app real `.env.local` duplicates;
- removed Codex placeholder app `.env.local` copies;
- removed reproducible `node_modules`, `.next`, `.open-next`, `.wrangler`, `next-env.d.ts`, and `tsconfig.tsbuildinfo` artifacts where present;
- preserved coordinator canonical `.env.local`, `.env.staging.local`, `supabase/.temp`, local coordination state, and Git object database;
- verified Claude/Codex HEADs still equal origin and both worktrees remain clean;
- verified no integration branch exists.

**PRE-INTEGRATION HYGIENE:** PASS

This does not change Junction A authority. Formal Junction B, integration merge, and Order/Claim runtime remain blocked until Junction A is re-proven PASS.

Evidence: `docs/order/BK01-PRE-INTEGRATION-HYGIENE-INDEPENDENT-AUDIT-2026-09-08.md` and `docs/order/BK01-PRE-INTEGRATION-HYGIENE-CLEANUP-EVIDENCE-2026-09-08.md`.
