# BRIEF — BK01 Claude Desktop: Public Business Portal + Claim Customer Surface

**Date:** 2026-09-08 (Asia/Bangkok)
**Owner:** WSTERA Owner
**Executor:** Claude Desktop
**Mode:** AUTONOMOUS / BOUNDED PARALLEL / CUSTOMER SURFACE TRACK
**Base checkpoint:** `8a5fb88` — `docs(booking): lock public portal and claim integration`

## Mission

Build the customer-facing BK01 Business Portal and Claim surface as far as safely possible **without waiting for the Booking shared-runtime gate**, while preserving all current Booking/Ticket security authorities.

This brief is explicit Owner authorization to execute the scope below end-to-end. Do not stop for routine intermediate confirmation. Fix defects discovered inside this scope, rerun verification, and continue until the Goal/acceptance boundary is reached.

## Goal

Deliver a production-shaped, locally verified customer surface where one merchant link can become the BK01 public entry point for enabled capabilities:

```text
Public Shop Link
├── Booking
├── Order
└── Claim
```

At completion of this lane, Portal + Claim UX, interfaces, tests and security boundaries must be ready for live runtime hookup. Do **not** fake successful Order/Claim persistence while the runtime gate is closed.

## Mandatory isolation before work

Do not work in the current BK01 working tree. Create or reuse only an isolated clean worktree/branch from the exact base checkpoint.

Recommended branch:
`feature/bk01-public-portal-claim-ui`

Recommended worktree:
`D:\AI-Workspace\worktrees\bk01-claude-public-portal-claim`

If neither exists:

```powershell
git worktree add D:\AI-Workspace\worktrees\bk01-claude-public-portal-claim -b feature/bk01-public-portal-claim-ui 8a5fb88
```

If branch/worktree already exists, inspect it first. Never delete, reset, overwrite or absorb unknown work just to recreate this branch. Stop only if existing conflicting work cannot be safely separated.

Before edits record:
- `git status --short --branch`
- `git rev-parse HEAD`
- `git log -5 --oneline`
- active worktree path

Do not modify the source worktree on `feature/bk-a-v1-contract-remediation`.

## Source of truth — read before implementation

Read in full before changing code:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/order/00_PRODUCT_BOUNDARY_DECISION_2026-09-05.md`
4. `docs/order/01_ORDER_V1_CONTRACT.md`
5. `docs/order/02_MODULE_REUSE_CHECK.md`
6. `docs/order/03_PUBLIC_PORTAL_CLAIM_AND_PARALLEL_EXECUTION_DECISION_2026-09-08.md`
7. `TICKET_MIGRATION_HANDOFF.md`
8. `TICKET_SERVICE_HANDOFF.md`
9. current `apps/booking-consumer/src/app/book/[slug]/page.tsx`
10. current `apps/booking-consumer/src/app/manage-booking/page.tsx`
11. current consumer booking service/Supabase adapters used by the public flow

Treat implementation and current migrations as evidence. Historical handoffs are inputs, not proof by declaration.

## Locked product decisions

- One public merchant entry point exposes only capabilities enabled for that shop.
- Booking remains the only authority for appointment availability/collision/lifecycle.
- Claim is **not** a new lifecycle engine; Ticket/Case remains authoritative.
- Existing `create_ticket` remains authenticated shop-member only.
- `anon` must never receive direct private Ticket/Case reads or generic ticket mutation power.
- Phone/email alone must never enumerate Booking/Order/Claim history.
- Order/Claim tracking uses opaque, non-sequential customer-held tokens.

## Hard boundaries — never cross in this brief

Do not:
- apply Supabase migrations or mutate WSTERA LAB/Production;
- create live Order/Claim tables, RPCs, roles, policies or grants;
- edit `supabase/migrations` or `supabase/bk01-migrations`;
- weaken Ticket RLS or grant `anon` access to private ticket tables/RPCs;
- change Booking collision, hold, deposit, availability or lifecycle authority;
- replace Ticket/Case with a second Claim lifecycle;
- implement a second payment engine;
- expose service-role secrets/client secrets;
- merge branches or push to the protected/current BK01 branch;
- touch PS01/MT01 source or shared-runtime platform configuration.

If a correct implementation requires one of those actions, document the blocker and STOP that specific subtask only. Continue all other safe tasks.

## Public route architecture

Use an additive canonical public portal route, preferably:

`/shop/[slug]`

Preserve `/book/[slug]` compatibility. Do not redirect or rewrite the established Booking route in a way that risks existing links.

Portal cards should be generated from a typed capability model, not hard-coded UI assumptions.

### Capability model

Create a narrow consumer-facing contract such as:

```ts
type PublicShopCapabilities = {
  bookingEnabled: boolean;
  orderEnabled: boolean;
  claimEnabled: boolean;
};
```

Production behavior while runtime flags do not yet exist:
- Booking may derive from the current truthful public booking signal (`is_accepting_online_bookings`) where appropriate.
- Order and Claim must default fail-closed/disabled unless a real server-side capability source exists.
- Tests/dev fixtures may inject enabled states explicitly, but fixture state must never leak into production paths.
- Never show a clickable capability that returns fake success.

Portal must handle:
- all three enabled;
- any one/two enabled;
- all disabled;
- shop not found;
- loading/error state;
- disabled capability historical links without deleting history.

The UI should clearly explain each capability in merchant/customer language rather than internal engine names.

## Claim customer experience to build

Build the public Claim UX as a real customer surface, but keep persistence fail-closed until the runtime adapter is authorized.

Required entry modes:
1. Claim from an existing Booking/manage context.
2. Claim from an Order/tracking context (interface/route ready even if Order runtime is not live yet).
3. Standalone Claim with no Booking/Order reference.

Customer-visible inputs should stay minimal:
- customer name;
- contact phone and/or supported contact channel;
- claim category/type;
- related service/product text when no verified reference exists;
- issue description;
- optional occurred date/time if useful;
- optional attachment UI only if it can be implemented without inventing a storage authority.

Do not expose internal fields such as Priority, Due Date, Assignee, internal status controls or Resolution editing.

Map customer language to existing Ticket types without changing the canonical Ticket enum. Example categories may map to `ProductClaim`, `ServiceIssue`, `RecheckRequest`, `RefundRequest`, or `Other`.

## Public Claim adapter contract

Create a thin interface between UI and future live runtime. Keep it explicit enough that the later DB implementation can be swapped in without rewriting the customer flow.

At minimum define operations conceptually equivalent to:

```ts
getPublicClaimContext(...)
submitPublicClaim(...)
getPublicClaimTracking(...)
```

Requirements:
- server boundary validates shop slug/id and `claimEnabled`;
- Booking-origin claims accept only a valid customer-held Booking/manage token, not a naked booking ID;
- Order-origin claims accept only a valid Order tracking token once Order runtime exists;
- standalone submission does not grant access to any pre-existing private history;
- duplicate/retry semantics have an explicit idempotency input/contract;
- returned public data is a minimum projection, never a raw Ticket row.

Until the authorized live adapter exists, the concrete production adapter must return a truthful unavailable/not-enabled result such as `CLAIM_RUNTIME_NOT_ENABLED`; never fabricate an ID or successful claim state.

Document the expected future mapping into the existing Ticket/Case authority, including default internal fields that the customer must not control.

## Claim tracking UX and security

Prepare the route/component contract for tracking a submitted claim with an opaque customer-held token.

Public tracking may expose only customer-useful fields such as:
- public claim reference;
- coarse customer-facing status;
- submitted/updated timestamps;
- merchant-safe customer message if explicitly part of the future adapter contract.

It must not expose:
- assignee/internal actor identity;
- internal notes/timeline entries;
- private phone search results;
- other claims belonging to the same phone/customer;
- raw database UUID as the sole authorization secret;
- shop-private audit or resolution details not intended for customers.

Add a short threat model covering at minimum:
- token guessing/enumeration;
- cross-shop token substitution;
- booking/order reference substitution;
- replay/double-submit;
- PII leakage through error messages;
- direct API invocation bypassing browser state;
- rate-limit/abuse hook requirement for the future live endpoint.

## Booking and Order integration boundaries

Booking card:
- deep-link to the existing `/book/[slug]` flow;
- do not duplicate Booking forms or availability logic inside Portal;
- existing Booking behavior/tests must remain unchanged except for additive navigation components if required.

Booking → Claim:
- prepare an additive Claim entry point from the manage-booking surface only if it can be hidden/fail-closed until Claim is enabled;
- pass only the customer-held manage context needed by the Claim adapter;
- do not expose or trust arbitrary booking IDs from the browser.

Order card:
- route/interface may be prepared for the Codex Order track;
- coordinate through a small typed route/contract, not cross-branch code copying;
- while Order runtime is absent, production must not present a fake usable ordering flow.

Order → Claim:
- define the route/context interface expected from future Order tracking;
- do not invent Order data or persistence.

If integration with Codex work is needed, document the expected interface and leave a clean handoff rather than cherry-picking unfinished foreign changes into this branch.

## UX quality requirements

- Mobile-first because merchant links are likely opened from chat/LINE/social contexts.
- Preserve existing Thai/English i18n architecture; no hard-coded production copy that bypasses the current translation pattern.
- Accessible button/link semantics and keyboard focus states.
- Clear disabled/unavailable states rather than dead links.
- Shop branding/name/phone should come from the existing safe public shop profile, not private `shops` reads.
- Avoid generic dashboard styling; this is a customer storefront/portal, not the merchant admin UI.
- No marketing claim such as guaranteed outcome, guaranteed refund or guaranteed response time unless already supported by locked product evidence.

## Testing required

Add focused automated tests for at least:
1. capability combinations render only permitted cards;
2. all-disabled/shop-not-found states fail safely;
3. Booking card preserves existing route contract;
4. Claim runtime unavailable cannot return fake success;
5. customer cannot set internal Ticket fields;
6. naked booking/order IDs are insufficient claim authority;
7. phone-only tracking/enumeration is absent;
8. public tracking projection excludes private Ticket fields;
9. cross-shop/reference-substitution contract is rejected by adapter validation;
10. duplicate submit contract carries an idempotency boundary.

## Verification before completion

Run from the isolated worktree after installing dependencies deterministically if needed:

```powershell
npm ci
npm test
npm run lint
npm run build
npm run db:bk01:verify
```

Also run:
- `git diff --check`
- `git status --short --branch`
- a secret-pattern review of changed files;
- confirm `git diff --name-only -- supabase/migrations supabase/bk01-migrations` is empty.

Warnings inherited from baseline may be reported, but new lint/build errors are not acceptable.

If tests fail due to your changes, fix them before declaring completion. Do not downgrade/remove security tests to make the suite green.

## Deliverables

Create/update code plus:
- `docs/order/CLAUDE-PUBLIC-PORTAL-CLAIM-IMPLEMENTATION-EVIDENCE-2026-09-08.md`
- threat-model section or dedicated document for the public Claim boundary;
- concise integration handoff listing the exact runtime functions/data that remain blocked by shared-runtime gate.

Evidence must list changed files, commands, exit codes, tests, known blocked items and final commit SHA.

## Definition of Done — Claude lane

This lane is DONE only when all are true:

- isolated branch/worktree used from `8a5fb88`;
- one public shop portal route exists and is capability-driven;
- existing Booking route/authority remains intact;
- Claim customer UX supports Booking-origin, future Order-origin and standalone contexts at interface level;
- Claim production persistence is truthfully fail-closed until runtime authorization;
- existing Ticket/Case remains the documented lifecycle authority;
- no anon/private Ticket permission broadening occurred;
- token/reference security contracts and threat model exist;
- tests cover positive and negative capability/Claim boundaries;
- `npm test`, lint, build and BK01 shared-runtime static verify pass;
- no migration/shared-runtime mutation exists in this branch;
- implementation evidence and remaining runtime handoff are complete.

## Commit / handoff rule

Local commits are authorized after verification. Use focused commit(s) on this branch only. Suggested final message:

`feat(booking): prepare public portal and claim customer surface`

Do **not** merge into the Booking stabilization branch and do **not** push unless separately authorized by Owner/coordinator.

When finished, report only: branch/worktree, commit SHA(s), changed areas, verification results, remaining runtime-blocked items, and any real defect/risk discovered. Do not declare live Claim availability.
