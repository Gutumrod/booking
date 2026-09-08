# Current Status - 2026-09-06

**Product:** Booking by WSTERA (BK01)
**Repository branch:** `feature/bk-a-v1-contract-remediation`
**Current release code checkpoint:** `dba74bd` - BK-SR-03 LINE remediation code. Current evidence checkpoint: `3ee8368`; full LINE matrix + live reminder acceptance PASS, and Cloudflare rollback/redeploy proof PASS.
**Portfolio mode:** BUILD-TO-SELL / active Booking V1 release track

## Verified Current State

Booking Stage 4 migration-history reconciliation is CLOSED at `836943a` and must not be repeated.

CONT-03 non-DB verification is CLOSED/PASS. The previously blocked CONT-04 database-backed runtime gates are now **CLOSED/PASS (`CONT04_PASS`)** against approved WSTERA Lab only. Final evidence records migration history `29/29`, pgTAP `26/26 PASS` with the extension removed after the run, G3-G9 accepted, fixture residue `0`, unit tests `19/19 PASS`, lint PASS, and both production builds PASS. Production was not accessed.

The CONT-04 remediations are present at `6e1c0c6`: billing wrapper result-field correction, platform-admin audit-trigger row handling, and owner/admin-only ticket mutation guards. Durable summary: `docs/audit/CONT04-CLOSURE-EVIDENCE-2026-09-06.md`.

**BK-A V1 Contract Remediation is CLOSED at the current baseline.** This closes the previously environment-blocked database/runtime acceptance for BK-A; it does not claim G10 deployment, real external-provider rehearsal, final commercial pricing, or public-launch readiness.

## Order Capability Overlay

Owner approved BK01 Order Phase 0A/0B on 2026-09-05. Phase 0A Product Boundary and Phase 0B Order V1 Contract are **LOCKED**; Module Reuse Check is COMPLETE, `Reuse Gate: PASS`, and MT01 Bootstrap Check is PASS. Order prototype remains frozen exploration evidence. Order production implementation is NOT authorized.

Canonical Owner correction: parent `docs/council-bk01-order-capability-2026-09-05/OWNER-OVERRIDE-AND-CORRECTION-2026-09-05.md`.

Execution priority: `docs/BUILD-TO-SELL-EXECUTION-2026-09-06.md`.

## Next Authorized Action

1. BK-SR-02 remains CLOSED at exact release checkpoint `d2ee14f`; do not reopen it without contradictory evidence.
2. BK-SR-03 is ACTIVE; LINE integration acceptance is PASS end-to-end and Cloudflare rollback/redeploy proof is PASS. BK-SR-03 is not closed yet.
3. Continue BK-SR-03 only on approved non-production runtime. `wstera-lab` is linked with migration history `30/30`; consumer staging is deployed and rollback/redeploy is proven. Queueeasy is RELEASE_PENDING; final fixture reset requires `Use webhook` OFF plus provider verification `active=false`. Remaining BK-SR-03 work is Stripe test/webhook rehearsal and closure review. `.env.local` remains production-bound and forbidden as a staging source.
4. The temporary Claude session lock is RELEASED as of 2026-09-06 14:08 Asia/Bangkok; preserve existing evidence and resume bounded work without restarting completed stages.
5. Do not use `.env.local`, production/KMO credentials, or production targets as a staging shortcut. Do not start Order implementation automatically.

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