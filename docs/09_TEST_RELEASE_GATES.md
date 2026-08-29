# BK01 Test & Release Gates

**Status:** LOCKED TARGET V1 — 2026-08-28

## Gate model
A requirement is release-ready only when implementation evidence, negative/error-path evidence and tenant/security evidence exist where applicable. Passing unit tests alone is insufficient for money, tenancy, concurrency or provider integration.

## Required gates
1. **G0 Documentation:** numbered SSOT consistent; traceability complete; no stale current-spec conflict.
2. **G1 Static/build:** typecheck, lint, unit/integration tests and production builds pass for both apps.
3. **G2 Database:** clean migration replay/reset, database lint/advisors, function permissions/search paths and RLS checks pass.
4. **G3 Tenancy/security:** cross-tenant reads/writes rejected; staff self-scope enforced; public views minimal; private slip unauthorized read fails.
5. **G4 Booking integrity:** hold/expiry, schedule fail-closed, closures, Any Staff allocation and concurrent overlap rejection verified.
6. **G5 Deposit/money:** no-deposit, manual slip, rejection/retry, duplicate transaction, private storage and auto-slip positive/negative/unknown paths verified.
7. **G6 Lifecycle:** cancel, reschedule atomicity/rollback, completion, no-show and optional blacklist behavior verified.
8. **G7 LINE:** authenticity, central-vs-merchant config, confirmation/reminder sent+failed evidence and retry behavior verified.
9. **G8 Billing:** monthly checkout/portal/webhook lifecycle, duplicate/out-of-order events, past_due/cancel/end entitlement and no annual path verified.
10. **G9 Data/support:** CSV export, deletion/closure workflow, tickets, platform-admin audit and forbidden operator actions verified.
11. **G10 Deployment:** two Workers, canonical routing, auth redirects, Stripe/LINE callbacks, smoke tests and rollback/forward-fix verified.
## Mandatory negative paths
- anonymous direct-write bypass;
- authenticated cross-shop ID substitution;
- staff attempting shop-wide booking/customer access;
- staff attempting ticket/support read or mutation;
- expired/blocked subscription creating booking;
- missing schedule becoming available;
- concurrent same-provider overlap;
- expired hold slip submission;
- forged/foreign slip object reference;
- invalid Stripe or LINE signature;
- duplicate/out-of-order webhook;
- auto-slip timeout/ambiguous result;
- downgrade/reactivation over staff entitlement;
- platform-admin RPC called by non-admin.

## Evidence requirements
Each gate records commit SHA, environment, commands/tests, expected vs actual result, screenshots/log references where needed and reviewer identity. Production-sensitive values are redacted. Provider integration evidence must include at least one controlled failure case.

## Release rule
No public V1 deploy while any Required PRD row lacks evidence or any P0/P1 finding remains open. A documentation PASS does not waive BK-A implementation gates. Final production release requires independent reviewer PASS plus owner authorization.
