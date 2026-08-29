# BK01 — Booking by WSTERA

Thailand-first appointment operations SaaS for single-location salons, barbers, beauty and nail businesses with roughly 1–10 providers.

**Repository:** `Gutumrod/booking`
**BK-0 baseline:** `main @ e99615d`
**Canonical technical host target:** `bk01.wstera.com`
**Current documentation authority:** [`docs/DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md)

## Current status
BK-0 is rebuilding and locking the production/product documentation contract before BK-A implementation remediation. The existing codebase already contains substantial booking, auth, Stripe, LINE, ticket and platform-admin functionality, but **current implementation is not equivalent to the target V1 contract**.

Do not infer launch readiness from historical phase reports or prior “complete/official” labels. See:
- [`docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`](docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md)
- [`docs/PRODUCT_DECISIONS.md`](docs/PRODUCT_DECISIONS.md)
- [`docs/MASTER_CHECKLIST.md`](docs/MASTER_CHECKLIST.md)

## Product contract
The numbered SSOT is:
1. [`docs/00_PRODUCT_VISION.md`](docs/00_PRODUCT_VISION.md)
2. [`docs/01_PRD.md`](docs/01_PRD.md)
3. [`docs/02_SYSTEM_ARCHITECTURE.md`](docs/02_SYSTEM_ARCHITECTURE.md)
4. [`docs/03_DATA_SECURITY_TENANCY.md`](docs/03_DATA_SECURITY_TENANCY.md)
5. [`docs/04_PRICING_ENTITLEMENTS.md`](docs/04_PRICING_ENTITLEMENTS.md)
6. [`docs/05_BOOKING_DOMAIN_RULES.md`](docs/05_BOOKING_DOMAIN_RULES.md)
7. [`docs/06_UX_USER_FLOWS.md`](docs/06_UX_USER_FLOWS.md)
8. [`docs/07_ANALYTICS_KPI_SPEC.md`](docs/07_ANALYTICS_KPI_SPEC.md)
9. [`docs/08_EXTERNAL_DEPENDENCIES.md`](docs/08_EXTERNAL_DEPENDENCIES.md)
10. [`docs/09_TEST_RELEASE_GATES.md`](docs/09_TEST_RELEASE_GATES.md)
11. [`docs/10_DEVELOPMENT_ROADMAP.md`](docs/10_DEVELOPMENT_ROADMAP.md)
## Approved V1 direction
- primary ICP: single-location hair/barber/beauty/nail;
- customer books by mobile web link; no app install required;
- collision-safe provider scheduling and fail-closed availability;
- merchant PromptPay deposit flow with private slip storage target;
- merchant-owned LINE OA for paid production; central WSTERA OA for trial/onboarding;
- customer self-reschedule/cancel, reminders and explicit no-show are V1 Required;
- Pro automatic slip verification is required before Pro public sale;
- public V1 billing is monthly only;
- legacy 100/500 paid booking quota walls are retired from target packaging;
- final Basic/Pro public prices are not yet locked; ฿490/฿990 remain pilot reference prices pending BK-A/pilot commercial evidence.

## Applications
- `apps/booking-consumer` — public customer booking + consumer LINE integration surface.
- `apps/booking-admin` — merchant auth/dashboard, billing, tickets and platform-admin.
- `supabase/migrations` — authoritative migration history for `local_service` schema.

Current deployment target uses OpenNext Cloudflare Workers, not the historical Cloudflare Pages strategy.

## Development rule
Before implementing or reviewing a feature, start from `docs/DOCUMENTATION_INDEX.md` and its authority order. Historical `PRODUCT_RULES_V1.md`, `PROJECT_HANDOVER_BRIEF.md`, old business/pricing docs and phase completion reports remain evidence only.

BK-A begins only after BK-0 documentation review is complete. Public V1 launch requires the release gates, legal/privacy readiness, final pricing approval and owner authorization.
