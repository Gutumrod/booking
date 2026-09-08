# BK01 Shared-Runtime Pre-Build Gate

**Date:** 2026-09-08
**Product:** BK01 / Booking
**Scope:** shared-runtime migration/config isolation remediation only
**Owner authorization:** explicit execution approval received 2026-09-08
**Source assessment:** `docs/audit/BK01-SHARED-RUNTIME-COEXISTENCE-ASSESSMENT-2026-09-08.md`

## Gate Result

`Module Reuse Check: COMPLETE`

`MT01 Bootstrap Check: PASS`

`Reuse Gate: PASS`

Implementation may proceed only inside the migration/config/runtime authority boundary defined below. This does not authorize Billing, LINE redesign, Order work, Production mutation, PS01 source changes, or unrelated refactoring.

## Source-of-Truth Findings

- BK01 product/API schema remains `local_service`.
- Proposed BK01 internal schema remains `local_service_internal`.
- Standard product `supabase db push` is already incompatible with the shared project because the global ledger contains PS01 history absent from BK01.
- Product-local `supabase config push` is unsafe because Data API exposed schemas are project-global.
- Current privileged BK01 application paths still rely on project-wide `service_role`; runtime identity remediation is a separate bounded step after migration-plane closure.

## MT01 Bootstrap Check

MT01 was inspected as the required internal bootstrap reference.

| Baseline area | Evidence inspected | Decision |
|---|---|---|
| tenant / trust boundary | `products/multi-tenant-ai/modules/tenant-context`, server middleware docs | reference only; no cross-repo runtime dependency |
| Supabase auth | `modules/auth-supabase`, reference server | reference only; BK01 existing auth/RLS contract is preserved |
| persistence / migrations | MT01 README and current continuation docs | no reusable DB migration runner exists; MT01 itself still lacks the completed persistence package |
| billing / entitlement | MT01 seams | NOT APPLICABLE to this remediation; central/product billing boundaries remain unchanged |
| webhook | MT01 webhook receiver | NOT APPLICABLE; this work does not change webhook behavior |
| central platform seam | platform boundary docs | platform owns shared-project global configuration and bootstrap authority |

MT01 does not supply the missing shared-runtime migration runner and therefore is not copied into BK01.

## Module Reuse Check

Module Hub was searched for migration, database bootstrap, advisory-lock, and PostgreSQL runner capabilities. No canonical DB migration runner exists. `modules/audit-log/DESIGN.md` explicitly documents that its adapter does not provide a DB migration runner.

PS01 shared-runtime artifacts were also inspected as proven WSTERA implementation evidence. Their bounded-role/product-ledger pattern is suitable as an architecture reference, but PS01 source is not modified or imported.

### Capability Decisions

| Capability | Candidate inspected | Classification | Technical reason |
|---|---|---|---|
| shared-project global migration/config lane | platform shared-runtime plan + Supabase CLI behavior | NOT APPLICABLE to BK01 product ownership | project-global state must have one platform authority, not a product repo |
| product-local migration ledger/lock | PS01 bounded migration pattern | USE + ADAPT pattern | proven WSTERA approach; BK01 needs its own namespace, checksum contract and runner |
| DB migration runner | Module Hub + MT01 | MISSING CAPABILITY | no canonical runner exists; standard Supabase global history is the reproduced failure mode |
| bounded migration role | PS01 `ps01_migrator` pattern | USE + ADAPT pattern | enforceable DDL boundary is required for N-product coexistence |
| bounded application runtime role | PS01 runtime pattern | DEFERRED WITH GATE | BK01 Cloudflare/PostgREST call paths need separate compatibility proof before credential cutover |
| shared Storage mutation | existing BK01 bucket + platform managed surface | NOT APPLICABLE to product runner | managed through platform lane only |

## Implementation Boundary

Phase C1 creates the platform authority contract and product guardrails.

Phase C2 creates the BK01 product-local migration stream, validator, ledger contract, and bounded migration role bootstrap.

Phase C3 records the accepted legacy BK01 baseline without replaying or rewriting the global Supabase migration history.

Only after C1-C3 pass may the previously assessed `local_service_internal` object split begin. Runtime `service_role` removal remains a required independent proof before final shared-runtime PASS.

No Module Hub source is copied, so no provenance record is required for this implementation.
