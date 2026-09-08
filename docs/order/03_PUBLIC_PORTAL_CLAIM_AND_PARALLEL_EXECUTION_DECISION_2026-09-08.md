# BK01 Public Business Portal + Claim Integration + Parallel Execution Decision

**Date:** 2026-09-08 (Asia/Bangkok)
**Status:** LOCKED — Owner decision
**Product:** BK01 — Booking by WSTERA
**Authority:** Explicit Owner decision on 2026-09-08; additive to the 2026-09-05 Order Phase 0 decisions.

## Locked product experience

Each merchant gets one public BK01 shop link. The customer-facing entry point is a Business Portal that exposes only capabilities enabled for that shop:

```text
Public Shop Link
├── Booking
├── Order
└── Claim
```

Target shop-level capability controls remain:

- `booking_enabled`
- `order_enabled`
- `claim_enabled`

Disabled capabilities must not appear as usable public intake paths, while existing authorized history remains preserved.

## Claim authority decision

Claim is **not a new lifecycle engine**. BK01 must reuse the existing Ticket/Case domain as the authoritative Claim engine.
Existing Ticket/Case capabilities already include claim-compatible types such as `ProductClaim`, `ServiceIssue`, `RecheckRequest`, `RefundRequest`, and `Other`, plus lifecycle, timeline/audit and idempotent creation semantics.

Public customers must **not** receive direct access to the existing authenticated `create_ticket` RPC or private ticket reads. Claim must add a bounded public intake/tracking adapter that validates shop capability and customer-held references/tokens server-side, then creates/reads the underlying Ticket/Case through a minimum-authority path.

Public Claim may originate from:

1. a Booking/manage token;
2. an Order/tracking token;
3. a standalone claim with no Booking/Order reference.

Phone/email alone must never enumerate private Booking, Order or Claim history. Public tracking uses opaque, non-sequential customer-held tokens.

## Authority boundaries

| Domain | Authority |
|---|---|
| Appointment time/provider/duration/collision | Existing Booking engine |
| Order catalog/lifecycle/production readiness | Order engine |
| Claim/case lifecycle/status/timeline/resolution | Existing Ticket/Case engine |
| Public capability navigation | Public Business Portal |
| Claim public intake/tracking | Thin Claim adapter over Ticket/Case |
| Subscription/billing | Existing BK01/platform billing authority |

Order and Claim integrations must not bypass Booking collision rules, broaden Ticket RLS, or create duplicate payment/case engines.
## Parallel execution authorization

The previous default sequence that placed all Order implementation after Booking release/pilot is superseded only to the extent stated here.

**Parallel-safe now:**

- Public Business Portal route/layout and capability-aware navigation;
- Claim public UX/contract, token model and adapter interface;
- Order UI/domain scaffolding that does not mutate shared DB/runtime;
- Product Catalog copy-and-own preparation after immutable source recheck;
- tests, threat models and API contracts for the new public surfaces.

**Blocked until BK01 shared-runtime bootstrap + post-apply isolation gate PASS:**

- new BK01 shared-runtime migrations for Order/Claim;
- live Order tables/RPCs/capacity ledger;
- live public Claim write/read adapter;
- capability flags exposed from the live shared database;
- any production/staging runtime mutation dependent on the new migration lane.

Booking remains the primary stabilization track. Parallel work must occur on isolated branches/worktrees or otherwise cleanly separated commits and must not modify Booking authority merely to make Order/Claim easier.

## Options considered

- **Sequential-only:** lowest coordination risk, but unnecessarily delays independent portal/contract/UI work and creates idle time while shared-runtime gates close.
- **Unrestricted parallel:** fastest apparent progress, but risks schema/runtime collisions, regression in Booking authority and mixed evidence.
- **Bounded parallel (SELECTED):** parallelize additive, non-authoritative work now; open DB/runtime implementation only after the shared-runtime gate passes.

## Locked execution order

`Booking shared-runtime closure` runs as the gating track while `Portal + Claim contract/UI + Order safe scaffolding` may run in parallel. After the shared-runtime gate PASS, open Order and Claim runtime implementation in bounded product-local migrations, then integrate and test the unified public portal end-to-end.

**OWNER DECISION:** LOCKED

**PARALLEL IMPLEMENTATION:** AUTHORIZED WITH THE BOUNDARIES ABOVE
