# BK01 Junction B Safe-Lane Independent Review

**Date:** 2026-09-08 (Asia/Bangkok)
**Reviewer:** BK01 Coordinator / Secretary GPT
**Coordinator checkpoint:** `e49f3e2`
**Authority:** `BRIEF-BK01-COORDINATOR-BUSINESS-PORTAL-INTEGRATION-MASTER-2026-09-08.md`

## Verdict

**SAFE-LANE INPUT REVIEW:** PASS

**FORMAL JUNCTION B:** BLOCKED BY JUNCTION A FAIL

**MERGE / RUNTIME UNLOCK:** NOT AUTHORIZED YET

Both external implementation lanes are complete, clean, independently verified, and preserved on origin. Neither lane mutated Supabase migrations or the shared runtime. Their code/interface outputs are suitable as Junction B inputs once the platform/BK01 Junction A blocker is resolved.

This review does not override `docs/audit/BK01-SHARED-RUNTIME-JUNCTION-A-FAILURE-EVIDENCE-2026-09-08.md`.

## Reviewed branches

| Lane | Branch | Final SHA | Remote |
|---|---|---|---|
| Claude Portal + Claim | `feature/bk01-public-portal-claim-ui` | `45fa3abf5a316dea622b005bfced1acf948cb8bc` | pushed |
| Codex Order safe scaffold | `feature/bk01-order-safe-scaffold` | `982188170f6a80ce492723786ca1e21cc2435733` | pushed |

Both branches derive from common base `8a5fb8852edb8af7aef7d2ce8338c0a2928d646a`.
## Claude lane — independently verified

Reviewed real changed files including:

- `/shop/[slug]` public portal;
- `/shop/[slug]/claim` intake;
- `/claim/track` tracking;
- Booking → Claim entry point;
- `public-portal.ts` capability model;
- `public-claim.ts` adapter/security contract;
- threat model and runtime handoff.

Independent verification:

- `node --test tests/public-portal-claim.test.ts` → **16/16 PASS**;
- `npm test` → **43/43 PASS**;
- `npm run lint` → **0 errors**, pre-existing warnings only;
- `npm run build` → **PASS** for consumer and admin;
- `npm run db:bk01:verify` → **PASS**;
- `git diff --check` → clean;
- migration/shared-runtime diff → empty.

Security/result review confirms the production Claim adapter remains fail-closed and cannot fabricate a claim id/success. Existing Ticket/Case remains lifecycle authority and no Ticket RLS/grant was broadened.
## Codex lane — independently verified

Reviewed real changed files including:

- Order lifecycle/payment/deposit domain;
- shop-scoped runtime ports;
- capacity/readiness calculations;
- Booking-link delegation contract;
- customer/admin fail-closed Order surfaces;
- Product Catalog copy-and-own boundary;
- security helpers and Order acceptance tests.

Independent verification:

- `npm test` → **51/51 PASS**;
- `npm run lint` → **0 errors**, pre-existing warnings only;
- `npm run build` → **PASS** for consumer and admin;
- `npm run db:bk01:verify` → **PASS**;
- `npm run verify:order:catalog` → **92/92 PASS + typecheck PASS**;
- `git diff --check` → clean;
- migration/shared-runtime diff → empty.

Order production adapters remain fail-closed. No live submit, persistence, capacity reservation, tracking or Booking-link mutation is claimed.
## Product Catalog provenance check

Canonical Module Hub source was inspected directly:

- source repo: `D:\AI-Workspace\projects\modules-hub`;
- source HEAD: `cd88c570ab57f6976d15f85d09973d0cfbf0cd63`;
- module: `modules/product-catalog`;
- module version: `0.1.0`.

Source verification was rerun independently:

- source tests → **213/213 PASS**;
- source typecheck → **PASS**.

The vendored BK01 `order/catalog/core` has no content diff from the Module Hub source core. Shared root files `VERSION`, `package.json`, `tsconfig.json`, and `vitest.config.ts` also match by SHA-256. Excluded CSV/local-filesystem adapters are intentionally outside the BK01 copy as documented.

The copied catalog test toolchain currently reports six audit findings (3 moderate, 1 high, 2 critical) in test/dev dependencies. These are not production dependencies, but must remain visible as dependency-maintenance debt; no breaking `audit fix --force` was run.

## Cross-lane interface review

No changed-file overlap exists between the Claude and Codex branches.

Claude Portal targets `/order/[slug]`; Codex provides exactly `/order/[slug]`. Claude Order-origin Claim context accepts an opaque tracking token shape compatible with the current Codex `trk_*` contract.
## Locked runtime follow-ups

The following remain mandatory before either safe lane may become live runtime:

1. Junction A must be re-proven PASS after House/platform remediation and BK01 auth-ownership remediation.
2. Order confirmation/capacity/idempotency must be enforced transactionally in PostgreSQL; sequential TypeScript helpers are not concurrency proof.
3. Claim submit/tracking must use the existing Ticket/Case engine through bounded public RPCs with no Ticket table exposure.
4. Cross-shop negative probes must execute against the live DB boundary.
5. Capability flags must come from a bounded public projection, not private `shops` access.
6. Order public tracking must return a customer-safe public reference. The current scaffold helper `publicOrderProjection()` uses the field name `orderId`; runtime implementation must prove this is not a raw database UUID or replace the contract with an explicit opaque/public reference before enablement.
7. Phone/email alone must never enumerate Order or Claim history.

## Merge decision

Do **not** merge either lane into the coordinator branch while Junction A remains FAIL.

Do **not** create the final integration/runtime baseline merely to make progress appear complete.

Once House returns the required Platform Isolation PASS evidence and BK01 re-passes Junction A, create the dedicated integration branch from the latest verified coordinator checkpoint and integrate in the locked order:

1. Codex Order safe scaffold (`9821881`);
2. full verification;
3. Claude Portal + Claim safe lane (`45fa3ab`);
4. full verification;
5. coordinator capability/runtime foundation;
6. bounded Order/Claim runtime rounds.

## Coordinator result

**CLAUDE SAFE LANE:** ACCEPTED

**CODEX SAFE LANE:** ACCEPTED

**JUNCTION B INPUTS:** READY AND PRESERVED

**FORMAL JUNCTION B / INTEGRATION:** WAITING ON JUNCTION A PASS