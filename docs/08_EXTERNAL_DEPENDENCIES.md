# BK01 External Dependencies

**Status:** LOCKED TARGET V1 — 2026-08-28

| Dependency | Purpose | Trust boundary | Required failure behavior |
|---|---|---|---|
| Supabase Auth | merchant identity/session/recovery | external identity service | fail closed; never grant shop access without valid identity + membership |
| Supabase Postgres | booking/subscription/tenant truth | authoritative data service | no optimistic success; preserve transactional invariants |
| Supabase Storage | deposit-slip objects | private sensitive object store | private bucket; authorized/signed reads only; upload validation |
| Stripe | monthly SaaS billing | external money/subscription provider | signed webhook, idempotent processing, authoritative event reconciliation |
| LINE Messaging API | customer binding/notifications | external communications provider | failed delivery logged; booking state unaffected; retry/escalation evidence |
| Cloudflare Workers/OpenNext | consumer/admin runtime | public edge/runtime | two-Worker isolation, health/smoke gate, forward-fix/rollback evidence |
| Email delivery via Supabase Auth | verification/recovery | external delivery path | clear resend/recovery UX; no silent provisioning bypass |
| Auto-slip verification provider | Pro deposit automation | external financial-evidence processor | timeout/unknown stays manual review; result must be auditable |
| BK01 QR generator dependency | PromptPay payload/QR rendering | controlled library/service boundary | deterministic local/server generation; no public `promptpay.io` dependency |

## Environment variable inventory
Document names only, never secret values. Current/expected classes include Supabase URL/public key/service-role secret, Stripe secret/webhook secret/monthly price IDs, LINE channel secret/access token(s), canonical site URLs and future auto-slip provider credential/configuration.

## Dependency approval rules
- A new production dependency requires owner/architecture review when it handles customer PII, money evidence, authentication, secrets or authoritative business state.
- Vendor marketing claims are not reliability evidence.
- Provider timeout/retry/rate-limit semantics must be tested or documented before release.
- Data location/subprocessor role must be added to legal/privacy checklist before public launch.

## Explicitly retired dependency
Public `promptpay.io` is not an approved V1 runtime dependency. Historical UI usage at baseline is an implementation gap for BK-A.
