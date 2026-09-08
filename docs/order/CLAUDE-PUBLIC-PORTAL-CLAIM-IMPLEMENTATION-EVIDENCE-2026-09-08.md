# CLAUDE — Public Business Portal + Claim Customer Surface — Implementation Evidence

**Date:** 2026-09-08 (Asia/Bangkok)
**Executor:** Claude Desktop
**Brief:** `docs/order/BRIEF-BK01-CLAUDE-PUBLIC-PORTAL-CLAIM-PARALLEL-2026-09-08.md`
**Lane:** Public Portal + Claim customer surface (bounded parallel; does NOT wait on the Booking shared-runtime gate)

## Isolation

| Item | Value |
|---|---|
| Base checkpoint | `8a5fb88` — `docs(booking): lock public portal and claim integration` |
| Branch | `feature/bk01-public-portal-claim-ui` |
| Worktree | `D:\AI-Workspace\worktrees\bk01-claude-public-portal-claim` |
| Source worktree touched? | No. `feature/bk-a-v1-contract-remediation` untouched. Codex `feature/bk01-order-safe-scaffold` not created/touched by this lane. |
| `git rev-parse HEAD` at start | `8a5fb8852edb8af7aef7d2ce8338c0a2928d646a` |

## What was built

### Capability model — `apps/booking-consumer/src/lib/public-portal.ts`
- `PublicShopCapabilities` (`bookingEnabled` / `orderEnabled` / `claimEnabled`).
- `resolveShopCapabilities(source)` — pure. `bookingEnabled` derives from the one truthful public signal that exists today, `shop_public_profile.is_accepting_online_bookings`. `orderEnabled` / `claimEnabled` use strict `=== true`, so the production capability source (which never carries them yet) resolves them **fail-closed**.
- `selectPortalCards(slug, caps)` — returns only enabled capability cards; a disabled capability is never a clickable card. `disabledCapabilities` / `hasAnyCapability` drive the "not available at this shop" section and the all-disabled state.

### Public portal route — `apps/booking-consumer/src/app/shop/[slug]/page.tsx`
- Additive canonical route `/shop/[slug]`. `/book/[slug]` is unchanged and is **not** redirected or rewritten.
- Client component, `useParams()`, matches the existing consumer storefront style (not admin/dashboard styling). Reuses `getShopBySlug` (`shop_public_profile`) — no private `shops` read.
- Handles: all-3 enabled, any subset, all-disabled, shop-not-found, loading, error.
- Booking card deep-links `/book/[slug]`. Order card points at `/order/[slug]` (Codex lane) only when `orderEnabled`. Claim card points at `/shop/[slug]/claim` only when `claimEnabled`. All three are fail-closed today, so in production the portal currently surfaces Booking only (when the shop accepts online bookings) and lists Order + Claim as "not available at this shop".

### Public Claim contract + fail-closed adapter — `apps/booking-consumer/src/lib/public-claim.ts`
Single standalone module (no sibling relative imports, so it runs under the repo `node --test` runner as-is).
- `CLAIM_RUNTIME_NOT_ENABLED` truthful signal.
- Customer categories → canonical Ticket `type` (`ProductClaim` / `ServiceIssue` / `RecheckRequest` / `RefundRequest` / `Other`). The canonical enum is mirrored read-only, **not changed**.
- `CUSTOMER_FORBIDDEN_TICKET_FIELDS` + `stripForbiddenClaimFields` — customer can never set `priority` / `dueAt` / `assignedTo` / `status` / `resolution` / `shop_id` / `booking_id` / `service_id` / normalized phone.
- Token plausibility: `isRawUuid`, `looksLikePhone`, `isPlausibleReferenceToken` — a naked row id (UUID) or a phone number is never accepted as a reference/tracking token. Booking-origin uses the existing 10-char `link_token` shape.
- `toPublicClaimStatus` — internal Ticket status collapses to a coarse customer-facing status.
- `projectPublicClaimTracking` + `PUBLIC_CLAIM_TRACKING_FIELDS` — whitelist projection; assignee / internal notes / resolution / phone are dropped.
- `PublicClaimAdapter` interface: `getPublicClaimContext` / `submitPublicClaim` / `getPublicClaimTracking`.
- Pure server-boundary validation reused by the future live adapter: `validateClaimContextRequest`, `validateClaimSubmission`, `validateTrackingRequest`.
- `productionClaimAdapter` — fail-closed. Validates shape/authority, then returns `CLAIM_RUNTIME_NOT_ENABLED` (or `CLAIM_NOT_ENABLED_FOR_SHOP` / `INVALID_*`). **No path returns `ok: true` or fabricates a `publicRef`** (verified by an input-matrix test).

### Claim customer UX
- `apps/booking-consumer/src/app/shop/[slug]/claim/page.tsx` — real intake surface. Three origin modes: `?booking=<manageToken>`, `?order=<trackingToken>`, or standalone (no query). Invalid/expired reference degrades to standalone with a notice. Minimal customer inputs only (name, phone, optional contact channel, category, related product/service text, description, optional occurred date). No Priority / Due Date / Assignee / internal status / Resolution fields. A persistent truthful banner states online reporting is not live; on submit the fail-closed adapter is called and the page shows "not available yet, contact the shop, nothing saved". Idempotency key generated once per form instance (`crypto.randomUUID`), reused across retries.
- `apps/booking-consumer/src/app/claim/track/page.tsx` — tracking by opaque customer-held token (`?token=` or manual entry). Phone / numeric / UUID input is rejected before any lookup. Fail-closed: shows the truthful "tracking not available yet" state. Renders only the whitelisted projection fields when a future adapter returns a real result.
- `apps/booking-consumer/src/components/claim-entry-point.tsx` + wired into `manage-booking/page.tsx` — additive Booking→Claim entry point. Fail-closed: renders `null` unless Claim is explicitly enabled AND a usable slug + manage token are present. Today `manage-booking` passes `claimEnabled={false}`, so it renders nothing. Forwards only the customer-held manage token, never a raw booking id.

### i18n
`portal` and `claim` namespaces added to `apps/booking-consumer/messages/th.json` and `en.json`, Thai-first, using the existing `next-intl` pattern. No guaranteed-outcome / guaranteed-refund / guaranteed-response-time copy (test-enforced).

## Files changed

```
 M apps/booking-consumer/messages/en.json
 M apps/booking-consumer/messages/th.json
 M apps/booking-consumer/src/app/manage-booking/page.tsx
?? apps/booking-consumer/src/app/claim/track/page.tsx
?? apps/booking-consumer/src/app/shop/[slug]/page.tsx
?? apps/booking-consumer/src/app/shop/[slug]/claim/page.tsx
?? apps/booking-consumer/src/components/claim-entry-point.tsx
?? apps/booking-consumer/src/lib/public-claim.ts
?? apps/booking-consumer/src/lib/public-portal.ts
?? tests/public-portal-claim.test.ts
?? docs/order/CLAUDE-PUBLIC-PORTAL-CLAIM-IMPLEMENTATION-EVIDENCE-2026-09-08.md
?? docs/order/CLAUDE-PUBLIC-CLAIM-THREAT-MODEL-2026-09-08.md
?? docs/order/CLAUDE-PORTAL-CLAIM-RUNTIME-HANDOFF-2026-09-08.md
```

No change under `supabase/migrations` or `supabase/bk01-migrations`.

## Verification — commands and results

| Command | Result |
|---|---|
| `node --test tests/public-portal-claim.test.ts` | 16/16 pass |
| `npm test` (full suite, `tests/*.test.ts`) | **43/43 pass**, 0 fail |
| `npm run lint` | **0 errors** (7 + 6 pre-existing warnings in `book/[slug]/page.tsx` and `booking-admin/*`; none in new files) |
| `npm run build` (`booking-consumer` + `booking-admin`, Next 16.3.0 Turbopack) | **success**; new routes present: `ƒ /shop/[slug]`, `ƒ /shop/[slug]/claim`, `ƒ /claim/track`. Edge-runtime / middleware-deprecation warnings are pre-existing baseline in `booking-admin`. |
| `npm run db:bk01:verify` | **PASS** — 30 frozen legacy migrations, legacy SHA-256 `812b4656…`, global CLI mutation path disabled |
| `git diff --check` | clean |
| `git diff --name-only -- supabase/migrations supabase/bk01-migrations` | empty |
| Secret-pattern scan of staged additions | no secret / key / token / private-key patterns |

`.env.local` was copied from the sibling BK01 working tree into the isolated worktree for the local build only. It is git-ignored (`git check-ignore .env.local` → match) and is not part of any commit.

## Test coverage map (brief §Testing required)

| # | Requirement | Test |
|---|---|---|
| 1 | capability combos render only permitted cards | `portal renders only the enabled capability cards` |
| 2 | all-disabled / shop-not-found fail safely | `all-disabled resolves to zero cards…`, portal page `not-found`/`error` states |
| 3 | Booking card preserves existing route contract | `booking card deep-links to the established /book/[slug] route` |
| 4 | Claim runtime unavailable cannot return fake success | `production claim adapter never fabricates success` (input matrix) |
| 5 | customer cannot set internal Ticket fields | `forbidden internal ticket fields are stripped…` |
| 6 | naked booking/order IDs insufficient | `a naked booking/order id is rejected as claim authority` |
| 7 | phone-only tracking/enumeration absent | `tracking rejects a phone number and has no phone lookup path` |
| 8 | public tracking projection excludes private Ticket fields | `public tracking projection whitelists only customer-safe fields` |
| 9 | cross-shop / reference-substitution rejected by adapter validation | `adapter validation requires an explicit, well-formed shop and reference` (row-level cross-shop enforcement is server-side; see handoff) |
| 10 | duplicate submit carries idempotency boundary | `claim submission requires a stable idempotency key` |

Plus: category→ticket-type stays in canonical enum; internal→public status collapse; adapter interface swap-ability (in-memory fixture, test-only, never imported by pages); i18n key coverage in both locales; no guaranteed-outcome copy.

## Real defects / risks found

None in existing Booking code. Notes:
- The consumer app has no `generateStaticParams` and does not enable `cacheComponents`; the new client-component pages follow the existing `book/[slug]` (`useParams`) and `manage-booking` (`useSearchParams` + `Suspense`) patterns exactly.
- `next build` in a fresh worktree requires `.env.local` (via `prebuild` → `sync-env`); it is git-ignored, so a worktree needs a local copy. Documented for the next agent.
- Row-level cross-shop token enforcement, real idempotency dedup, rate limiting and the actual Ticket/Case write are all **runtime-blocked** — see `CLAUDE-PORTAL-CLAIM-RUNTIME-HANDOFF-2026-09-08.md`.

## Definition of Done — Claude lane

| DoD item | Status |
|---|---|
| isolated branch/worktree from `8a5fb88` | ✅ |
| one capability-driven public shop portal route | ✅ `/shop/[slug]` |
| existing Booking route/authority intact | ✅ no change to `/book/[slug]`, availability, holds, deposits, collision |
| Claim UX supports Booking-origin / future Order-origin / standalone at interface level | ✅ |
| Claim production persistence truthfully fail-closed | ✅ `CLAIM_RUNTIME_NOT_ENABLED`, no fake id/success |
| existing Ticket/Case remains documented lifecycle authority | ✅ (contract + handoff) |
| no anon/private Ticket permission broadening | ✅ no SQL/grant/policy change at all |
| token/reference security contracts + threat model exist | ✅ this doc + threat model doc |
| tests cover positive and negative capability/Claim boundaries | ✅ 16 new tests |
| `npm test`, lint, build, BK01 static verify pass | ✅ |
| no migration/shared-runtime mutation in this branch | ✅ |
| implementation evidence + remaining runtime handoff complete | ✅ |

**Final commit:** recorded as the single `feat(booking): prepare public portal and claim customer surface` commit on `feature/bk01-public-portal-claim-ui`. Not merged, not pushed.
