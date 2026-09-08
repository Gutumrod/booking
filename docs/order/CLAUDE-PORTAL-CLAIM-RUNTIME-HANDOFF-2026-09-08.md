# CLAUDE Portal + Claim lane — Runtime-Blocked Handoff

**Date:** 2026-09-08
**Branch:** `feature/bk01-public-portal-claim-ui` (base `8a5fb88`)
**Gate:** everything below opens only after **BK01 shared-runtime bootstrap + post-apply isolation gate PASS** (`docs/order/03_PUBLIC_PORTAL_CLAIM_AND_PARALLEL_EXECUTION_DECISION_2026-09-08.md`).

## 1. Interface Codex's Order lane should target

Portal links Order at **`/order/[slug]`** and only when `orderEnabled === true`. Codex's Order lane owns that route.

Order → Claim context interface expected by this lane (Codex to confirm shape):

```ts
// A customer arriving at claim from an order tracking context:
//   /shop/[slug]/claim?order=<orderTrackingToken>
// where <orderTrackingToken> is the opaque, signed Order tracking token,
// NOT a raw order id. This lane's `isPlausibleReferenceToken` gate already
// rejects raw UUIDs and phone numbers; Codex's token must pass that gate
// (charset [A-Za-z0-9_.:-], length 6..200, not a bare UUID).
```

No cross-branch code copying. Coordinate on types/routes only.

## 2. Capability source (blocked)

`resolveShopCapabilities` currently reads only `shop_public_profile.is_accepting_online_bookings`. Post-gate:

- add `order_enabled` / `claim_enabled` to a public capability source (a widened `shop_public_profile` projection or a dedicated `shop_public_capabilities` view — must expose only booleans, no billing/tenant data);
- feed them into `resolveShopCapabilities({ isAcceptingOnlineBookings, orderEnabled, claimEnabled })`;
- `manage-booking/page.tsx` must resolve the shop slug + `claimEnabled` and pass real values to `<ClaimEntryPoint>` (today hard-coded `claimEnabled={false}`, `shopSlug={null}`).

## 3. Claim runtime (blocked)

Replace `productionClaimAdapter` with a live adapter implementing the same `PublicClaimAdapter` interface. Required backing:

| Need | Requirement |
|---|---|
| `submit_public_claim` RPC | `SECURITY DEFINER`, `SET search_path = pg_catalog, local_service`, `anon` EXECUTE only. Accepts customer-facing fields only. Derives `type` from category via `claimCategoryToTicketType` (reject out-of-enum). Sets `priority='Medium'`, `status='New'`, `assigned_to=NULL`, `received_at=now()`, `due_at` server-policy. Creates the Ticket + initial timeline entry through the existing Ticket authority path (do not duplicate lifecycle). Returns `{ publicRef, status }` — never a raw row. |
| Idempotency | dedupe on `(shop_id, idempotency_key)`; retry returns the same `publicRef`. Mirror `create_ticket` `creation_idempotency_key`. |
| Booking-origin auth | validate `(booking_id, manageToken)` via the existing `authorize_booking_recovery_attempt` semantics before linking `p_booking_id`. Never trust a browser booking id. |
| Order-origin auth | validate Codex's Order tracking token → order row; assert same `shop_id`. |
| Cross-shop | assert token's `shop_id` == shop resolved from `shopSlug`; reject mismatch. |
| Capability | independently check live `claim_enabled`; reject new intake when off, still allow authorized history reads. |
| `get_public_claim_tracking` RPC | opaque token → the whitelisted projection only (`publicRef`, coarse `status` via `toPublicClaimStatus`, `submittedAt`, `updatedAt`, optional `merchantMessage`). No assignee / notes / resolution / other-claims / raw UUID. Constant-time / uniform "not found". |
| `publicRef` | opaque, non-sequential, per-claim, distinct from the DB UUID. |
| Public claim tracking token | opaque ≥128-bit, non-sequential, revocable, not derived from phone/email/ref. |
| Rate limiting / abuse | per-shop + per-source limit on submit and tracking before enabling. |
| Attachments (if built) | reuse the deposit-slip signed-URL pattern (booking-scoped object path, size/type caps). No new storage authority. |
| Audit | claim creation, status changes, merchant messages attributable in the existing `ticket_timeline_entries` / audit contract. |

## 4. Migrations required (blocked — product-local `supabase/bk01-migrations` only, post-gate)

- public capability projection/view (booleans only);
- `submit_public_claim` + `get_public_claim_tracking` `SECURITY DEFINER` RPCs with minimum grants;
- claim public-ref + tracking-token columns/table on the claim/ticket side (opaque, unique per shop);
- idempotency store for `(shop_id, idempotency_key)`;
- `anon` GRANT EXECUTE on exactly the two public-claim RPCs; no table DML grant; `create_ticket` grants unchanged.

## 5. Future DB acceptance tests (must be written, not faked)

1. `anon` cannot `SELECT` `local_service.tickets` or call `create_ticket`.
2. cross-shop token → claim submit/tracking rejected.
3. naked booking/order id (no valid token) → rejected.
4. duplicate submit with same `idempotency_key` → one claim, same `publicRef`.
5. tracking response contains none of: assignee, internal notes, resolution, other claims, raw UUID.
6. phone/email/number as tracking token → rejected, no enumeration.
7. `claim_enabled=false` → new intake rejected, existing authorized history still readable.
8. customer-supplied `priority`/`status`/`assigned_to`/`type`-out-of-enum → ignored or rejected server-side.
9. rate-limit trips on abusive volume.

## 6. Not blocked (done in this lane)

Portal route + capability model + card selection; Claim intake UX (3 origins) + tracking UX; adapter interface + pure server-boundary validation + category/status mappings + field guard + token plausibility; fail-closed production adapter; i18n (th/en); 16 tests; threat model.
