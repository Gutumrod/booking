# WORK BRIEF — BK01 — 2026-09-05

## Objective

Resume BK01 Booking core as the active portfolio heavy track. Order Phase 0A/0B documentation has now completed and must remain stopped at the locked Reuse Gate until a later implementation authorization.

## Source of truth

1. Owner explicit decisions / parent Owner override D1–D12.
2. Parent `docs/platform/PORTFOLIO_PRODUCTION_MASTER_PLAN.md` revision 3 + overlays.
3. BK01 locked product/domain/security/release docs.
4. Current branch/runtime evidence.

## Current baseline

- branch: `feature/bk-a-v1-contract-remediation`;
- implementation baseline before this documentation checkpoint: `213360a`, ahead origin by 1 at review time;
- Stage 4 migration-history reconciliation: CLOSED;
- CONT-03 non-DB verification: CLOSED/PASS for reviewed surface;
- independent Codex review: PASS, zero P0/P1 code/design defect;
- CONT-04 DB-backed gates: `BLOCKED_ENVIRONMENT`;
- no production deploy/remote DB apply verified.

## Heavy-track task

Close the remaining Booking V1 release-hardening path. Do not start Order implementation.
## Execution order

1. Refresh exact git/runtime baseline; preserve current branch and unrelated local state.
2. Do not rerun already-closed non-DB remediation unless a relevant source change invalidated evidence.
3. Resolve the approved non-Docker database runtime path for CONT-04.
4. Run DB-backed migration replay, RLS/tenant denial, overlap/concurrency and other pending G2–G9 evidence.
5. Obtain fresh independent review of the newly closed DB-backed surface.
6. Close BK-A with an explicit checkpoint.
7. Execute BK-B automated release/P0b repository-readiness requirements.
8. Continue deployment, provider, recovery/operations and pilot work toward BK-L1/P2-C2.

## Completed bounded companion task

Order Phase 0A/0B completed as documentation only using:

- parent `docs/council-bk01-order-capability-2026-09-05/OWNER-OVERRIDE-AND-CORRECTION-2026-09-05.md`;
- parent `docs/strategy/BK01-ORDER-PHASE0-EXECUTION-PLAN-2026-09-05.md`.

Phase 0 artifacts are now locked: `docs/order/00_PRODUCT_BOUNDARY_DECISION_2026-09-05.md` through `docs/order/04_PHASE0_HANDOFF.md`; Reuse Gate PASS and MT01 Bootstrap PASS. Stop here. Do not convert the prototype or contracts into production code.
## Focus / portfolio rule

Active heavy track: BK01 Booking core.
Active bounded track: NONE after this Phase 0 closeout; slot returned.

Do not auto-open the freed bounded slot; the next bounded dispatch remains an Owner/parent sequencing decision.

## Order implementation hard stop

Default trigger: after Booking V1 release/pilot Owner decision.

Earliest exception requires all of:

- BK-A closed;
- BK-B closed;
- Order Phase 0A/0B locked;
- Reuse Gate PASS;
- MT01 Bootstrap Check recorded;
- isolated Order migration/branch baseline;
- explicit Owner overlap/risk authorization.

**BOOKING CORE:** RESUME AUTHORIZED
**ORDER PHASE 0 DOCS:** COMPLETE / LOCKED
**ORDER IMPLEMENTATION:** NOT AUTHORIZED