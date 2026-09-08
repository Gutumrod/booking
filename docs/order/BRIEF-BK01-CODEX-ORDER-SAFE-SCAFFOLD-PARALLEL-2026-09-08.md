# BRIEF — BK01 Codex Desktop: Order V1 Safe Scaffold + Catalog Adaptation

**Date:** 2026-09-08 (Asia/Bangkok)
**Owner:** WSTERA Owner
**Executor:** Codex Desktop
**Mode:** AUTONOMOUS / BOUNDED PARALLEL / ORDER DOMAIN TRACK
**Base checkpoint:** `8a5fb88` — `docs(booking): lock public portal and claim integration`

## Mission

Implement the maximum safe portion of BK01 Order V1 in parallel with Booking stabilization: copy-and-own the canonical Product Catalog capability, build the Order domain and pure readiness/capacity logic, establish typed runtime ports, and prepare customer/admin scaffolding without mutating shared Supabase runtime.

This brief is explicit Owner authorization to execute the listed safe scope end-to-end. Do not pause for routine confirmation. Investigate source truth, fix defects inside scope, rerun tests, and continue until the Goal/acceptance boundary is reached.

## Goal

Deliver a tested Order V1 codebase scaffold that is ready for the later product-local migration/runtime implementation immediately after the BK01 shared-runtime gate passes.

The safe-lane result must prove domain behavior in code and tests without falsely claiming database atomicity or live Order availability.

Target product flow remains:

```text
Catalog -> Ready-date -> Customer -> Deposit evidence -> Submit/Confirm
-> Track Order -> READY -> Pickup/Delivery OR Booking when appointment required
```

## Mandatory isolation before work

Do not work in the current BK01 working tree and do not share Claude's worktree.

Recommended branch:
`feature/bk01-order-safe-scaffold`

Recommended worktree:
`D:\AI-Workspace\worktrees\bk01-codex-order-safe-scaffold`

If neither exists:

```powershell
git worktree add D:\AI-Workspace\worktrees\bk01-codex-order-safe-scaffold -b feature/bk01-order-safe-scaffold 8a5fb88
```

If an existing branch/worktree is present, inspect before reuse. Never destroy unknown work, force-reset another agent's branch, or work around conflicts by copying dirty files manually.

Record before edits:
- `git status --short --branch`
- `git rev-parse HEAD`
- `git log -5 --oneline`
- active worktree path

Do not modify the source Booking stabilization worktree or Claude's Portal/Claim branch.

## Source of truth — read before implementation

Read in full:

1. `AGENTS.md`
2. relevant Codex/project instructions in repo
3. `docs/order/00_PRODUCT_BOUNDARY_DECISION_2026-09-05.md`
4. `docs/order/01_ORDER_V1_CONTRACT.md`
5. `docs/order/02_MODULE_REUSE_CHECK.md`
6. `docs/order/03_MT01_BOOTSTRAP_CHECK.md`
7. `docs/order/03_PUBLIC_PORTAL_CLAIM_AND_PARALLEL_EXECUTION_DECISION_2026-09-08.md`
8. `docs/order/04_PHASE0_HANDOFF.md`
9. current Booking consumer/admin architecture used for tenancy, public shop profile and tests
10. parent `docs/platform/MODULE-REUSE-POLICY.md`
11. canonical Module Hub Product Catalog source and its own tests/docs

Do not trust the Phase 0 module hash blindly. Recheck the current immutable source commit at implementation time and record exactly what is copied.

## Locked boundaries

- Order is additive to Booking, not a replacement Booking engine.
- Booking remains sole authority for appointment date/time/provider/duration/collision.
- Order catalog is separate from Booking `services`.
- Order payment state is operational state, not a subscription/billing/payment engine.
- Order V1 has no inventory/warehouse/ERP/POS/shipping/BOM engine.
- Claim/Case lifecycle is out of this track and remains owned by existing Ticket/Case via the separate Claim adapter decision.

## Hard boundaries — never cross in this brief

Do not:
- apply or create live shared-runtime migrations;
- edit `supabase/migrations` or `supabase/bk01-migrations`;
- call `supabase db push`, `migration repair`, `db pull`, `config push` or reset;
- mutate WSTERA LAB/Production;
- create live Order tables/RPCs/policies/grants/roles;
- change Booking hold/availability/collision/deposit lifecycle to accommodate Order;
- introduce stock reservation/inventory semantics from Product Catalog;
- introduce a second payment/Claim engine;
- cross-import Module Hub at runtime;
- copy module code into both apps separately;
- expose secrets or service-role credentials;
- merge/push to Booking stabilization or Claude branches.

If DB atomicity is required to prove a requirement, specify the exact future DB acceptance test and mark it runtime-blocked. Do not simulate a passing database proof and call it complete.

## Phase 1 — Product Catalog source recheck and copy-and-own

Inspect `D:\AI-Workspace\projects\modules-hub` directly. Confirm canonical Product Catalog version/status/source commit and rerun its relevant test/typecheck commands.

If the canonical module has advanced since the previously inspected `cd88c570...`, review the newer source and use the actual compatible immutable commit. Do not blindly copy the old hash.

Copy only the required catalog domain capability into BK01 under one owned shared location that can later serve both consumer/admin without duplication. Prefer a root workspace package if it fits the current npm-workspace topology; otherwise choose the smallest single owned location and document why.

Record provenance adjacent to the copied capability:

```text
module: product-catalog
source_repo: D:\AI-Workspace\projects\modules-hub
source_version: <actual version>
source_commit: <actual immutable commit>
copied_at: 2026-09-08
local_changes: BK01 shop_id mapping; Order attributes; Supabase adapter ports; inventory disabled
```

Preserve useful upstream tests/types. Do not copy CSV/local-filesystem production adapters merely because they exist upstream.

BK01 adaptation must support catalog master concepts required by Order while explicitly suppressing inventory semantics in V1.

## Phase 2 — Order domain package/core

Create a framework-independent Order domain core usable from server/UI adapters.

Required canonical lifecycle:
- `DRAFT`
- `SUBMITTED`
- `CONFIRMED`
- `IN_PROGRESS`
- `READY`
- `COMPLETED`
- `CANCELLED`

Required operational payment state:
- `UNPAID`
- `PARTIALLY_PAID`
- `PAID`
- `REFUNDED`

Required deposit verification state:
- `PENDING`
- `VERIFIED`
- `REJECTED`

Keep lifecycle/payment/deposit state domains separate in types and transition logic.

Implement/test:
- valid/invalid Order lifecycle transitions;
- terminal-state handling;
- explicit reopen/recovery contract rather than silent mutation;
- fulfillment type: `PICKUP | DELIVERY | ON_SITE_SERVICE`;
- explicit `appointmentRequired`;
- immutable order-line snapshot value objects;
- money/quantity validation without floating-point ambiguity where practical;
- cross-shop identity carried explicitly in domain/repository contracts.

Catalog edits after confirmation must not mutate the order-line snapshot object used by historical Orders.

## Phase 3 — Ready-date and production-capacity pure logic

Implement deterministic domain functions for the locked V1 semantics:

```text
Lead Time
+ Workshop Calendar
+ Available Production Capacity
= Earliest Available Ready Date
```

Rules:
- required capacity = `SUM(qty * capacity_units_snapshot)`;
- required lead = `MAX(lead_days_snapshot)`;
- V1 reserves one target production day per confirmed Order;
- closed days and explicit day overrides are respected;
- customer UI never exposes raw capacity units;
- existing confirmed promises are not silently recomputed by later settings changes.

Model/test inputs for:
- weekly working calendar;
- date overrides/closures;
- base/effective capacity;
- already reserved units;
- required lead days;
- requested ready date where provided.

Pure code may calculate/validate a reservation decision, but do not claim concurrent database safety from pure unit tests.

## Phase 4 — Runtime ports and atomicity contract

Define typed ports/interfaces for later live implementation, for example responsibilities equivalent to:
- catalog read repository;
- Order repository;
- capacity/calendar repository;
- atomic confirmation/reservation operation;
- public submit/idempotency store;
- Order tracking lookup by opaque token;
- Order↔Booking link service.

Do not implement these with live Supabase writes in this branch.

Document the future authoritative transaction requirement: successful `CONFIRMED` must atomically persist immutable line snapshots, computed totals/deposit, selected production date, capacity reservation and promised ready date.

Document mandatory future DB probes:
1. concurrent confirms cannot exceed capacity;
2. retry cannot reserve twice;
3. cancellation before production releases exactly once;
4. cross-shop catalog/order/link IDs fail;
5. settings race resolves under one lock/transaction strategy;
6. partial failure cannot return successful confirmation.

These remain **RUNTIME-BLOCKED**, not failed and not falsely passed.

## Phase 5 — Customer Order surface scaffold

Prepare the customer route contract expected by the Public Portal, preferably:

`/order/[slug]`

Build production-shaped UI/components for:
- catalog browsing/selection;
- quantity selection within V1 constraints;
- ready-date availability presentation;
- customer details;
- fulfillment selection;
- summary/snapshot preview;
- tracking entry/result components.

The production adapter must fail closed/unavailable while Order runtime is not live. Test fixtures/in-memory adapters may demonstrate the flow only in tests/dev-isolated contexts and must be unmistakably non-production.

No fake order number, fake successful payment, fake capacity reservation or fake tracking success may be returned by the production path.

Coordinate route/interface shape with Claude's Portal lane through documentation/types only; do not modify Claude's branch.

## Phase 6 — Merchant/admin scaffold

Prepare only the minimum Order administration structure needed to make later runtime hookup straightforward: catalog/order settings interfaces, production calendar/capacity settings model, Order list/detail view-model contracts and lifecycle action boundaries.

Do not build a generic ERP/admin suite. Keep admin scope bounded to Order V1 contract.

Merchant actions must be modeled so future live implementation can enforce:
- confirm/reject/cancel according to lifecycle;
- start production;
- mark READY;
- complete;
- explicit ready-date override with actor/reason audit requirement;
- payment/deposit review without becoming payment gateway authority.

## Phase 7 — Order ↔ Booking integration contract

Prepare a narrow interface; do not duplicate Booking scheduler logic.

Rules:
- an appointment may be created only when Order is `READY`;
- Order needing installation/service uses `ON_SITE_SERVICE` + `appointmentRequired=true`;
- Booking creation delegates to the existing Booking availability/collision authority;
- Order gets no priority or collision bypass;
- one Order may link to multiple Bookings;
- Booking completion does not auto-complete Order;
- Booking and Order payment/deposit states remain independent.

The interface must support idempotent logical link creation later. Document the future cross-shop FK/authorization requirement.

Do not edit core Booking RPCs or availability implementation in this branch.

## Testing required

Add focused automated tests for at least:
1. valid and invalid lifecycle transitions;
2. lifecycle/payment/deposit states cannot be conflated;
3. line snapshots remain unchanged when catalog source objects change;
4. required lead uses the maximum line lead;
5. capacity uses quantity × snapshotted units;
6. closed day/override handling;
7. earliest-ready selection skips insufficient-capacity days;
8. requested date earlier than feasible date is handled truthfully;
9. simulated sequential reservation decisions do not accept over-capacity state;
10. cancel/release domain decision is lifecycle-aware;
11. Order requiring appointment cannot bypass READY state;
12. Order→Booking contract preserves Booking authority;
13. production adapter cannot return fake success while runtime is disabled;
14. inventory semantics are not activated by the catalog adaptation;
15. cross-shop identifiers are explicit in repository/service contracts.

Use an in-memory repository only for tests/domain demonstrations when useful. Label it test/dev-only; it is not production persistence evidence.

Preserve or adapt upstream Product Catalog tests where they remain meaningful after copy-and-own.

## Security/design checks

Before completion review the scaffold for:
- server/client trust boundary;
- opaque tracking-token contract;
- no phone-only enumeration design;
- tenant/shop ID present at every repository boundary;
- no raw private Order object projected to public tracking;
- no customer-controlled internal lifecycle/payment verification fields;
- idempotency key ownership and retry semantics;
- future audit actor/reason requirements for privileged overrides;
- no service-role or provider secrets in client code.

Create a concise future migration/data-contract document that maps the domain to conceptual entities from the locked contract without writing executable migration SQL in this branch.

The document should specify expected tables/relationships/index/uniqueness/transaction invariants sufficiently for the post-gate runtime phase, while leaving exact SQL to that authorized phase.

## Verification before completion

Run from the isolated worktree:

```powershell
npm ci
npm test
npm run lint
npm run build
npm run db:bk01:verify
```

Also run:
- the copied Product Catalog's relevant retained tests/typecheck;
- `git diff --check`;
- `git status --short --branch`;
- secret-pattern review of changed files;
- `git diff --name-only -- supabase/migrations supabase/bk01-migrations` and require empty output.

Do not remove tests or weaken invariants to get green output. New lint/build/type errors are blockers for this lane.

## Required deliverables

Code plus:
- copy-and-own provenance record for Product Catalog;
- `docs/order/CODEX-ORDER-SAFE-SCAFFOLD-EVIDENCE-2026-09-08.md`;
- `docs/order/ORDER-RUNTIME-DATA-AND-ATOMICITY-CONTRACT-2026-09-08.md`;
- concise Claude integration handoff defining `/order/[slug]` and future Order→Claim context/token interface;
- explicit list of post-shared-runtime migrations/RPCs/tests still required.

Evidence must contain:
- source/base SHA and worktree/branch;
- actual Module Hub source version/commit copied;
- files changed;
- commands and exit codes;
- domain requirements proven now;
- runtime requirements intentionally not claimed;
- final commit SHA(s).

## Definition of Done — Codex lane

This lane is DONE only when all are true:

- isolated branch/worktree starts from `8a5fb88`;
- canonical Product Catalog was rechecked, verified and copied with immutable provenance;
- no cross-repo runtime import exists;
- Order lifecycle/payment/deposit/snapshot domain is implemented and tested;
- production ready-date/capacity rules are represented in deterministic pure logic and tests;
- runtime ports and authoritative transaction requirements are explicit;
- customer `/order/[slug]` surface is production-shaped but truthfully fail-closed without runtime;
- minimum merchant/admin Order interfaces are prepared without ERP/inventory expansion;
- Order↔Booking contract delegates all appointment authority to Booking;
- future DB concurrency/isolation tests are written as required gates, not falsely marked PASS;
- no migration/shared-runtime mutation exists;
- root tests, lint, build, BK01 verify and retained catalog tests pass;
- evidence/data-contract/integration handoff documents are complete.

## Commit / handoff rule

Local commits are authorized after verification. Keep commits focused on this branch. Suggested final message:

`feat(booking): scaffold order domain and catalog integration`

Do **not** merge into Booking stabilization or Claude branches and do **not** push unless separately authorized by Owner/coordinator.

When complete report: branch/worktree, commit SHA(s), module provenance, implemented domain scope, verification results, runtime-blocked items, and real defects/risks found. Do not declare Order live or database concurrency proven.
