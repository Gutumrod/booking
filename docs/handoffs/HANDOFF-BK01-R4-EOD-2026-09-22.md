# HANDOFF — BK01 R4 End of Day 2026-09-22

## Resume Contract
Repo: `D:\AI-Workspace\projects\saas-product-hub\products\booking`
Worktree: `D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`
Remote: `https://github.com/Gutumrod/booking.git`
Branch: `feature/bk01-real-shop-hardening-r4`
Source checkpoint: `3b3a3338de029a058aa5763c806be42f8a5205ca`

Read and execute:
1. `docs/CURRENT_STATUS.md`
2. `docs/daily/2026-09-22.md`
3. `docs/audit/r4-2026-09-22/REPORT-CODEX-BK01-R4-SOURCE-RE-REVIEW-R9-2026-09-22.md`
4. `docs/audit/r4-2026-09-22/REPORT-BK01-R4-BROWSER-PROOF-PARTIAL-2026-09-22.md`
5. `docs/architecture/R4-UX-REMEDIATION-SPEC-2026-09-09.md`

## Current Gate
`SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME` is valid at exact source checkpoint `3b3a333...`.
Browser proof is only partial.
Current browser disposition is `BROWSER_PROOF_PARTIAL / KMO_RUNTIME_AND_FIXTURE_BLOCKED`.
R4 is NOT CLOSED.
## Verified
- Local branch/HEAD/origin were equal and clean at documentation-closure start.
- NEW-F18 Services/Staff runtime path is closed: shop profile 200, services 200/2 rows, staff 200/0 rows.
- `staff_schedules` and `shop_holidays` have RLS enabled and anon SELECT policies.
- Narrow approved public payload columns were restored on KMO without changing business data.
- Both availability queries predicate on `shop_id`.
- KMO anon lacks SELECT on `staff_schedules.shop_id` and `shop_holidays.shop_id`; this is the remaining 42501 cause.
- Managed migration tooling blocked the final two-column repair; it was not bypassed.
- KMO currently has no public staff rows, so positive hold/create E2E cannot be proven without authorized fixture data.
- Admin browser/mobile R4 acceptance remains owed.

## Required Next Order
1. Re-run preflight: branch, HEAD/origin, clean worktree, ports 3100/3101, latest browser evidence, live KMO privileges.
2. Through an approved controlled migration mechanism, grant anon SELECT only on `staff_schedules.shop_id` and `shop_holidays.shop_id`.
3. Verify RLS/policies unchanged; verify no table-wide SELECT, write privilege or extra public columns.
4. Re-run Consumer desktop 1440x1000 and mobile 390x844 against `/book/kmo-rackbarcustom`.
5. Confirm no generic LOAD_ERROR from schedules/holidays; if staff remains zero, prove truthful `NO_STAFF` only.
6. Resolve positive-flow fixture authorization, then prove `shop -> service -> staff -> date -> valid slot -> hold/create`.
7. Finish the Admin browser/mobile R4 acceptance matrix with visible behavioral evidence.
## Hard Boundaries
- Do not reopen source remediation unless new browser/runtime evidence proves a canonical BK01 source defect.
- Do not create or activate KMO staff/schedule business data without Owner authorization.
- Do not use broad grants, `GRANT ALL`, RLS weakening, policy expansion or uncontrolled SQL bypass.
- Do not treat KMO Security Advisor debt as implicit R4 scope unless a finding blocks R4 acceptance.
- Do not retry Junction A, mutate LAB/shared runtime, start runtime R7, formal Junction B, Order-live or Claim-live work before durable HOUSE-A PASS.
- SB01 is not a blocker for this R4 browser lane and must not be folded into BK01 billing automatically.

## R4 Acceptance Still Owed
- R4-1 deposit survives price save/reload.
- R4-2 numeric empty state remains empty and invalid save is clear.
- R4-3 keyboard HH:MM behavior.
- R4-4 dirty Staff A/B preservation.
- R4-5 Preview desktop/mobile, tickets/list/new/detail and readiness truth.
- R4-6 valid/missing/no-service/no-staff/load-error/route transition.
- R4-7 invalid payment blocks QR/amount/copy/download/slip.
- R4-8 countdown follows server `expires_at`.
- R4-9 durations 1/2/37/90.
- Multi-shop tenant consistency, stale/out-of-order response behavior and positive hold/create E2E.

## Stop Rule
Only declare `R4 CLOSED` when real browser/mobile evidence covers the required matrix. Source PASS alone is insufficient.
