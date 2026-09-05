# BK01 Order — Module Reuse Check

**Date:** 2026-09-05
**Scope:** Order V1 Phase 0B
**Policy:** parent `docs/platform/MODULE-REUSE-POLICY.md`

**Module Reuse Check:** COMPLETE
**MT01 Bootstrap Check:** PASS
**Reuse Gate:** PASS — for the locked Phase 0B contract; does not authorize implementation

## Evidence inspected

Canonical Module Hub repository:

- path: `D:\AI-Workspace\projects\modules-hub`
- immutable source commit inspected: `cd88c570ab57f6976d15f85d09973d0cfbf0cd63`
- Product Catalog version: `0.1.0`
- Product Catalog status: Completed
- direct verification: `npm test` = **213/213 PASS** across 9 files
- direct verification: `npm run typecheck` = **PASS**

The module contract was read directly; no candidate summary is treated as implementation evidence.
## Capability classification

| Required capability | Classification | Decision |
|---|---|---|
| Product/made-to-order catalog core | **USE + ADAPT** | Copy canonical `modules/product-catalog` into BK01 at implementation start. Preserve core contract; adapt host/storage/data boundaries. |
| Order lifecycle | **MISSING CAPABILITY** | New BK01 Order-domain implementation after build gate. |
| Production capacity / ready-date engine | **MISSING CAPABILITY** | New day-level BK01 domain logic; not appointment scheduling. |
| Order↔Booking relationship | **MISSING CAPABILITY** | Product-local linking against existing Booking authority. |
| Scheduler module | **NOT APPLICABLE** | Module schedules cron/event jobs; Order capacity is a business-date capacity ledger, not an execution scheduler. |
| Feature Flags module | **NOT APPLICABLE** | `booking_enabled/order_enabled/claim_enabled` are product capability/entitlement configuration, not temporary rollout feature flags. |
| Audit Log module | **NOT APPLICABLE** | BK01 already has an established `audit_events`/audit contract; prospective reuse policy does not authorize retrofitting stable existing capability solely for reuse. |
| Subscription module | **NOT APPLICABLE** | Existing BK01 subscription/Stripe authority is retained by the master plan. |
| Payment module | **NOT APPLICABLE** | Order payment is local operational state only; no new payment engine is authorized. |
| Claim/case module | **NOT APPLICABLE** | Claim lifecycle is outside Order V1 and future ownership is intentionally unresolved. |
### Storage candidate disposition

`modules/file-storage v0.1.0` was also inspected as a serious candidate.

Classification: **REJECT WITH JUSTIFICATION for Order V1 integration**.

Reason: the shipped adapter is R2-oriented while BK01's locked V1 topology already uses Supabase Storage, and Product Catalog already defines the `MediaStorage` adapter boundary the host must satisfy. Introducing the File Storage module/R2 boundary solely for Order catalog media would add a second storage/provider abstraction without an independently required product benefit.

At implementation time BK01 should instead implement a thin Supabase-compatible adapter to the vendored Product Catalog `MediaStorage` interface, preserving the existing BK01 storage/security topology. This is an adaptation of the selected catalog module, not a fresh catalog/media domain implementation.

If a later architecture decision independently selects R2 for public catalog media, this rejection must be re-evaluated rather than silently ignored.
## Product Catalog adaptation boundary

Reuse is limited to catalog master-data/domain behavior: product/variant/category/brand/custom attributes/media contract, validation, tenant/catalog scoping and structured errors.

BK01-specific adaptation is expected for:

- mapping module `tenantId` to authoritative BK01 `shop_id` context;
- Supabase/Postgres `ProductRepository` adapter;
- Supabase-compatible `MediaStorage` adapter if catalog images ship;
- made-to-order lead-day/capacity/deposit/fulfillment attributes;
- BK01 authorization/audit wiring;
- explicit suppression/non-use of generic inventory fields in Order V1.

Do not use the shipped CSV adapter or local-filesystem media adapter in BK01 production. The module itself documents those adapters as unsuitable for horizontally scaled/high-concurrency production workloads.
## Copy-and-own provenance plan

No module is copied during Phase 0 because Order implementation is not authorized.

When implementation is explicitly opened, the first copy commit must record:

```text
module: product-catalog
source_repo: D:\AI-Workspace\projects\modules-hub
source_version: 0.1.0
source_commit: cd88c570ab57f6976d15f85d09973d0cfbf0cd63
copied_at: <implementation copy date>
local_changes: Supabase/Postgres adapter; Supabase media adapter if required; shop_id mapping; made-to-order attributes; BK01 auth/audit integration; inventory semantics disabled for Order V1
```

The source commit must be rechecked at copy time. If the canonical module has advanced, review the new version and record the actually copied immutable commit rather than blindly using this Phase 0 inspection hash.

No cross-repository runtime import from Modules Hub is permitted.