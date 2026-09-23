# BK01 Documentation Index & Authority Order

**Status:** Authority order LOCKED — 2026-08-28; current execution pointers updated 2026-09-23

## Authority order
When documents disagree, use this order:
1. dated explicit owner decisions in `PRODUCT_DECISIONS.md` and accepted ADRs;
2. numbered current SSOT `00_PRODUCT_VISION.md` through `10_DEVELOPMENT_ROADMAP.md`;
3. `audit/FEATURE_REQUIREMENT_TRACEABILITY.md` for feature disposition/mapping;
4. current operations/marketing packs, which must derive from numbered SSOT;
5. current market/audit evidence;
6. implementation code/migrations as evidence of **current baseline behavior**, not permission to override approved target product intent;
7. historical phase reports, handoffs, briefs and superseded specifications.

A contradiction between target SSOT and current implementation is a BK-A gap, not a reason to silently rewrite the product contract.

## Current SSOT
- `00_PRODUCT_VISION.md` — problem/ICP/category/principles/non-goals
- `01_PRD.md` — stable V1 requirements
- `02_SYSTEM_ARCHITECTURE.md` — runtime/data/failure boundaries
- `03_DATA_SECURITY_TENANCY.md` — identity/RLS/storage/data lifecycle
- `04_PRICING_ENTITLEMENTS.md` — packaging/billing/entitlement contract
- `05_BOOKING_DOMAIN_RULES.md` — lifecycle and scheduling invariants
- `06_UX_USER_FLOWS.md` — role journeys/recovery states
- `07_ANALYTICS_KPI_SPEC.md` — canonical events and KPI definitions
- `08_EXTERNAL_DEPENDENCIES.md` — provider boundaries
- `09_TEST_RELEASE_GATES.md` — release evidence contract
- `10_DEVELOPMENT_ROADMAP.md` — BK-A onward build order
## Evidence and governance
- `PRODUCT_DECISIONS.md` — owner-approved product decisions
- `ADR_TEMPLATE.md` — future architecture/security decision format
- `MASTER_CHECKLIST.md` — BK-0/BK-A/launch readiness checklist
- `audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md` — baseline conflicts/disposition
- `audit/FEATURE_REQUIREMENT_TRACEABILITY.md` — complete feature mapping
- `audit/MARKET_SOURCE_LEDGER.md` — sourced changing-market facts
- `audit/DOCUMENTATION_AUDIT.md` — final cross-document review record
- `market/*` — market/competitor/ICP evidence as dated analysis, not timeless product truth

## Marketing and operations
`marketing/*` and `operations/*` are current derived contracts. They cannot override numbered SSOT or owner decisions. `marketing/KPI_METRICS.md` imports KPI definitions from `07_ANALYTICS_KPI_SPEC.md`.

## Historical / non-authoritative inputs
The following remain useful evidence but are superseded as current product specification: root `PRODUCT_RULES_V1.md`, root `PROJECT_HANDOVER_BRIEF.md`, `docs/business/OFFICIAL_BUSINESS_MODEL.md`, `docs/business/PRICING_SPEC.md`, old Phase E/Launch briefs/reports and other dated completion/handover files. `README.md` is repository orientation only unless updated to point here.

Historical documents may describe behavior that was true at a prior commit/environment. Their labels such as “official”, “complete” or “100%” do not override this index.

## Conflict/change rule
1. record evidence/contradiction;
2. if product/business choice, update `PRODUCT_DECISIONS.md` with owner approval;
3. if architecture/security trade-off, add ADR;
4. update every affected SSOT/traceability/marketing/operations document in the same change;
5. rerun documentation audit before merge.

No implementation phase may introduce a new externally visible entitlement, role capability, money state or privacy boundary without documentation/traceability change first.

## Current execution pointers — 2026-09-23
For current implementation/gate status, read these before older phase reports:
- `OWNER-HOLD-BK01-AWAIT-KMO-EVIDENCE-2026-09-23.md` — **current controlling execution-priority record**: canonical BK01 product-core work is intentionally paused pending real-shop evidence from KMO; states freeze point, what is paused, what remains incomplete, KMO's role, finding classification/promotion rules, and precise resume conditions
- `CURRENT_STATUS.md` — canonical execution snapshot and hard boundaries
- `daily/2026-09-23.md` — current verified work log including the R4 closure update
- `audit/r4-2026-09-23/REPORT-BK01-R4-CLOSURE-2026-09-23.md` — **R4 closure report**: closure gate, Owner-approved fixture/test-admin lifecycle, R4-1…R4-9, consumer matrix, cross-cutting, positive E2E, cleanup residue proof
- `audit/r4-2026-09-23/EVIDENCE-INDEX-2026-09-23.json` — evidence inventory with sha256
- `audit/r4-2026-09-23/REPORT-BK01-R4-RESUME-2026-09-23.md` — earlier resume report (privilege repair + first consumer pass)
- `handoffs/BRIEF-BK01-R4-CLOSE-LONG-RUN-2026-09-23.md` — governing brief for the R4 close long-run
- `architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md` — locked R4 contract plus execution-status overrides

## Current execution pointers — 2026-09-22 (retained)
- `daily/2026-09-22.md` — end-of-day verified work log
- `handoffs/HANDOFF-BK01-R4-EOD-2026-09-22.md` — exact resume order
- `audit/r4-2026-09-22/REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md` — independent source verdict still current
- `audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-START-2026-09-22.md` — browser discovery evidence
- `audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-PARTIAL-2026-09-22.md` — prior browser/runtime disposition

These execution records do not override owner/product decisions or numbered SSOT contracts. They supersede older execution-status wording only where a later verified checkpoint exists.
