# BK01 Codex Order safe scaffold evidence

**Verdict:** safe-lane scaffold complete; Order runtime and database acceptance remain `RUNTIME-BLOCKED`.

## Isolation and provenance

- Base: `8a5fb8852edb8af7aef7d2ce8338c0a2928d646a`.
- Branch: `feature/bk01-order-safe-scaffold`.
- Worktree: `D:\AI-Workspace\worktrees\bk01-codex-order-safe-scaffold`.
- Brief reference: `docs/order/BRIEF-BK01-CODEX-ORDER-SAFE-SCAFFOLD-PARALLEL-2026-09-08.md`; copied byte-for-byte from the Owner-provided source (SHA-256 `8354D0334B97799EE7FDAF0354BA24212CF5B2115A56430674109EC46A69CC41`).
- Product Catalog: Module Hub `0.1.0`, immutable source commit `cd88c570ab57f6976d15f85d09973d0cfbf0cd63`, copied into `order/catalog` with provenance. Upstream source passed 213 tests and typecheck before copy. The intentionally reduced BK01 domain-only copy retains 92 tests and typecheck.

## Implemented and proven by code/tests

- guarded lifecycle, payment, and deposit transitions, including explicit audited terminal recovery;
- immutable Order line snapshots with integer money, quantity, lead, deposit, and overflow validation;
- deterministic weekly calendar/day overrides, strict ISO dates, lead/capacity readiness, requested-date truth, and sequential over-capacity rejection;
- lifecycle-aware reservation release decision;
- shop-scoped typed runtime ports whose public submit contract accepts selections rather than trusted snapshots/internal state;
- Product Catalog host adaptation that rejects active inventory inputs and forces inventory off;
- opaque-token/public-projection/cross-shop security boundaries;
- READY + ON_SITE_SERVICE + appointment-required Order-to-Booking delegation without scheduler authority;
- customer `/order/[slug]` and bounded admin `/dashboard/orders` surfaces that expose runtime unavailable and cannot return fake success.

## Changed surfaces

- `order/core`, `order/catalog-adaptation.ts`, and the owned `order/catalog` copy;
- consumer/admin Order routes and typed contracts;
- root Order tests and catalog verification script;
- Order provenance, runtime/atomicity, Booking integration, Portal/Claim handoff, post-gate probes, and this evidence document;
- `.gitignore` only for copied catalog dependency output.

No file under `supabase/migrations` or `supabase/bk01-migrations` was changed.

## Verification evidence

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm test` | exit 0; 50/50 tests |
| `npm run lint` | exit 0; 13 pre-existing warnings, 0 errors |
| `npm run build` | exit 0 for both apps using a temporary placeholder-only copy of `.env.example`; all temporary `.env.local` files removed afterward |
| `npm run db:bk01:verify` | exit 0; repository verification PASS |
| `npm run verify:order:catalog` | exit 0; clean nested install, 92/92 retained tests, typecheck PASS |
| focused Order TypeScript check | exit 0 |
| `git diff --check` | exit 0 |
| migration-path diff | empty |

The root lockfile reports 0 audit findings. The immutable catalog copy's test-only toolchain reports 6 findings (3 moderate, 1 high, 2 critical) under Vitest/Vite coverage dependencies; none is a production dependency. This lane did not rewrite the canonical copied toolchain or run a breaking `npm audit fix --force`; test-toolchain remediation needs a separately reviewed copy-and-own update.

## Intentionally not claimed

Supabase schema/RLS/grants/RPC behavior, atomic confirmation/reservation, idempotent persistence, public submit/tracking persistence, live capability enablement, cross-shop database probes, settings races, cancellation release concurrency, and live Booking link creation are not implemented here. Required post-gate probes remain listed in `ORDER-POST-GATE-ACCEPTANCE-PROBES-2026-09-08.md` and must not be inferred from these static/unit/build gates.

Implementation commits through the initial scaffold are `2c8d372`..`4159ea1`; strict-audit remediation is recorded in the subsequent focused local commit(s) on this branch. The exact final HEAD is reported in the handoff because a commit cannot truthfully embed its own SHA.
