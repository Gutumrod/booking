# BRIEF — BK01 Coordinator Master Path: Booking Closure -> Order + Claim -> Unified Business Portal

**Date:** 2026-09-08 (Asia/Bangkok)
**Owner:** WSTERA Owner — final authority
**Coordinator:** Secretary GPT / Booking main track
**Mode:** MASTER EXECUTION PATH / INTEGRATION AUTHORITY / EVIDENCE-FIRST
**Current coordinator branch:** `feature/bk-a-v1-contract-remediation`
**Common agent base:** `8a5fb88` — public portal + Claim integration decision locked

## Mission

Drive BK01 from the current Booking shared-runtime remediation to one coherent, testable Business Portal where a merchant can publish one customer link exposing enabled Booking, Order and Claim capabilities without weakening Booking, Ticket/Case, tenancy or WSTERA shared-runtime boundaries.

This document locks the path between the coordinator track and the two autonomous parallel tracks already dispatched to Claude Desktop and Codex Desktop.

## Final destination

The target is not merely merged code. The target is a WSTERA LAB-proven BK01 V1 Business Portal:

```text
Merchant public link: /shop/[slug]
        |
        +-- Booking -> existing Booking authority
        +-- Order   -> Order V1 authority
        +-- Claim   -> public adapter -> existing Ticket/Case authority
```

Existing `/book/[slug]` links remain compatible.
## Locked authority map

| Surface | Authority |
|---|---|
| Booking availability, staff, duration, collision, hold/deposit lifecycle | Existing Booking engine |
| Order catalog, lifecycle, production lead/capacity/ready date | Order V1 |
| Claim lifecycle/status/timeline/resolution | Existing Ticket/Case engine |
| Claim customer intake/tracking | Thin public Claim adapter |
| Public capability navigation | Business Portal |
| Shared Supabase global config/migration bootstrap | Platform/coordinator lane |
| Product-local BK01 forward migrations | Bounded BK01 migration lane |
| Subscription/billing | Existing BK01/platform billing authority; no redesign here |

No track may quietly absorb another authority for convenience.

## Three-track ownership

### Track A — Coordinator / Secretary GPT
Own Booking shared-runtime closure, migration/runtime boundary, integration governance, live LAB acceptance and final release evidence.

### Track B — Claude Desktop
Own the Public Business Portal + Claim customer surface safe lane on `feature/bk01-public-portal-claim-ui`.

### Track C — Codex Desktop
Own Order V1 domain/catalog/capacity/customer-admin safe scaffold on `feature/bk01-order-safe-scaffold`.

Claude and Codex do not merge into each other and do not mutate LAB under their current briefs.
## Current starting truth

Coordinator checkpoints already exist:

- `4a694bc` — scoped BK01 shared-runtime migration lane;
- `8a5fb88` — public portal + Claim integration decision;
- WSTERA LAB bootstrap SQL exists but has **not** yet been applied at the start of this master path;
- current live Booking behavior remains the baseline to preserve;
- Claude/Codex safe-lane briefs intentionally forbid shared DB/runtime mutation.

Do not rewrite historical Booking contracts to make Order/Claim appear retroactive. New dated decisions/addenda are authoritative only where they explicitly supersede earlier sequencing.

## Master success criteria

BK01 is complete for this path only when all of the following are true:

1. Booking remains regression-clean and shared-runtime-safe;
2. BK01 product-local migration authority is proven in LAB;
3. Order V1 is real, not a mock success path;
4. Claim uses the real Ticket/Case engine through a bounded public adapter;
5. capability flags determine which public cards/intake paths are usable;
6. one merchant public link reaches enabled Booking/Order/Claim flows;
7. public tracking never enumerates records by phone/email alone;
8. cross-shop/cross-product negative tests fail closed;
9. PS01/MT01/shared surfaces show no unauthorized collateral delta;
10. end-to-end LAB evidence supports an Owner pilot/release decision.

Production deployment is **not** implicitly authorized by this brief.
## Phase A0 — Freeze and refresh before LAB mutation

Before touching WSTERA LAB:

- confirm coordinator working tree and current HEAD;
- confirm no unexpected changes in `supabase/shared-runtime` or the BK01 runner;
- refresh live global migration history;
- refresh `local_service` owner and measured shared-surface baselines;
- identify concurrent MT01/PS01 movement separately rather than attributing it to BK01;
- verify the committed bootstrap artifact still matches the intended source.

If a concurrent change invalidates bootstrap assumptions, stop mutation and reconcile the assumption. Do not force through a stale bootstrap.

## Phase A1 — Apply BK01 platform bootstrap

Apply the exact reviewed `supabase/shared-runtime/bk01-platform-bootstrap.sql` through the platform-authorized migration mechanism.

Expected result includes:

- bounded `bk01_migrator` group role;
- independent `bk01_migrator_login` login role without embedded password;
- `local_service_internal` creation;
- product-local baseline/ledger structures;
- ownership transfer of permitted `local_service` objects;
- exact exceptions for the three platform-owned shared-surface functions;
- no PS01/MT01/global managed-surface mutation.

A failed apply is not success. Inspect transactional/partial state before any remediation.
## Phase A2 — Post-bootstrap isolation acceptance

Immediately after bootstrap, prove the boundary rather than assuming it.

Required checks:

- BK01 migration role attributes are non-superuser/non-createdb/non-createrole/non-bypassrls;
- `local_service` and `local_service_internal` ownership is correct;
- product-local baseline checksum/count/version is exact;
- product-local forward migration count begins at zero;
- BK roles have no database-wide CREATE and no public CREATE;
- BK migration roles have no PS01/PS01-internal/storage write authority;
- existing anon/authenticated/service-role Booking access shape remains unchanged;
- Booking behavior/ACL signatures match the pre-bootstrap baseline;
- PS01 owner signature is unchanged;
- Storage bucket signature is unchanged;
- cron signature is unchanged;
- exposed Data API schema set is unchanged;
- MT01 object ownership/count/signature is unchanged except independently proven MT01 work.

Run relevant Supabase security/performance advisors after DDL and separate new findings from pre-existing findings.
## Junction A — Runtime Unlock Gate

This is the first formal meeting point between the coordinator path and the two parallel lanes.

**JUNCTION A PASS** requires:

- Phase A1 bootstrap applied successfully;
- Phase A2 post-apply isolation checks pass;
- no unauthorized PS01/MT01/shared-surface delta;
- Booking regression baseline remains valid;
- BK01 product-local migration lane is usable in principle.

Only after Junction A PASS may the coordinator authorize executable Order/Claim product-local migrations or live public Claim persistence.

Junction A does **not** mean the entire product is done. It means the deployment boundary is safe enough to open the next runtime phase.

If Claude or Codex finishes before Junction A, their branches wait as verified safe-lane outputs. They do not self-unlock runtime work.

## Phase A3 — Scoped migrator credential and runner proof

Provision the `bk01_migrator_login` credential through an approved secret-management path. It must be independent from the project postgres password and must not be committed, logged or copied into client code.

Then prove:

- `npm run db:bk01:plan` authenticates as the scoped login;
- the runner uses `bk01_migrator` role inside the transaction;
- the runner reads only the BK01 product-local ledger for forward migration state;
- unrelated global Supabase migration rows do not block BK01 planning;
- checksum mismatch/foreign migration/write-scope violation fails closed;
- no URL/secret appears in logs or evidence.
## Phase A4 — Complete Booking shared-runtime closure

After the migration lane is proven, continue the Booking-specific hard gates that remain required before final coexistence PASS.

Coordinator responsibilities:

- prove/introduce a bounded BK01 runtime identity for normal privileged data-plane work if current Cloudflare/Next/PostgREST compatibility permits it;
- isolate any unavoidable project-wide managed-admin usage behind narrow reviewed operations;
- preserve the proven public `local_service` contract;
- move only genuinely internal objects into `local_service_internal` when call-path evidence and migration safety are clear;
- keep compatibility wrappers where actual consumers require them;
- register `deposit-slips` as grandfathered BK01 ownership and require `bk01-` prefix for new global assets;
- preserve platform ownership of global config, extensions, cron/net, auth/storage managed surfaces.

Do not perform cosmetic namespace churn solely to make the architecture look cleaner.

## Phase A5 — N-product coexistence proof

Run the final add-product/shared-runtime proof only after the bounded BK01 migration/runtime boundaries are established.

Prefer a safe isolated test product/fixture if needed. Real MT01 presence may provide additional evidence but does not automatically substitute for a controlled negative test.

Acceptance requires:
- independent product migration histories;
- no global ledger dependency for product-local apply;
- negative attempts against BK01/PS01/other-product/shared namespaces fail closed;
- shared/global config remains platform-owned;
- pre/post signatures for unrelated products remain unchanged.

Only then may the coordinator change the shared-runtime verdict to PASS.
## Junction B — Safe-lane convergence review

The second meeting point occurs when both external agent lanes report their current briefs complete and the coordinator has at least Junction A PASS.

Required inputs from Claude:
- branch/worktree and final SHA(s);
- Portal/Claim implementation evidence;
- threat model;
- exact runtime-blocked Claim interfaces;
- passing tests/lint/build/BK01 verify;
- confirmation of zero migration/shared-runtime mutation.

Required inputs from Codex:
- branch/worktree and final SHA(s);
- Product Catalog immutable provenance;
- Order domain/runtime-data contract;
- runtime-blocked DB acceptance list;
- passing tests/lint/build/BK01 verify/catalog tests;
- confirmation of zero migration/shared-runtime mutation.

Coordinator must independently inspect changed files and rerun critical verification. Agent declarations are evidence inputs, not automatic merge approval.

If either branch violates authority boundaries, quarantine that portion. Do not weaken Booking/security contracts to make integration easier.
## Integration branch and merge order

Do not merge Claude/Codex directly into the Booking stabilization branch.

After Junction B review, create a dedicated integration branch from the latest verified coordinator checkpoint, for example:

`integration/bk01-business-portal-v1`

Recommended safe-lane integration order:

1. integrate Codex Order domain/catalog scaffold first;
2. run root + retained catalog verification;
3. integrate Claude Portal/Claim customer surface second;
4. resolve only genuine interface conflicts; do not rewrite domain authorities;
5. run the full suite again before any runtime implementation.

Reason for this order: the Order lane establishes the concrete `/order/[slug]` and Order context contracts that the Portal can target, while Claude's Portal remains the outer customer navigation layer.

Use focused merge/cherry-pick history with source SHAs recorded in integration evidence.

If both branches changed the same shared file, resolve by authority:
- Order-domain/catalog concern -> Codex source intent;
- Portal/Claim/customer-navigation concern -> Claude source intent;
- Booking/security/shared-runtime concern -> coordinator source intent.

No conflict resolution may silently drop tests or security checks.
## Phase I1 — Runtime implementation after Junction A

Once Junction A PASS exists, runtime work may begin under new explicit phase briefs or coordinator-owned implementation commits.

### Order runtime

Implement through `supabase/bk01-migrations` and the bounded BK01 runner:

- capability persistence needed for `order_enabled`;
- Order catalog persistence/adapters;
- orders and immutable line snapshots;
- production calendar/day overrides;
- capacity reservations;
- atomic confirm/reserve transaction boundary;
- opaque public tracking token boundary;
- Order↔Booking links with shop-consistency enforcement;
- lifecycle/payment/deposit/audit RPCs required by the locked V1 contract.

Database tests must prove real concurrency/idempotency behavior; pure domain tests are not sufficient for this phase.

### Claim runtime

Do not create another claim lifecycle. Implement only the bounded public adapter required to safely create/track existing Ticket/Case records.

Required runtime behavior:
- validate `claim_enabled` server-side;
- accept Booking manage token, Order tracking token or standalone intake;
- internally create canonical Ticket/Case with customer-uncontrolled priority/due/assignee/status defaults;
- create/use an opaque public Claim tracking authorization mechanism;
- expose only a customer-safe public projection;
- retain existing private Ticket RLS and member-only management RPCs.
## Phase I2 — Live capability model and public profile

Add the live shop capability source required by the locked portal decision without exposing private shop data.

Target public behavior:

- `booking_enabled` / current booking-acceptance truth determines Booking availability;
- `order_enabled` controls new public Order intake;
- `claim_enabled` controls new public Claim intake;
- disabled capabilities disappear or render a truthful unavailable state;
- disabling a capability never deletes existing history or customer-held tracking references.

Expose only the minimal safe capability projection through the existing public-profile architecture or a similarly bounded server/public contract.

Do not restore anonymous access to the private `shops` table merely to read flags.

Capability mutation from the merchant/admin side must be authenticated, tenant-scoped and auditable.

## Phase I3 — Wire the three customer flows

After runtime adapters exist, replace fail-closed placeholders with real bounded adapters.

Required portal wiring:

```text
/shop/[slug]
   |
   +-- Booking -> /book/[slug]
   +-- Order   -> /order/[slug]
   +-- Claim   -> public Claim intake
```

Required contextual links:
- Booking manage context -> Claim;
- Order tracking context -> Claim;
- READY Order requiring appointment -> existing Booking flow;
- standalone Claim remains possible without exposing any historical record lookup.
## Phase I4 — Runtime round ownership after safe-lane merge

The current Claude/Codex briefs do not self-authorize live runtime work. After Junction A and Junction B, the coordinator opens a second bounded runtime round from the verified integration baseline.

Coordinator first owns the common foundation to prevent both agents editing the same authority:

- live capability persistence/projection;
- migration-runner sequencing and migration identity coordination;
- shared public-profile contract;
- any bounded runtime-role/config prerequisite;
- integration baseline SHA.

Then create separate runtime branches from the same verified baseline, for example:

- Codex: `feature/bk01-order-runtime`
- Claude: `feature/bk01-claim-runtime`

Codex runtime scope: Order tables/RPCs/repositories, capacity atomicity, tracking and DB acceptance.

Claude runtime scope: Claim public submit/track adapter, Booking/Order context validation, customer-safe projection and public Claim E2E.

Neither runtime branch may alter the other's lifecycle authority. Runtime migrations must have unique ordered identities and pass the BK01 migration policy.

Merge runtime work in this order:
1. Order runtime;
2. Claim runtime;
3. Portal final hookup/regression resolution.

Order comes first because Order-origin Claim context depends on a real Order tracking authority.
## Junction C — Final system integration

This is where all three tracks finally meet as one system.

Junction C requires:

- coordinator shared-runtime/coexistence gate PASS or an explicitly documented remaining non-release blocker;
- Codex Order runtime merged and DB acceptance green;
- Claude Claim runtime merged and public Claim security acceptance green;
- Portal uses the real capability source and real adapters;
- Booking remains unchanged in authority and regression behavior;
- all integration conflicts resolved under the locked authority map.

At Junction C the codebase must no longer contain production-facing fake-success adapters for Order/Claim.

## Mandatory end-to-end scenarios

Prove in WSTERA LAB with controlled test shops/customers:

1. shop with Booking only shows Booking only;
2. shop with Booking + Order + Claim shows all three;
3. disabled Order/Claim refuses new intake without deleting history;
4. ordinary Booking works as before;
5. Order submit -> confirm -> capacity reserve -> READY -> complete works;
6. concurrent Order confirmation cannot overbook capacity;
7. READY Order requiring appointment delegates to Booking and cannot bypass collision rules;
8. Booking-origin Claim creates the correct Ticket/Case through customer-held authorization;
9. Order-origin Claim creates the correct Ticket/Case through Order tracking authorization;
10. standalone Claim creates a new Ticket/Case without exposing prior history.
Continue Junction C E2E acceptance:

11. Claim customer cannot set Priority, Due Date, Assignee, internal status or Resolution;
12. phone/email alone cannot list Booking/Order/Claim history;
13. guessed/foreign Claim token is rejected;
14. guessed/foreign Order token is rejected;
15. cross-shop Booking/Order/Claim reference substitution is rejected;
16. duplicate Order/Claim submissions are idempotent or fail safely according to contract;
17. private Ticket timeline/internal notes are absent from public Claim tracking;
18. capability changes are tenant-scoped and auditable;
19. PS01/MT01/shared-surface signatures remain unchanged by BK01 execution;
20. BK01 forward migration evidence appears only in its product-local ledger as designed.

## Full verification gate

At the integrated final candidate run at minimum:

```powershell
npm test
npm run lint
npm run build
npm run db:bk01:verify
npm run db:bk01:plan
```

Also run all new Order/Claim DB acceptance suites, browser/E2E tests available in the repository, `git diff --check`, secret scan and changed-file review.

Build/test green alone is insufficient. Manual browser proof of the three public capabilities and negative security probes are required in LAB.

Any new security/performance advisor finding introduced by this work must be classified and resolved or explicitly blocked before release recommendation.
## Final Definition of Done

This master path is DONE only when:

- shared-runtime migration/config authority is enforceably separated;
- BK01 direct migration planning/apply is independent from PS01/MT01 global history;
- bounded runtime authority is proven for normal BK01 privileged operations or a documented release-blocking exception remains;
- the N-product/shared-runtime coexistence gate is PASS;
- Claude safe-lane and runtime Claim deliverables are integrated;
- Codex safe-lane and runtime Order deliverables are integrated;
- capability flags are live and public-safe;
- `/shop/[slug]` is the unified customer entry point;
- `/book/[slug]` compatibility remains;
- Order is a real persisted/atomic flow;
- Claim is a real public adapter over Ticket/Case, not a second case engine;
- Booking/Order/Claim cross-context flows pass in LAB;
- security negative tests and unrelated-product signature checks pass;
- implementation/integration evidence is complete and traceable to commit SHAs;
- Owner receives a clear `READY FOR PILOT/RELEASE DECISION` or `BLOCKED` verdict based on evidence.

Do not use `DONE` to mean "scaffold merged" or "tests green" if runtime/E2E gates remain open.

## Hard stop boundaries

Stop and escalate rather than improvising if:

- a required change would mutate PS01/MT01 ownership/history;
- a product repo must repair/absorb global Supabase migration history;
- Ticket private RLS must be weakened to make public Claim work;
- Order needs to bypass Booking collision/availability authority;
- a secret must be committed/shared in plain text;
- production deployment is required;
- Billing/Council/LINE redesign becomes necessary;
- unrelated existing work would need destructive reset/overwrite.
## Locked execution map

```text
NOW
 |
 |-- Coordinator: Booking shared-runtime bootstrap/isolation
 |-- Claude: Portal + Claim safe lane
 |-- Codex: Order safe scaffold
 |
 +--> JUNCTION A: bootstrap + isolation PASS
 |       |
 |       +--> runtime work becomes eligible
 |
 +--> JUNCTION B: Claude/Codex safe lanes reviewed
         |
         +--> integration/bk01-business-portal-v1
               |
               +-- Codex safe scaffold merge
               +-- Claude Portal/Claim merge
               +-- Coordinator capability/runtime foundation
               |
               +-- Codex Order runtime round
               +-- Claude Claim runtime round
               |
               +--> JUNCTION C: full system integration
                       |
                       +-- LAB E2E + security + coexistence proof
                       |
                       +--> READY FOR PILOT/RELEASE DECISION
```

## Coordinator reporting checkpoints

Record evidence after A1/A2, A3, shared-runtime final PASS, Junction B review, each runtime merge, and Junction C final acceptance.

Each checkpoint must include source/target SHAs, commands/results, live environment touched, explicit non-BK surfaces compared, unresolved blockers and next authorized action.
## Authority lock

This master path is the coordinator execution authority for the current BK01 Booking -> Order + Claim convergence program.

It does not authorize production deployment, unrelated feature expansion, Billing redesign, Council work, or destructive history repair.

Where sequencing conflicts with the older 2026-09-05 default "Booking release first, Order later" rule, the explicit Owner bounded-parallel decision dated 2026-09-08 controls only within the boundaries documented here.

**MASTER PATH:** LOCKED

**FINAL DESTINATION:** Unified BK01 Business Portal proven in WSTERA LAB and ready for Owner pilot/release decision.

**FINAL CONVERGENCE:** Junction C after coordinator shared-runtime closure + Codex Order runtime + Claude Claim runtime are integrated and independently verified.
## Execution checkpoint — Junction A attempt 2026-09-08

The first live Junction A attempt was executed and **FAILED A2**. This checkpoint supersedes any assumption in this master path that the reviewed bootstrap is currently safe to re-apply.

- A0 refresh confirmed concurrent MT01 migrations and preserved BK01/PS01/shared baselines.
- `bk01_platform_bootstrap` was applied through the platform migration lane.
- A2 reproduced a real Booking regression after function ownership transfer: `permission denied for schema auth` in `local_service.is_shop_member`.
- A2 also proved product roles inherit write-capable access to shared `net` objects from platform `PUBLIC` ACLs; this is a platform-level isolation gap also observable on PS01 roles.
- No PS01/MT01 product ownership/history was modified by BK01 remediation.
- No BK01 product-local forward migration was applied.
- `bk01_platform_bootstrap_rollback` restored the measured pre-bootstrap state and removed BK01 migration roles/internal schema.
- PS01, MT01 and measured shared-surface signatures matched the A0 baseline after rollback.

**JUNCTION A:** FAIL / ROLLED BACK

**RUNTIME UNLOCK:** DENIED. Phases I1-I4 and live Order/Claim migrations remain blocked.

Do not rerun the current bootstrap. Resolve the platform shared-runtime isolation model and the BK01 `auth.*` function ownership model first, then issue a new reviewed bootstrap/remediation checkpoint.

Canonical evidence: `docs/audit/BK01-SHARED-RUNTIME-JUNCTION-A-FAILURE-EVIDENCE-2026-09-08.md`.
