# BK01 Public Claim — Threat Model (customer intake + tracking boundary)

**Date:** 2026-09-08 (Asia/Bangkok)
**Scope:** `/shop/[slug]/claim` (intake), `/claim/track` (tracking), `public-claim.ts` adapter contract.
**Status of runtime:** fail-closed. No live Ticket/Case write or read path is wired. This document defines the boundary the post-gate live adapter MUST satisfy.

## Assets

- Existing `local_service.tickets` / `ticket_timeline_entries` rows (private; RLS `FOR SELECT` to shop members, all writes via `SECURITY DEFINER` RPC, `anon` fully revoked).
- Customer PII in a claim (name, phone, contact channel, free-text description).
- The authenticated `create_ticket` RPC and its siblings.
- Cross-shop tenancy boundary (`shop_id`).

## Trust boundaries

| Actor | Trust |
|---|---|
| Browser form state / query params | untrusted — advisory only |
| Customer-held token (booking manage token, order tracking token, claim tracking token) | untrusted string until validated server-side against the row |
| `anon` Supabase role | must never gain direct Ticket read or generic ticket mutation |
| Future `submit_public_claim` / `get_public_claim_tracking` RPC (`SECURITY DEFINER`, minimum grant) | the only authorized path from public → Ticket authority |

## Threats and controls

### T1 — Token guessing / enumeration
- **Now:** `isPlausibleReferenceToken` rejects sequential numbers, phone shapes and raw UUIDs client-side. Tracking never accepts phone/number.
- **Runtime-blocked control:** the future claim tracking token must be opaque, ≥128-bit entropy, non-sequential, not derived from phone/email/ticket id, and revocable. The tracking RPC must rate-limit and must not distinguish "wrong token" from "no such claim" in timing or message.

### T2 — Cross-shop token substitution (token from shop A used on `/shop/B/claim`)
- **Now:** every adapter call carries an explicit, format-validated `shopSlug`; origin token is a separate field. `validateClaimContextRequest` / `validateClaimSubmission` reject a missing/garbage reference.
- **Runtime-blocked control:** the RPC must resolve the token to its row and assert `row.shop_id` matches the shop resolved from `shopSlug`, rejecting on mismatch. Client-side checks cannot enforce this.

### T3 — Booking / Order reference substitution (naked id instead of token)
- **Now:** `isRawUuid` → a bare `booking_id` / `order_id` UUID fails `isPlausibleReferenceToken`; booking-origin and order-origin submissions with a naked id return `INVALID_REFERENCE`.
- **Runtime-blocked control:** booking-origin must validate against `local_service.authorize_booking_recovery_attempt(p_booking_id, p_recovery_token)` semantics (the existing manage-token check), not against a booking id alone. Order-origin must validate the Codex Order tracking token the same way.

### T4 — Replay / double-submit
- **Now:** `PublicClaimInput.idempotencyKey` is required (≥8 chars), generated once per form instance and reused across retries; `validateClaimSubmission` enforces its presence.
- **Runtime-blocked control:** the write RPC must dedupe on `(shop_id, idempotency_key)` and return the same claim reference on retry — mirroring the existing `create_ticket` `(shop_id, creation_idempotency_key)` idempotency. It must never reserve/create twice.

### T5 — Privilege escalation via payload (customer sets internal Ticket fields)
- **Now:** `CUSTOMER_FORBIDDEN_TICKET_FIELDS` + `stripForbiddenClaimFields`; the intake form has no Priority/Due/Assignee/Status/Resolution inputs.
- **Runtime-blocked control:** the RPC signature must accept only the customer-facing fields. `priority` defaults server-side (e.g. `Medium`), `status` starts `New`, `assigned_to` null, `received_at`/`due_at` server-computed. `type` is derived server-side from the customer category via the fixed mapping; the RPC must reject a `type` outside the canonical enum.

### T6 — PII leakage through error messages / tracking projection
- **Now:** error codes are coarse enums (`CLAIM_RUNTIME_NOT_ENABLED`, `INVALID_REFERENCE`, …) with no row data. `projectPublicClaimTracking` whitelists exactly `publicRef`, `status`, `submittedAt`, `updatedAt`, `merchantMessage`. `toPublicClaimStatus` collapses internal states.
- **Runtime-blocked control:** the tracking RPC must return only that projection — never a raw ticket row, assignee identity, internal timeline, resolution text, or other claims for the same phone/customer.

### T7 — Phone/email enumeration of history
- **Now:** no adapter method accepts a phone/email as a lookup key; tracking rejects phone-shaped input; source scan asserts no `byPhone` lookup exists in the module.
- **Runtime-blocked control:** no public RPC may accept `(shop_id, phone)` and return a list. Phone is a tenant-local dedup hint at write time only.

### T8 — Direct API invocation bypassing browser state
- **Now:** all validation is in the adapter/contract layer, not the React components, so it applies regardless of how the call is made. Production adapter is fail-closed for every input.
- **Runtime-blocked control:** the RPC is the enforcement boundary; browser-sent `shop_id`, `type`, `status`, `booking_id` are re-derived or re-validated server-side. `SECURITY DEFINER` with pinned `search_path = pg_catalog, local_service`, explicit authorization, minimum grant (mirror the existing ticket RPCs). `anon` gets EXECUTE on the two public-claim RPCs only — never on `create_ticket` or table DML.

### T9 — Abuse / spam / cost
- **Runtime-blocked control:** the public submit endpoint needs a rate-limit / abuse hook (per shop + per source) before it is enabled. Attachment upload, if added, must reuse the existing deposit-slip signed-URL pattern (booking-scoped object path, size/type limits) and must not introduce a new storage authority.

### T10 — Capability bypass (claim submitted to a shop that disabled Claim)
- **Now:** portal only links to the claim route when `claimEnabled`; `getPublicClaimContext` returns `CLAIM_NOT_ENABLED_FOR_SHOP` when the capability source does not carry `claimEnabled === true`.
- **Runtime-blocked control:** the write RPC must independently check the shop's live `claim_enabled` capability and reject when off, while still allowing authorized reads of pre-existing claim history.

## Residual risk while fail-closed

Low. No public write/read path to Ticket/Case exists; the surface cannot create, read, or mutate any ticket. The worst case today is a customer filling a form that truthfully tells them it was not submitted and to contact the shop directly.
