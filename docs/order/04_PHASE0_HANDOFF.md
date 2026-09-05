# BK01 Order — Phase 0 Handoff

**Date:** 2026-09-05
**Phase:** 0A + 0B
**Verdict:** PASS / LOCKED
**Build authorization:** NO

## Closed in this phase

- Product Boundary Decision: LOCKED
- bounded Order ICP: LOCKED
- Booking vs Order authority split: LOCKED
- Order V1 lifecycle/data/capacity/ready-date contract: LOCKED
- payment vs Booking-deposit boundary: LOCKED
- capability activation/history rule: LOCKED
- Order↔Booking link semantics: LOCKED at contract level
- explicit non-goals: LOCKED
- Module Reuse Check: COMPLETE
- Reuse Gate: PASS
- MT01 Bootstrap Check: PASS

Prototype remains frozen exploration evidence.
## Remaining implementation blockers

Order implementation is still blocked by the existing release path and focus gate.

Default sequence:

`CONT-04 -> BK-A CLOSED -> BK-B CLOSED -> Booking release/pilot Owner decision -> Order implementation`

An earlier exception requires all conditions in the Owner execution-priority plan, including an explicit written overlap/risk authorization.

## Recommended first Order implementation phase when authorized

**Order Phase 1 — Domain + persistence foundation only**:

1. vendor Product Catalog core using copy-and-own provenance;
2. implement BK01 Supabase/Postgres catalog adapter without enabling generic inventory;
3. implement Order tables/state transitions/snapshots;
4. implement day-capacity/calendar/reservation transaction with concurrency tests;
5. implement shop capability gating and RLS/denial tests;
6. no Booking integration until Order core/capacity authority passes its own gate.

No migration/code work above is authorized by this handoff yet.