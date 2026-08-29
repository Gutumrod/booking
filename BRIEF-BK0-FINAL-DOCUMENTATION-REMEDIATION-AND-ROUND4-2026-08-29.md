# BRIEF — BK-0 Final Documentation Remediation + Independent Review Round 4

**Product:** BK01 — `booking`
**Repository:** `Gutumrod/booking`
**Working path:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `main`
**Baseline HEAD:** `e99615d`
**Date:** 2026-08-29
**Status:** FINAL BK-0 DOCUMENTATION REMEDIATION — ONE-SHOT EXECUTION

## Mission
Close every remaining documentation defect from Independent Review Round 3, record newly observed baseline copy/claim mismatches, rerun deterministic integrity checks, then obtain a fresh independent Round 4 verdict.

The goal is **BK-0 Documentation Lock PASS** only. This brief does not authorize BK-A implementation.

## Hard boundaries
- Documentation/evidence changes only.
- Do **not** modify `apps/**`, `supabase/migrations/**`, RLS, RPCs, API routes, Stripe/LINE/Cloudflare config, DNS, production data, secrets, or runtime behavior.
- Do **not** deploy.
- Do **not** commit or push.
- Do **not** reset, checkout, clean, stash, or discard the existing dirty BK-0 working tree.
- Do **not** modify `.claude/settings.local.json`.
- Never expose secret values.
- If a new finding requires an owner/business decision not already approved, record it and STOP rather than inventing a decision.
- Existing owner decisions in `docs/PRODUCT_DECISIONS.md` are authoritative.
## Required inputs — read before editing
Read these first and treat them as the minimum review set:
- `BRIEF-BK0-PRODUCT-DOCUMENTATION-AND-MARKET-LOCK-2026-08-28.md`
- `docs/DOCUMENTATION_INDEX.md`
- `docs/PRODUCT_DECISIONS.md`
- `docs/01_PRD.md`
- `docs/04_PRICING_ENTITLEMENTS.md`
- `docs/09_TEST_RELEASE_GATES.md`
- `docs/10_DEVELOPMENT_ROADMAP.md`
- `docs/MASTER_CHECKLIST.md`
- `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`
- `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md`
- `docs/audit/MARKET_SOURCE_LEDGER.md`
- `docs/audit/DOCUMENTATION_AUDIT.md`
- `docs/audit/INDEPENDENT_REVIEW_CODEX_2026-08-28.md`
- `docs/audit/INDEPENDENT_REVIEW_CODEX_ROUND2_2026-08-28.md`
- `docs/audit/INDEPENDENT_REVIEW_CODEX_ROUND3_2026-08-28.md`
- `docs/market/COMPETITIVE_LANDSCAPE_2026.md`
- `docs/marketing/POSITIONING_MESSAGING.md`
- `docs/operations/BACKUP_RESTORE_RUNBOOK.md`
- `docs/operations/LEGAL_PRIVACY_CHECKLIST.md`

Also inspect the referenced current baseline code **read-only** where this brief names a mismatch. Code is evidence only; do not fix code in BK-0.
## Round 3 findings that MUST be closed

### P1-1 — Annual billing disposition mismatch
Current defect:
- `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md` currently classifies **Annual billing** as `RETIRED`.
- Owner decision `PD-008`, pricing SSOT and roadmap classify annual billing as `POST-V1`.

Required remediation:
1. Change the Annual billing capability disposition to `POST-V1`.
2. Preserve the V1 rule that current annual UI/copy is not allowed.
3. Make the distinction explicit: **annual billing capability = POST-V1; stale annual V1 UI/copy = RETIRED from V1 and must be removed in BK-A.**
4. Verify all numbered SSOT/roadmap/traceability wording agrees.

### P1-2 — Required PRD reliability IDs missing exact traceability
Current defect:
- `REL-001` and `REL-002` are Required in `docs/01_PRD.md`.
- They must be exact-ID traceable, not merely implied by other feature rows.

Required remediation:
Add explicit complete traceability rows for:
- `REL-001` — database-authoritative booking collision prevention/concurrency reliability.
- `REL-002` — external-provider fail-safe/observable/idempotent failure handling for Stripe, LINE and slip verification.

Each row must include disposition, role, entitlement, authority/API, negative/error states, analytics/observability, release evidence and allowed marketing claim.
### P2-1 — Competitive matrix UNKNOWN discipline
Current defect:
Some marketplace/discovery cells use wording such as `none established` or `no marketplace`, which can be misread as verified absence.

Required remediation:
- Normalize every unverified absence to `UNKNOWN` wording, e.g. `UNKNOWN — none established in reviewed evidence`.
- Do not weaken confirmed positive evidence such as Fresha Marketplace, Booksy Marketplace or Booking.page directory listing.
- Do not infer `NO` from silence on a vendor page.
- Preserve the existing source IDs and evidence ledger links.
- Recheck all required competitive fields after normalization.

### P2-2 — MASTER_CHECKLIST lacks downstream launch decisions
Add a dedicated downstream commercial/public-launch gate section to `docs/MASTER_CHECKLIST.md` tracking at minimum:
- final Basic/Pro public price owner approval;
- final Pro auto-slip provider, included allowance, cost/top-up and failure policy;
- any WSTERA-managed LINE allowance/cost model if offered;
- production backup capability verified against proposed targets;
- RPO/RTO explicitly approved;
- final retention durations approved for booking/customer/slip/ticket/audit/backups;
- `past_due` grace duration/policy implemented and approved;
- qualified legal/privacy review completed;
- final competitor refresh completed before commercial lock;
- final public marketing claims limited to `SHIPPED-VERIFIED` evidence;
- approved support hours/customer-facing SLA wording, if any;
- all BK-A technical/release gates PASS before public V1.
## Additional baseline copy/claim mismatches to record now
These are **documentation/audit updates only** in BK-0. Do not modify runtime files.

### CLAIM-001 — Unsupported absolute security claim
Observed baseline evidence:
- `apps/booking-consumer/messages/th.json` contains footer copy `ปลอดภัย 100%`.

This conflicts with the locked evidence-constrained marketing rule prohibiting unsupported absolute security/outcome claims.

Required documentation action:
- Record this as a baseline-to-target mismatch in `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`.
- Add it to BK-A/public-copy remediation tracking in `docs/MASTER_CHECKLIST.md` and, if useful for build sequencing, `docs/10_DEVELOPMENT_ROADMAP.md`.
- Target rule: remove or replace unsupported absolute wording before public release; do not invent a replacement claim in BK-0 unless already authorized by positioning docs.

### COMM-001 — Stale commercial UI conflicts with target pricing contract
Observed baseline evidence includes:
- `apps/booking-admin/src/app/register/page.tsx` still exposes yearly toggle/prices `฿4,900` / `฿9,900`.
- the same registration surface still presents legacy `500 คิว/เดือน` Pro copy;
- `apps/booking-admin/messages/th.json` / `en.json` still contain legacy Basic `100 bookings/month` copy;
- current app surfaces display ฿490/฿990 without necessarily communicating their **pilot/reference, not-final-public-price** status.

Required documentation action:
Record this as baseline implementation/copy mismatch against PD-002, PD-003 and PD-008. Keep the approved target unchanged. Classify runtime-copy cleanup as BK-A/commercial-launch remediation, not a new owner decision.
## Files expected to change
The normal remediation set is:
- `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md`
- `docs/market/COMPETITIVE_LANDSCAPE_2026.md`
- `docs/MASTER_CHECKLIST.md`
- `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`
- `docs/audit/DOCUMENTATION_AUDIT.md`
- `docs/10_DEVELOPMENT_ROADMAP.md` only if needed to make BK-A copy remediation explicit

Create the fresh review evidence file:
- `docs/audit/INDEPENDENT_REVIEW_CODEX_ROUND4_2026-08-29.md`

Other current documentation may be edited only if required to remove a real cross-document contradiction discovered during this pass. Explain every extra file touched in the final report.

## Do not modify
- `apps/booking-admin/**`
- `apps/booking-consumer/**`
- `supabase/migrations/**`
- provider/runtime configuration
- `.env*` or secrets
- `.claude/settings.local.json`

Read-only inspection of those paths is allowed for evidence verification.
## Deterministic integrity checks — mandatory before Round 4
Run checks from the booking repository root and preserve concise evidence in `docs/audit/DOCUMENTATION_AUDIT.md`.

At minimum verify:
1. `git diff --check` passes.
2. No tracked change exists under `apps/**` or `supabase/migrations/**` from this remediation.
3. Every Markdown table in `FEATURE_REQUIREMENT_TRACEABILITY.md`, `MARKET_SOURCE_LEDGER.md` and `COMPETITIVE_LANDSCAPE_2026.md` is structurally well formed.
4. Every competitor source ID referenced by `COMPETITIVE_LANDSCAPE_2026.md` resolves to a standalone row in `MARKET_SOURCE_LEDGER.md`.
5. `TH-BOOKIO-1` and `TH-FOX-1` remain separate ledger rows.
6. No forbidden unverified-absence wording remains where `UNKNOWN` is required.
7. Annual billing disposition is exactly `POST-V1` in traceability and agrees with PD-008/pricing/roadmap.
8. Every Required PRD identifier is present in traceability.

The PRD-ID audit must include all current requirement families, not only `FR-*`/`SEC-*`:
- `FR-*`
- `SEC-*`
- `REL-*`
- `NFR-*`

Use a robust extraction pattern equivalent to `(FR|SEC|REL|NFR)-[A-Z]+-[0-9]+` and compare unique PRD IDs against unique traceability IDs.

Expected current count may change if docs legitimately change; do not hard-code `40` as proof. Report actual counts and missing IDs. Missing Required ID count must be `0`.
## Independent Review Round 4 — mandatory
After remediation and deterministic checks pass, run a **fresh independent read-only review** against the post-fix snapshot.

The reviewer must re-read the master BK-0 brief and verify evidence independently rather than trusting `DOCUMENTATION_AUDIT.md`.

Round 4 must explicitly recheck:
- all Round 1, Round 2 and Round 3 findings;
- annual billing `POST-V1` consistency;
- exact `REL-001` / `REL-002` traceability;
- all Required PRD IDs resolve in traceability;
- market `UNKNOWN` discipline and source-ID integrity;
- staff ticket `ROLE-003` target vs baseline;
- pricing/quota/LINE/slip-storage/Stripe target-vs-baseline consistency;
- `past_due` as a downstream public-launch decision, not hidden BK-0 contradiction;
- backup/recovery proposals and approval boundary;
- support response expectations and incident playbooks;
- stale public runtime copy/claims are recorded as BK-A blockers, especially `ปลอดภัย 100%`, annual pricing and legacy 100/500 booking copy;
- historical docs cannot override current SSOT;
- no code/runtime/SQL changes were made by this remediation.

Reviewer output must report only concrete P0/P1/P2 findings with exact file references and end exactly with:
`VERDICT: PASS`
or
`VERDICT: BLOCKED`.
## Verdict handling
### If Round 4 = BLOCKED
- If findings are documentation defects resolvable from already approved decisions/evidence, remediate them in the same run and repeat deterministic checks + a fresh independent review.
- Do not suppress or downgrade a real P1 merely to finish.
- If remediation requires a new owner decision, STOP and report the exact decision needed.

### If Round 4 = PASS
1. Save the reviewer result to `docs/audit/INDEPENDENT_REVIEW_CODEX_ROUND4_2026-08-29.md`.
2. Update `docs/audit/DOCUMENTATION_AUDIT.md` with final independent PASS evidence and actual automated-check results.
3. Mark only these BK-0 checklist items complete in `docs/MASTER_CHECKLIST.md`:
   - final cross-document audit complete with no unresolved P0/P1 documentation contradiction;
   - independent documentation reviewer PASS.
4. Leave `owner authorizes commit/push` unchecked.
5. Run `git diff --check` and final scope check once more after those governance-only updates.
6. STOP. Do not commit, push, deploy or begin BK-A.

## Final response required from Codex
Report:
- final verdict;
- files changed;
- exact automated gate results;
- Round 4 review file path;
- remaining BK-A blockers;
- remaining BK-C/BK-D commercial/public-launch blockers;
- confirmation that application code, migrations, runtime config and secrets were untouched;
- confirmation that no commit/push/deploy occurred.

Success condition: **BK-0 documentation is independently PASS, while implementation and public-launch blockers remain explicitly tracked rather than hidden.**
