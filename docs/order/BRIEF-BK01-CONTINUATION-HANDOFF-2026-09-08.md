# BRIEF — BK01 Continuation Handoff

**Date:** 2026-09-08 (Asia/Bangkok)
**Product:** BK01 / Booking by WSTERA
**Mode:** CONTINUATION / EVIDENCE-FIRST / HOLD-AT-GATE
**Owner:** WSTERA Owner — final authority
**Coordinator:** Secretary GPT / Booking main track

## Purpose

This file is the only handoff authority for the next BK01 chat after the 2026-09-08 work session.
Do not reconstruct the plan from chat history when this file and referenced evidence are available.

The current program has advanced substantially, but live integration remains intentionally blocked by Junction A.
The next chat must preserve the existing clean state, verify House evidence when it arrives, and continue only through the locked gate sequence below.

## Current coordinator checkpoint

- Repository: `D:\AI-Workspace\projects\saas-product-hub\products\booking`
- Branch: `feature/bk-a-v1-contract-remediation`
- HEAD: `952e380938e3731502451c58335a86f8dff08c7e`
- Origin HEAD: identical at handoff time
- Working tree: clean at handoff time
- Latest commit: `952e380 docs(booking): close pre-integration hygiene cleanup`

## Safe-lane checkpoints

- Claude branch: `feature/bk01-public-portal-claim-ui`
- Claude HEAD: `45fa3abf5a316dea622b005bfced1acf948cb8bc`
- Codex branch: `feature/bk01-order-safe-scaffold`
- Codex HEAD: `982188170f6a80ce492723786ca1e21cc2435733`
- Both branches were clean and synchronized with origin at handoff time.

## Current gate truth

**JUNCTION A:** `FAIL / ROLLED BACK`

**BK01 SHARED-RUNTIME ADMISSION:** `QUARANTINED`

**FORWARD BK01 RUNTIME MIGRATIONS:** `LOCKED`

**ORDER/CLAIM LIVE RUNTIME:** `NOT AUTHORIZED`

The prior Junction A attempt failed for two proven reasons:

1. BK01 function ownership transfer caused an auth regression because new owners could not use the managed `auth` schema as required.
2. Platform `PUBLIC` privileges exposed write-capable `net` objects to product roles, proving a shared-runtime isolation gap beyond BK01 authority.

The failed bootstrap was rolled back before product-local forward migration. Measured BK01/PS01/MT01/shared signatures returned to baseline.
Do not rerun the old bootstrap unchanged.

## House handoff

Platform remediation is delegated to WSTERA House.
Canonical House handoff:

`D:\AI-Workspace\projects\saas-product-hub\docs\platform\shared-runtime\REPORT-BK01-JUNCTION-A-PLATFORM-ISOLATION-HANDOFF-2026-09-08.md`

BK01 must wait for an explicit House result equivalent to:

`SHARED-RUNTIME PLATFORM ISOLATION PASS`

House PASS is not automatically BK01 Junction A PASS. It only authorizes BK01 to retry Junction A using new reviewed evidence.

## Safe-lane state

### Claude — Public Portal + Claim

Accepted at `45fa3abf5a316dea622b005bfced1acf948cb8bc`.
Independent verification completed:
- focused Claim/Portal tests PASS;
- full root tests PASS;
- lint 0 errors;
- production builds PASS;
- `db:bk01:verify` PASS;
- no migration/shared-runtime mutation;
- Claim production adapter remains fail-closed.

### Codex — Order V1 safe scaffold

Accepted at `982188170f6a80ce492723786ca1e21cc2435733`.
Independent verification completed:
- root tests 51/51 PASS;
- lint 0 errors;
- production builds PASS;
- `db:bk01:verify` PASS;
- Product Catalog retained copy 92/92 PASS + typecheck;
- Module Hub source at `cd88c570ab57f6976d15f85d09973d0cfbf0cd63` verified 213/213 PASS + typecheck;
- no migration/shared-runtime mutation;
- Order runtime remains fail-closed.

**JUNCTION B INPUTS:** READY

**FORMAL JUNCTION B:** BLOCKED until BK01 Junction A is freshly re-proven PASS.

## Pre-integration hygiene result

Independent audit verdict: `PASS WITH CLEANUP REQUIRED`.
Cleanup was then executed and documented.

Completed cleanup:
- removed redundant real `.env.local` copies from Claude worktree and app workspaces;
- removed coordinator app env copies while preserving coordinator root `.env.local` and `.env.staging.local`;
- removed Codex placeholder app env copies;
- removed reproducible generated `node_modules`, `.next`, `.open-next`, `.wrangler`, `next-env.d.ts`, `tsconfig.tsbuildinfo` state where authorized;
- preserved `supabase/.temp`, `.secretary-relay`, `.claude/settings.local.json`, and shared Git object database;
- no tracked source was deleted.

Canonical evidence:
- `docs/order/BK01-PRE-INTEGRATION-HYGIENE-INDEPENDENT-AUDIT-2026-09-08.md`
- `docs/order/BK01-PRE-INTEGRATION-HYGIENE-CLEANUP-EVIDENCE-2026-09-08.md`

Known carry-forward requirement:
- Order public tracking must use a distinct opaque public reference before runtime enablement; do not expose raw database identity through the current ambiguous `orderId` projection.

Catalog advisory note:
- 6 advisories are confined to copied catalog dev/test tooling;
- production audit is 0;
- do not force-upgrade this toolchain during integration.

## Owner lock — mandatory until House returns

1. Keep the BK01 repository clean.
2. Do not move schema or apply any additional WSTERA LAB migration independently.
3. Do not begin Order/Claim live integration.
4. Wait for House to issue `Junction A PASS` / platform isolation PASS evidence.
5. After House passes, BK01 must retry its own Junction A from evidence; only a fresh BK01 PASS unlocks the next phase.

While waiting:
- no integration branch;
- no new Order/Claim SQL;
- no capability enablement;
- no old bootstrap rerun;
- no PS01/MT01/shared-surface changes;
- no destructive Git maintenance;
- no production deployment.

If the next chat sees a dirty coordinator or safe-lane worktree, stop and classify the delta before continuing.
Do not reset, clean, stash, delete, or absorb unknown work blindly.

## First action when House returns

Do not accept a one-line PASS declaration.
Read the House evidence and verify at minimum:
- exact remediation commit/SHA;
- exact LAB migrations/changes;
- pre/post signatures;
- effective privilege matrix;
- negative isolation probes;
- PS01/MT01 behavior and signatures;
- rollback proof;
- explicit platform isolation PASS verdict.

## BK01 Junction A retry after House PASS

House PASS opens the retry; it does not replace it.
The next chat must:

1. refresh coordinator/source/remote SHAs and prove clean worktrees;
2. refresh LAB baseline and concurrent product movement separately;
3. design/review a new BK01 bootstrap/remediation path — never reuse the failed bootstrap unchanged;
4. address the BK01 `auth.*` function ownership/usage regression explicitly;
5. apply only through the authorized platform/product boundary;
6. rerun the same A2 isolation and Booking regression probes that failed previously;
7. compare BK01, PS01, MT01 and shared-surface signatures;
8. prove no product role can exercise unauthorized shared managed-plane writes;
9. rollback immediately if any hard probe fails;
10. record a new explicit `BK01 JUNCTION A PASS` or `FAIL / ROLLED BACK` evidence checkpoint.

No Order/Claim runtime work is allowed during this retry.
A failed or incomplete probe means Junction A remains FAIL.

## If fresh BK01 Junction A passes

Proceed immediately in this order:

1. Open Formal Junction B.
2. Reconfirm Claude/Codex branch SHAs and clean/synced state.
3. Rerun merge simulation from the then-current coordinator checkpoint.
4. Create a dedicated integration branch from that verified coordinator checkpoint.
5. Integrate Codex Order safe scaffold first.
6. Run root tests, lint, build, BK01 verify and catalog verification.
7. Integrate Claude Portal + Claim safe lane second.
8. Run full tests, lint, build, BK01 verify and security/interface review again.

Safe-lane merge does not itself enable runtime.

## Runtime sequence after safe-lane integration

Coordinator owns the common foundation first:
- capability persistence/projection for `booking_enabled`, `order_enabled`, `claim_enabled`;
- public-safe shop profile contract;
- migration identities/sequencing;
- bounded runtime authority prerequisites.

Then open separate bounded runtime lanes from the same verified integration baseline:

### Order runtime
- real Order persistence and immutable line snapshots;
- production calendar/capacity;
- atomic confirm/reserve transaction;
- idempotency and concurrency acceptance;
- opaque public tracking reference;
- Order-to-Booking link with shop consistency;
- no fake-success production adapter.

### Claim runtime
- thin public adapter over existing Ticket/Case authority;
- opaque customer-held Claim authorization/tracking;
- Booking/Order context validation;
- customer-safe projection only;
- private Ticket RLS and internal timeline remain private;
- no second Claim/Case engine.

Runtime merge order remains: Order -> Claim -> Portal final hookup.

## Final convergence

After runtime integration, execute Junction C in WSTERA LAB.
Required proof includes:
- Booking regression remains clean;
- Order capacity cannot be overbooked under concurrency;
- Order/Claim duplicate submissions are idempotent or safely rejected;
- guessed/foreign tokens fail;
- phone/email-only history enumeration fails;
- cross-shop reference substitution fails;
- Claim public view never exposes Ticket internal notes/assignee/private timeline;
- disabled capabilities refuse new intake without deleting history;
- PS01/MT01/shared signatures remain unchanged by BK01 execution;
- BK01 forward migration evidence remains product-local.

Final destination:

`JUNCTION C PASS -> READY FOR PILOT / RELEASE DECISION`

Do not describe BK01 as DONE merely because safe scaffolds merge or tests are green.

## Canonical references

- `docs/CURRENT_STATUS.md`
- `docs/order/BRIEF-BK01-COORDINATOR-BUSINESS-PORTAL-INTEGRATION-MASTER-2026-09-08.md`
- `docs/audit/BK01-SHARED-RUNTIME-JUNCTION-A-FAILURE-EVIDENCE-2026-09-08.md`
- `docs/order/JUNCTION-B-SAFE-LANE-INDEPENDENT-REVIEW-2026-09-08.md`
- `docs/order/BK01-PRE-INTEGRATION-HYGIENE-INDEPENDENT-AUDIT-2026-09-08.md`
- `docs/order/BK01-PRE-INTEGRATION-HYGIENE-CLEANUP-EVIDENCE-2026-09-08.md`
- House: `D:\AI-Workspace\projects\saas-product-hub\docs\platform\shared-runtime\REPORT-BK01-JUNCTION-A-PLATFORM-ISOLATION-HANDOFF-2026-09-08.md`

## Start-of-next-chat checklist

Before doing any work:

1. Read this file completely.
2. Read `docs/CURRENT_STATUS.md` current override sections.
3. Read the Junction A failure evidence and House handoff.
4. Run `git status -sb` and verify coordinator HEAD/origin.
5. Verify Claude and Codex safe-lane SHAs remain unchanged and clean.
6. Check whether House has returned a new evidence package.
7. If House has not returned PASS, stop at preserve/clean mode.
8. If House returned PASS, inspect evidence before touching LAB.

## Hard stop boundaries

Stop rather than improvise if:
- House evidence is incomplete or contradictory;
- a required fix would weaken PS01/MT01/shared isolation;
- Ticket private RLS must be opened for Claim;
- Order must bypass Booking availability/collision authority;
- a secret must be copied into a worktree or committed;
- a product repo would need to repair global Supabase history;
- production deployment becomes necessary;
- unknown concurrent work appears in any worktree.

## Handoff verdict

**BK01 DAY-END STATE:** SAFE / CLEAN / PRESERVED

**JUNCTION A:** FAIL / ROLLED BACK — waiting for House platform isolation PASS

**SAFE-LANE INPUTS:** READY and preserved on origin

**NEXT EXECUTION EVENT:** House return -> evidence verification -> BK01 Junction A retry

No live integration is authorized at this handoff boundary.
