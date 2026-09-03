# BK-A V1 Contract Remediation — Implementation Evidence

**Date:** 2026-08-29  
**Branch:** `feature/bk-a-v1-contract-remediation`  
**Implementation starting SHA:** `3aee2a5`  
**Final local SHA:** `908108c` (CONT-03 verification HEAD, working tree clean)

## Implemented scope

- A1–A2: private booking-scoped deposit-slip object references, signed merchant reads, explicit staff auth-user mapping, owner/admin versus staff-self RLS.
- A3–A4/A14: monthly-only checkout identifiers, annual offer removed, paid 100/500 booking wall removed, and ฿490/฿990 labelled as pilot/reference pricing.
- A5–A6: central trial versus merchant-paid LINE configuration boundary, raw-body signature verification, durable notification claim/retry/log flow, confirmation and 24-hour reminder scheduling.
- A7: provider-neutral verification result/audit boundary with fail-safe manual review. Provider, allowance, cost, and top-up remain owner decisions; no public auto-slip claim is made.
- A8: deterministic in-app PromptPay payload and local SVG QR; no `promptpay.io` runtime path.
- A9–A10: token-authorized customer cancel/reschedule with atomic database update, merchant completed/no-show actions, and immutable audit events.
- A11–A12: owner CSV export, account-closure request, staff exclusion from shop-wide tickets, and platform-admin mutation audit.
- A13: unsupported absolute safety copy removed and static absence checks added.

## Database artifact

- `supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql`
- `supabase/tests/bk_a_contract.sql`

The migration was created but not applied to a live or remote project. No production deploy was attempted.

## Commands and observed results

| Command | Result |
|---|---|
| `npm test` | PASS — 19/19 Node unit/static contract tests (exit 0) |
| `npm run lint` | PASS (exit 0) — no errors; 13 existing/non-blocking warnings remain |
| `npm run build` | PASS — consumer and admin production builds (Next.js 16.3.0) |
| `git diff --check` | PASS (exit 0) |
| `npx supabase test db` | BLOCKED — no local PostgreSQL at `127.0.0.1:54322` |
| `npx supabase db lint --local` | BLOCKED — same unavailable local database |

The first build failed because the merchant webhook used an incorrect relative import. It was changed to the configured `@/` alias; the next full build passed.

## CONT-03 integrated verification (2026-09-03, HEAD `908108c`)

Re-ran all non-DB gates on the real repo at HEAD `908108c` (working tree clean). Results:

| Gate | Command | Exit | Expected | Actual |
|---|---|---|---|---|
| G1 unit/static | `npm test` | 0 | PASS | PASS — 19/19 tests |
| G1 lint | `npm run lint` | 0 | PASS | PASS — 0 errors, 13 warnings |
| G1 build | `npm run build` | 0 | PASS | PASS — consumer + admin production builds |
| whitespace | `git diff --check` | 0 | PASS | PASS |
| static absence | search `promptpay.io` in `apps/` | 0 hits | no runtime path | PASS — 0 hits in visible source |
| static absence | search annual offer in `apps/` | only `annualCloseDefault` | no annual offer | PASS — only annual-closure label, no annual billing offer |
| static absence | search legacy 100/500 paid claim in `apps/` | 0 hits | no legacy paid wall | PASS — 0 hits (matches were CSS color classes only) |
| static absence | search unsupported absolute claim (`ปลอดภัย 100%`, guarantee, risk-free) in `apps/` | 0 hits | no absolute claim | PASS — 0 hits in visible source; consumer copy uses `ชำระมัดจำปลอดภัย` (secure deposit), a supported claim |
| secret scan | `git diff 3aee2a5..HEAD -- apps/` for real secrets | 0 hits | no real secret | PASS — no `sk_`/`pk_live`/`whsec_`/private keys; `supabase/config.toml` uses `env(...)` substitution only; test fixtures use placeholder `shop-secret`/`shop-token` |

DB-backed gates (G2, and DB-backed portions of G3–G9) remain **BLOCKED_ENVIRONMENT**: no local PostgreSQL at `127.0.0.1:54322`, no `psql`, no Docker (per brief, Docker must not be installed). No production/remote DB was opened. Migration syntax, clean replay, pgTAP, live RLS/tenancy denial, concurrent overlap, Stripe ordering, LINE provider delivery, reminder scheduler invocation, CSV database content, and platform-admin audit persistence therefore cannot be labelled PASS.

## Gates not proven

- G2 and all DB-backed portions of G3–G9 remain unverified because Docker/Supabase local PostgreSQL is unavailable on this machine.
- Migration syntax, clean replay, pgTAP, live RLS/tenancy denial, concurrent overlap, Stripe ordering, LINE provider delivery, reminder scheduler invocation, CSV database content, and platform-admin audit persistence therefore cannot be labelled PASS.
- No real LINE, Stripe, PromptPay bank, or auto-slip provider call was made.

## Owner-decision blockers

- Final Pro auto-slip provider, included allowance, unit economics/top-up price, and operational failure policy.
- Any WSTERA-managed LINE allowance/cost model.
- Final public Basic/Pro prices; current UI values are reference-only.
- Customer cancellation/reschedule windows are nullable and fail closed until the merchant/owner configures them; no default was invented.

## Stop boundary

No push, merge, deploy, remote migration apply, or secret write is authorized by BK-A.
