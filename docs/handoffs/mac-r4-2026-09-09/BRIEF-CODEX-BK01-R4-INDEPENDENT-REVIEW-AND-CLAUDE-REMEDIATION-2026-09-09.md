# BRIEF — Codex Independent Review of BK01 R4 + Final Claude Remediation Brief

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Reviewer:** Codex
**Mode:** INDEPENDENT REVIEW / EVIDENCE-FIRST / NO SOURCE IMPLEMENTATION
**Primary repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`

## Mission

Perform an independent review of the completed R4 source implementation.
Do not assume the implementer's report, Secretary review, tests, or prior conclusions are correct.
Inspect the actual branch, source, contracts and tests yourself.

After the review, produce a complete remediation brief for Claude to implement every verified defect or contract mismatch you find.
The Claude brief must be executable without needing this chat for missing context.

## Required final outputs

Create exactly these two evidence files outside the product branch:
1. `D:\AI-Workspace\runtime\reviews\REPORT-CODEX-BK01-R4-INDEPENDENT-REVIEW-2026-09-09.md`
2. `D:\AI-Workspace\runtime\handoffs\BRIEF-CLAUDE-BK01-R4-REMEDIATION-FINAL-2026-09-09.md`

Do not modify product source while performing this review.
## Branch chain to verify

Expected chain — verify, do not trust blindly:
- Frozen audit baseline: `docs/bk01-real-shop-hardening` @ `520bb08`
- Amendment contract: `docs/bk01-real-shop-hardening-r2` @ `4d352ad`
- R4 implementation: `feature/bk01-real-shop-hardening-r4` @ `b0f7353`

Verify local HEAD, origin parity, base ancestry and clean working tree.
Verify `520bb08` remains unchanged.
Verify `4d352ad..b0f7353` contains no migration, SQL, env, script, dependency or shared-runtime delta.

## Canonical documents to read before judging source

Read all of these directly:
- `docs/BRIEF-BK01-REAL-SHOP-PILOT-HARDENING-2026-09-09.md`
- `docs/BK01-REAL-SHOP-HARDENING-R0-R6-HANDOFF-2026-09-09.md`
- `docs/audit/R0-R6-AMENDMENT-LOG-2026-09-09.md`
- `docs/architecture/R2-SCHEDULING-CONTRACT-V2-2026-09-09.md`
- `docs/architecture/R3-MERCHANT-CONFIG-ARCHITECTURE-2026-09-09.md`
- `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`
- `docs/architecture/R5-SERVICE-SCHEDULING-MODEL-2026-09-09.md`
- `docs/audit/R6-SECURITY-NEGATIVE-TEST-MATRIX-2026-09-09.md`

Use amended contract at `4d352ad` as authority where frozen documents differ.
## R4 implementation scope to verify

Review every implemented item, not only known concerns:
- R4-1 merchant deposit must not be overwritten when price changes.
- R4-8 countdown must derive from server `expires_at`.
- R4-9 duration input must move toward free positive-minute semantics without inventing a new merchant rule.
- R4-2 numeric fields must allow empty editing state and validate only at commit/save boundaries.
- R4-6 customer page must render truthful negative/error states rather than blank ambiguity.
- R4-7 consumer must never invent payment recipient, account identity or deposit amount.
- R4-5 Preview must be available before setup completion and readiness must reflect actual merchant policy.
- R4-3 time entry must be keyboard/mobile practical without changing RPC value contracts.
- R4-4 multi-staff schedule edits must survive saving/refetching another staff member and preserve dirty state safely.

Inspect the relevant Admin and Consumer source, helper modules, messages and tests.
Do not accept a helper merely because its unit test passes; inspect how the page calls it.

## Independent defect search

Search beyond the nine items for newly introduced or retained issues in the changed files.
Pay special attention to:
- merchant-policy hardcodes or guessed business truth;
- payment recipient/name/amount derivation;
- readiness logic that incorrectly blocks no-deposit merchants;
- stale/default form values that silently become saved merchant policy;
- client/server semantic divergence;
- state loss after mutation/refetch;
- misleading success/ready/available states;
- security-sensitive fallback values;
- tests that merely encode an incorrect implementation.
## Claims from Secretary review — VERIFY, DO NOT ASSUME

Treat the following as hypotheses that require source/contract proof:

### Claim S1 — R4-9 minimum mismatch
Secretary observed `commitNumericField(serviceDuration, { min: 5, integer: true })` and UI `min={5}`.
Amended contract appears to require any positive integer minute (`min=1`), while `step={5}` may remain only a UI convenience.
The current `%15` guard may be temporarily necessary only because the pre-R7 RPC still rejects non-multiples of 15.
Verify exact intended sequencing and ensure no new business rule is created client-side.

### Claim S2 — consumer deposit derivation mismatch
Secretary observed `resolveDepositDisplay()` still accepting `shopDefaultDepositAmount`.
Amended R4-7 appears to require pre-hold preview to use explicit service deposit when present, otherwise an unconfigured/merchant-defined placeholder; post-hold amount should be server-authoritative.
Verify whether client-side shop-default derivation violates the amended contract.

### Claim S3 — payment instruction completeness
Secretary observed an awaiting hold path that checks missing PromptPay number but may not fail closed for missing/non-positive authoritative amount, and `promptpayName` may fall back to shop/fallback name.
Verify whether number, account name and authoritative amount must all be present before displaying payment instruction/QR.

### Claim S4 — readiness/default-value mismatch
Secretary observed readiness currently treats Payment as ready only when PromptPay exists, which may incorrectly mark `require_deposit=false` shops unready.
Secretary also observed Add Service initializes `serviceDeposit` to literal `100`.
Verify both against B1 deposit opt-in semantics and the no-invented-business-truth rule.
## Security and business-truth rules

The review must enforce these distinctions:

**Merchant-configurable business policy must not be guessed or silently overwritten.**
Examples: deposit amount, payment setup, duration, hours, weekly policy, cancellation/reschedule policy.

**System invariants must remain hard and server-enforced.**
Examples: tenant isolation, authorization, collision prevention, payment integrity, idempotency, auditability and fail-closed behavior.

For payment specifically:
- never invent a PromptPay number;
- never invent an account-holder identity;
- never invent a deposit amount;
- do not equate `NULL` with zero;
- a merchant that does not require deposit must not be blocked by payment onboarding;
- a deposit-required payment instruction must fail closed when required verified data is incomplete.

Do not use production `.env.local` as a development/runtime source.
Do not expose or print secrets while reviewing.

## Junction A boundary

R7 remains blocked until House/platform isolation PASS and BK01 independently re-proves Junction A PASS.
Therefore this review and the Claude remediation brief must not authorize:
- WSTERA LAB forward migrations;
- SQL/RPC schema/runtime changes;
- shared-runtime changes;
- Order/Claim live integration;
- PS01/MT01/platform deltas.

Any required server-side work must be listed explicitly as `R7 BLOCKED`, not implemented or disguised as R4.
## Verification commands and evidence

At minimum verify:
- `git status -sb`
- `git log --oneline --decorate 4d352ad..b0f7353`
- `git diff --stat 4d352ad..b0f7353`
- targeted diff of all 19 changed files
- migration/shared-runtime diff is empty
- search for removed/forbidden literals and fallback patterns
- `npm test`
- `npm run lint`
- booking-admin production build with safe placeholder env only if needed
- booking-consumer production build with safe placeholder env only if needed

If a command cannot be run, record exactly why. Never substitute a claim from the handoff.

Review test quality, not only test count:
- map tests to each R4 item;
- identify missing negative cases;
- identify tests whose expected behavior conflicts with amended contract;
- identify code branches that are not exercised;
- distinguish unit/source proof from browser/runtime proof.

No browser/mobile PASS may be claimed unless an approved actual target was used.
The KMO downstream pilot may later serve as browser-proof target, but Codex is not asked to deploy or mutate it in this review.

## Independent review report requirements

The Codex report must contain:
1. branch/ancestry/origin/cleanliness evidence;
2. authoritative contract set and precedence;
3. per-R4-item verdict: PASS / REMEDIATE / BLOCKED BY R7;
4. disposition of S1-S4 with source file:line evidence;
5. all additional findings discovered independently;
6. security/payment analysis;
7. test-quality analysis;
8. source-vs-browser proof boundary;
9. exact R7 residuals;
10. overall verdict.
## Final Claude brief requirements

After completing the independent review, write the final Claude brief from your verified findings only.
Do not merely copy S1-S4; include only claims you independently confirmed, corrected or replaced.

The Claude brief must include:
- exact repo, starting branch and expected starting SHA;
- instruction to continue on `feature/bk01-real-shop-hardening-r4` unless Codex finds a concrete reason to require a new branch;
- no history rewrite, no force push, no merge;
- exact files/functions/lines to change where known;
- one remediation item per logical defect;
- expected behavior before/after;
- tests to add or modify for every remediation;
- explicit payment/security negative cases;
- exact source-only acceptance gates;
- browser/mobile proof matrix for KMO pilot after source review passes;
- residual items that must remain R7-blocked;
- stop conditions and escalation conditions.

Require Claude to make logical commits rather than one bulk commit.
Require Claude to return branch, HEAD, commit list, diff summary, test/lint/build evidence, git status and migration/shared-runtime diff.

## Claude remediation safety constraints

Claude must not:
- touch frozen `520bb08` or amended-doc tip `4d352ad`;
- rewrite R0/R1 evidence to make implementation look compliant;
- alter migrations/RPC/schema while Junction A is blocked;
- use guessed merchant/payment data in tests or source as production truth;
- weaken fail-closed behavior to make UX pass;
- mark browser/mobile acceptance without actual proof;
- merge to coordinator/main;
- deploy customer-facing production as part of this remediation.

If a verified R4 fix depends on R7, Claude must implement only the safe client-side half and document the server residual explicitly.
## Browser/mobile proof matrix Codex must hand to Claude

At minimum preserve these acceptance scenarios for later real-device proof:
- R4-1: change service price; existing merchant deposit remains unchanged.
- R4-2: clear numeric field; it stays visually empty; invalid save is rejected clearly.
- R4-3: type valid HH:MM using keyboard on mobile; arrow-step works; break can be cleared.
- R4-4: edit Staff A and B; save A; B unsaved values survive; reload shows A persisted; leaving while dirty warns.
- R4-5: half-configured shop shows truthful readiness; Preview remains available; no-deposit shop is not marked payment-blocked.
- R4-6: no services, no staff, no schedule, payment incomplete, not-found and runtime-load errors are distinguishable.
- R4-7: deposit-required incomplete payment config shows no QR or guessed payment identity/amount; complete config uses authoritative amount.
- R4-8: countdown follows server expiry rather than a local hardcoded duration.
- R4-9: UI does not invent a 5/15-minute merchant minimum; current RPC compatibility limitation is communicated until R7.
- customer E2E: shop -> service -> staff/provider -> date -> valid slot -> hold/create.

## Verdict taxonomy

Use these terms consistently:
- `PASS_SOURCE`: implementation matches current amended contract at source/unit/build level.
- `REMEDIATE_SOURCE`: source or tests conflict with contract or safety requirement.
- `BLOCKED_R7`: correct behavior requires schema/RPC/runtime work forbidden before Junction A.
- `PROOF_OWED_BROWSER`: source may be correct but actual UX/E2E acceptance is not proven.

Overall R4 may only become `SOURCE_REVIEW_PASS / BROWSER_PROOF_OWED` when no `REMEDIATE_SOURCE` remains.
It must not be labeled fully accepted before real browser/mobile proof.

## Stop conditions for Codex

Stop and report instead of improvising if:
- repository state differs materially from the expected branch chain;
- unknown concurrent source changes appear during review;
- a finding requires secrets or production credentials to verify;
- a proposed remediation would require migration/RPC/shared-runtime change;
- contract documents materially contradict each other after applying Amendment 1 precedence;
- a payment behavior cannot be proven without guessing merchant identity or money values.

## Final instruction

Codex owns the independent judgment for this gate.
The Secretary findings are evidence leads only.
The final Claude brief must be the single actionable remediation authority produced from Codex's own review evidence.
