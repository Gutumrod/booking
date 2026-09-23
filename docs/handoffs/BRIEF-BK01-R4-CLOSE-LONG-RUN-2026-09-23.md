# BRIEF — BK01 R4 CLOSE / LONG-RUN EXECUTION

**Received:** 2026-09-23 (Asia/Bangkok)
**Issued by:** Owner / ChatGPT (Secretary GPT)
**Task id:** BK01-R4-CLOSE-LONG-RUN-2026-09-23
**Coordinator:** Hermes
**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `feature/bk01-real-shop-hardening-r4`

---

## MODE
BK01 / MOVE TO R4 CLOSE — LONG-RUN

Coordinator: Hermes

Execution mode: LONG-RUN
Native-Swarm
Profile: Cloud

ก่อนเริ่มงาน Hermes ต้องโหลดและปฏิบัติตาม Native-Swarm skill ปัจจุบันก่อน dispatch worker ใด ๆ
ห้ามใช้ Relay แทน Swarm สำหรับ long-run นี้

เป้าหมายของรอบนี้คือ:
เดิน BK01 R4 จากสถานะ browser proof partial ไปจนถึง `R4 CLOSED` ถ้าหลักฐานครบจริง
หรือหยุดด้วย blocker ที่แคบ ชัด พิสูจน์แล้ว และเหลือเฉพาะสิ่งที่ต้องการ Owner decision จริง ๆ
ห้ามหยุดถาม Owner ระหว่าง phase เพียงเพราะจบ phase หรือ worker จบงาน

## 1. EXECUTION TARGET

Repo: `D:\AI-Workspace\projects\saas-product-hub\products\booking`
Branch: `feature/bk01-real-shop-hardening-r4`
Resume checkpoint: `021d2427c3f9b35d5b235ce3202436bd382ae729`
Canonical execution worktree: `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`
Canonical reviewed source: `3b3a3338de029a058aa5763c806be42f8a5205ca`

Important:
- `021d242...` is the current documentation/evidence checkpoint.
- Source code reviewed by Codex R9 remains `3b3a333...`.
- The normal repository checkout at `D:\AI-Workspace\projects\saas-product-hub\products\booking` must NOT be used as the R4 execution checkout if it is still on another branch.
- Perform R4 work only from the canonical R4 worktree unless evidence proves the workspace topology has intentionally changed.

## 2. READ FIRST — SOURCE OF TRUTH

Read completely before execution:

- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\CURRENT_STATUS.md`
- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\daily\2026-09-22.md`
- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\handoffs\HANDOFF-BK01-R4-EOD-2026-09-22.md`
- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\audit\r4-2026-09-22\REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md`
- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\audit\r4-2026-09-22\REPORT-BK01-R4-BROWSER-PROOF-PARTIAL-2026-09-22.md`
- `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922\docs\architecture\R4-UX-REMEDIATION-SPEC-2026-09-09.md`

Do not replace these documents with assumptions, old summaries, memory, or stale handoffs.

## 3. CURRENT VERIFIED STATE

Treat the following as the starting state unless fresh preflight disproves it.

Source:
- `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME`
- Codex R9 already independently reviewed canonical source `3b3a333...`.
- Verified at that source: tests 118/118 PASS; lint 0 errors / 12 warnings; Admin build PASS; Consumer build PASS; Admin typecheck PASS; Consumer typecheck PASS; secret/scope checks PASS.
- Do NOT repeat NEW-F18 source review merely because a new long-run started.
- Source remediation may reopen only when new runtime/browser evidence demonstrates a new canonical source defect.

Browser/runtime:
- Current disposition: `BROWSER_PROOF_PARTIAL / KMO_RUNTIME_AND_FIXTURE_BLOCKED`.
- Already proven: public shop profile -> 200; services -> 200 / 2 rows; staff -> 200 / 0 rows; former Services/Staff `is_active` 42501 path is CLOSED.
- Remaining runtime defect already isolated: anon SELECT `staff_schedules.shop_id` = missing; anon SELECT `shop_holidays.shop_id` = missing.
- Positive customer E2E is separately blocked because the current real KMO runtime exposes zero public staff.
- Admin browser/mobile acceptance is still owed.
- **R4 is NOT CLOSED.**

## 4. LONG-RUN OPERATING RULE

- Hermes is the coordinator.
- Use Native-Swarm for bounded work units and evidence production.
- Profile: Cloud
- Follow current Native-Swarm routing/governance exactly.
- Do not silently substitute model/provider/profile.
- Do not call premium executors merely because a worker is slow or a phase is large.
- Any premium escalation must follow the currently installed Swarm governance and produce provenance explaining why escalation occurred.
- Hermes must continue automatically from one completed phase to the next.
- Do NOT pause for Owner between phases.
- Owner approval is required only at a genuine decision boundary defined later in this brief.

## 5. PHASE 0 — PREFLIGHT / FREEZE

Before mutation verify:
- branch
- HEAD
- origin branch HEAD
- worktree cleanliness
- canonical source ancestry
- commit delta from `3b3a333...` to current HEAD
- ports 3100 / 3101
- browser tooling
- latest browser evidence
- runtime target identity

Confirm current HEAD contains no unexpected product source/migration changes after the reviewed source.

Expected current relationship:

```
3b3a333...  canonical reviewed source
    |
021d242...  docs/evidence checkpoint
```

If the difference remains docs/evidence only, proceed.

Required result: `R4_RUNTIME_BASELINE_LOCKED`

If unexpected source or migration drift exists: STOP the affected lane and investigate before acceptance. Do not discard legitimate work automatically.

## 6. PHASE 1 — START EXACT BROWSER PROOF TARGET

Run exact canonical R4 source locally.

Targets:
- Consumer: `http://127.0.0.1:3100`
- Admin: `http://127.0.0.1:3101`

Primary viewports:
- Desktop: 1440x1000
- Mobile: 390x844

Acceptance runtime/environment values must be injected without writing secrets into repository evidence or source files.
Do not use forbidden production-bound `.env.local` as a development shortcut.
Do not modify package/lockfiles merely to run proof.
Do not deploy Cloudflare as part of this lane.

Record: source SHA; target/runtime identity; viewport; network behavior; console behavior; visible UI behavior.

## 7. PHASE 2 — CLOSE KMO AVAILABILITY PRIVILEGE DRIFT

First re-measure live state. Do not assume yesterday's runtime state remains unchanged.

Confirm whether these are still false:
- anon SELECT on `local_service.staff_schedules.shop_id`
- anon SELECT on `local_service.shop_holidays.shop_id`

If already repaired externally: verify resulting privilege boundary and continue.

If still missing: apply the already-approved minimal controlled runtime repair through an approved controlled migration mechanism:
- GRANT anon SELECT only for `staff_schedules.shop_id`
- GRANT anon SELECT only for `shop_holidays.shop_id`

Exact SQL/mechanism must preserve existing runtime architecture and security contract.

This authorization does NOT include:
`GRANT ALL` / table-wide SELECT / INSERT / UPDATE / DELETE / RLS weakening / policy expansion / new public functions / service-role bypass / business-data mutation / uncontrolled raw-SQL workaround / LAB mutation

After repair verify:
RLS unchanged; policies unchanged; table-wide anon SELECT remains absent; anon write access remains absent; no extra columns exposed; business data unchanged.

Then rerun Consumer. Expected result: availability queries no longer fail with 42501.
If KMO still has zero staff, expected UI is a truthful `NO_STAFF` — not `LOAD_ERROR`.

Tooling blocker rule:
If the approved migration mechanism again safety-blocks the exact narrow operation: do not bypass it using arbitrary CLI/raw SQL. Record exact blocker/evidence and continue every R4 lane that does not require this mutation.
Escalate to Owner only when the blocked operation becomes the remaining critical path.

## 8. PHASE 3 — CONSUMER NEGATIVE-STATE ACCEPTANCE

Prove real browser behavior for the required state contract. Cover as applicable:
valid shop / missing-invalid slug / `SHOP_NOT_FOUND` / `LOAD_ERROR` / `BOOKING_DISABLED` / `NO_SERVICES` / `NO_STAFF` / `NO_SCHEDULE` / `NO_SLOT_FOR_DATE` / `PAYMENT_NOT_CONFIGURED` / route transition / desktop responsiveness / mobile responsiveness.

Critical invariant:
- healthy zero rows != query/runtime error
- A zero-staff shop must not be presented as a generic load failure.
- A genuine authorization/network/query failure must not be presented as an empty shop state.

Record visible evidence, network evidence and state classification.
Do not fabricate unavailable runtime states merely to fill a matrix.
Use a safe existing target or isolated fixture where already authorized.

## 9. PHASE 4 — ADMIN R4 BROWSER/MOBILE MATRIX

Execute remaining behavioral acceptance for R4.

- **R4-1** Deposit survives service price editing/save/reload. Price changes must not silently overwrite merchant-entered deposit.
- **R4-2** Numeric input contract: empty during editing allowed; invalid remains visibly invalid; invalid submit does not execute mutation; valid values persist correctly.
- **R4-3** Keyboard-friendly HH:MM behavior. Verify desktop and especially mobile interaction.
- **R4-4** Dirty Staff A/B preservation. Required sequence: edit Staff A; edit Staff B; save Staff A; Staff B unsaved edits remain intact. Also verify dirty-navigation protection where required by the R4 contract.
- **R4-5** Preview + Readiness truth. Verify required surfaces, including applicable: Preview; desktop/mobile; tickets; list; new; detail; readiness state. Readiness must reflect actual configuration rather than false green status.
- **R4-6** Consumer truthful-state contract, coordinated with Phase 3.
- **R4-7** Invalid/unconfigured payment must block: QR; amount presentation that is not authoritative; copy; download; slip flow. No hardcoded/fabricated PromptPay recipient or amount.
- **R4-8** Countdown follows server `expires_at`, not a separately invented local 900-second authority.
- **R4-9** Verify supported duration behavior including 1 / 2 / 37 / 90 according to the locked current R4 contract and actual server capability.

If browser evidence proves a source/server mismatch that prevents the contract from being satisfied, classify it accurately rather than forcing PASS.

## 10. PHASE 5 — CROSS-CUTTING REGRESSION

After individual acceptance, verify cross-cutting behavior. Required areas:
multi-shop tenant consistency; current-shop authority; route transition; stale request rejection; out-of-order response rejection; dirty-state preservation; payment truth; readiness truth; tenant change while async work is in flight.

Relevant previously source-accepted protections include NEW-F12 through NEW-F17.
Do not reopen these solely to re-read source.
Reopen only if browser evidence contradicts their accepted behavior.

Any new finding must be classified as:
`GENERIC_BK01_SOURCE_DEFECT` / `TARGET_RUNTIME_DRIFT` / `FIXTURE_LIMITATION` / `TEST/PROOF_INFRASTRUCTURE` / `OUT_OF_SCOPE` — with evidence.

## 11. PHASE 6 — POSITIVE CUSTOMER E2E

Required positive target:
shop -> service -> staff/resource -> date -> valid slot -> hold -> create/booking
plus relevant negative cases around the same path.

Fixture priority:
1. existing safe fixture
2. existing isolated authorized test runtime
3. temporary KMO business fixture only with explicit Owner approval

Critical boundary:
Hermes and Swarm must NOT create, activate or alter real KMO staff/schedule business data merely to make acceptance pass.
If no authorized positive fixture exists, finish all other possible R4 work first.
Only then surface `POSITIVE_E2E_FIXTURE_AUTHORIZATION_REQUIRED` to Owner.
This is a genuine Owner decision boundary.

## 12. SOURCE DEFECT HANDLING

If browser/runtime evidence demonstrates a new canonical BK01 defect:
- freeze the evidence;
- identify exact failing contract;
- inspect source;
- design the smallest remediation;
- implement only the affected scope;
- run focused + mandatory verification;
- obtain the required independent source review if the source authority changed;
- resume browser acceptance at the newly reviewed exact SHA.
Do not restart R4 from the beginning. Preserve all still-valid prior evidence.

## 13. OWNER DECISION BOUNDARIES

Hermes must NOT stop for routine transitions. Continue automatically for:
preflight; read-only inspection; starting local apps; browser testing; test/lint/typecheck/build; evidence collection; approved narrow KMO predicate-column repair; documentation updates; safe source remediation inside R4 when clearly evidenced; Swarm dispatch/retry under current governance; commit/push of verified in-scope work.

Stop and request Owner decision only for:

- **A. Real KMO business-data mutation.** Examples: create staff; activate staff; create/change staff schedule; alter actual shop configuration merely for test fixture.
- **B. Scope expansion outside R4.** Examples: R7; Junction A; formal Junction B; Order-live; Claim-live; shared LAB/runtime migration; SB01 integration.
- **C. Security-boundary expansion.** Examples: broad grant; RLS weakening; policy expansion; service-role/browser bypass; new public write capability.
- **D. No safe positive fixture remains.** Only after all other possible acceptance work is completed.

## 14. HARD BOUNDARIES

Do NOT perform:
Junction A retry; HOUSE platform remediation; WSTERA LAB/shared-runtime mutation; runtime R7; formal Junction B; Order-live integration; Claim-live integration; SB01 integration; KMO Security Advisor cleanup unrelated to R4 blocker; architecture refactor; feature expansion; NEW-F18 re-review without contradictory evidence.

HOUSE-A remains a hard prerequisite for those separate lanes.
Do not fold unrelated security debt into R4 merely because it is visible.

## 15. VERIFICATION BEFORE R4 CLOSE

Before declaring closure run fresh mandatory gates appropriate to the final source:
- `npm test`
- `npm run lint`
- Admin production build
- Consumer production build
- Admin typecheck
- Consumer typecheck
- `git diff --check`
- secret scan
- protected-scope scan
- `git status`
- branch verification
- HEAD/origin parity

Review the R4 browser/mobile evidence matrix against the locked R4 specification.
A green automated suite is not sufficient for R4 closure. Browser/mobile behavioral evidence is mandatory.

## 16. R4 CLOSE GATE

Declare `R4 CLOSED` only when evidence supports all required contracts, including positive customer E2E.

Required closure state:
`SOURCE PASS` / `CONSUMER ACCEPTANCE PASS` / `ADMIN ACCEPTANCE PASS` / `CROSS-CUTTING REGRESSION PASS` / `POSITIVE CUSTOMER E2E PASS` / `MANDATORY AUTOMATED GATES PASS` / `EVIDENCE COMPLETE`

No partial PASS may be promoted to `R4 CLOSED`.

## 17. ACCEPTABLE NON-CLOSED END STATE

If the only remaining blocker is authorization for a positive fixture, the desired long-run result is:
`SOURCE PASS` / `KMO AVAILABILITY DRIFT CLOSED` / `CONSUMER NEGATIVE-STATE MATRIX PASS` / `ADMIN R4 MATRIX PASS` / `CROSS-CUTTING REGRESSION PASS` / `POSITIVE E2E BLOCKED ONLY BY FIXTURE AUTHORIZATION` / `R4 NOT CLOSED`

At that point stop and present Owner with the exact decision required.
Do not ask Owner to re-decide already-approved work.

## 18. DOCUMENTATION / EVIDENCE

Maintain durable evidence as work progresses. Update at minimum where appropriate:
- `docs/CURRENT_STATUS.md`
- `docs/10_DEVELOPMENT_ROADMAP.md`
- `docs/MASTER_CHECKLIST.md`
- `docs/DOCUMENTATION_INDEX.md`
- `docs/daily/2026-09-23.md`
- `docs/audit/r4-2026-09-23/`

On closure create a dedicated R4 closure report.
If R4 cannot close, create a continuation report showing the exact residual blocker.
Documentation must describe observed reality, not intended future state.

## 19. GIT HYGIENE

Keep canonical worktree clean between bounded commits.
Do not commit: secrets; real env files; browser caches; generated build artifacts; temporary Playwright artifacts not intended as evidence; `node_modules`; unrelated files.

Before any final push: inspect diff; verify scope; verify tests/gates; verify no secrets; verify HEAD/branch.
Commit messages must describe actual changes.
Push only verified in-scope work.

At final handoff report include:
Repo / Branch / Checkpoint / Canonical reviewed source / R4 status / Browser status / Tests / Builds / Typechecks / Runtime mutations / Evidence / Remaining blocker / Owner decision required / Next action.

## 20. LONG-RUN STOP CONDITIONS

Hermes continues until one of these conditions is reached:

- **SUCCESS** — `R4 CLOSED` with complete evidence and clean pushed checkpoint.
- **LEGITIMATE OWNER BLOCKER** — only a decision listed in Section 13 remains.
- **HARD TECHNICAL BLOCKER** — a required external mechanism is inaccessible and no authorized safe continuation exists. In this case report: exact failed action; observed evidence; what has already been proven; what was NOT attempted; why bypass is forbidden; remaining unaffected work completed; single next action required.

Do not stop merely because: a phase ended; a worker ended; a worker asked a question that can be answered from SoT; one attempt failed; browser must be restarted; a bounded source fix requires another verification cycle.

## 21. FINAL COMMAND

Load current Native-Swarm skill.
Use: Profile: Cloud / Mode: Long-Run
Read all canonical R4 evidence first.
Freeze exact execution baseline.
Then execute continuously:
Preflight -> Runtime availability repair -> Consumer acceptance -> Admin acceptance -> Cross-cutting regression -> Positive E2E -> Final verification -> Documentation -> Commit/push -> R4 CLOSE

Do not claim success without observed evidence.
Do not fabricate fixtures, browser results, runtime state or PASS conditions.

**MOVE TO R4 CLOSE.**
