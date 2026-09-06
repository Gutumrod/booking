# BK01 — Build-to-Sell Execution Brief

**Owner direction:** BUILD-TO-SELL. Module Hub Scan and non-essential new gates are deferred.
**Verified pre-execution baseline:** branch `feature/bk-a-v1-contract-remediation`, HEAD `6e1c0c6`; tracked source matched origin before BK-SR-01. This brief itself was untracked at handoff and is part of the reconciliation change.
**Council:** Product PASS; Business/Market PASS. Trial/Basic/Pro are pilot/reference packaging, not final public pricing.

## Sell-ready destination
BK01 is ready to sell when a new merchant can be onboarded, configure booking rules, accept real bookings, operate admin flows, recover safely, receive support, and deploy/rollback without WSTERA manual intervention being the hidden dependency.

## Locked boundaries
- Booking V1 is the active product. Order implementation stays deferred until Booking release/pilot decision.
- Merchant-owned LINE OA remains the V1 commercial model.
- Pro auto-slip is not publicly sellable until provider/economics/reliability/failure-path evidence is complete.
- No transaction/commission model in V1.
- No final public price lock before pilot/unit-economics evidence.

## Execution sequence
### BK-SR-01 — Reconcile CONT-04 closure and release baseline — CLOSED
Record `CONT04_PASS` on current status/roadmap/checklists, link durable closure evidence (migration 29/29; final pgTAP 26/26), and remove stale `BLOCKED_ENVIRONMENT` wording from current/future-facing documents without rewriting historical evidence.

### BK-SR-02 — BK-B release/repository readiness — CLOSED at `d2ee14f`
Run fresh CI/test/lint/build/diff/security checks on the current release candidate. Prove consumer/admin production builds, database/RLS negatives, concurrency, role denial, support/platform-admin boundaries, and clean-clone reproducibility.

### BK-SR-03 - Staging + external-system rehearsal - ACTIVE / BLOCKED_PENDING_APPROVED_RUNTIME at `e65366f`
Use approved non-production runtime only. Staging isolation and local release verification are PASS. External deploy/smoke/rollback and LINE/Stripe rehearsal remain blocked until approved Cloudflare staging authentication and a populated `.env.staging.local` provide isolated non-production Supabase, non-production LINE OA, and Stripe test credentials. Never substitute `.env.local` or production/KMO credentials.
### BK-SR-04 — Pilot-ready onboarding and operations
Create merchant onboarding checklist, configuration checklist, support/incident path, backup/restore proof, operator ownership, and pilot instrumentation for activation, booking integrity, no-show/cancel/reschedule, support burden, notification consumption, and WTP.

### BK-SR-05 — Commercial lock and public launch
After pilot evidence: approve final public Basic/Pro prices, auto-slip commercial terms, merchant LINE cost disclosure, cancellation/reschedule defaults, public claims, support promise, and launch checklist. Public Pro requires auto-slip evidence.

## Immediate next ticket
**Continue BK-SR-03 staging + external-system rehearsal from `e65366f`.** Local/staging-isolation verification is complete and durable evidence is reconciled by the current checkpoint. After the reconciliation commit/push, authenticate/configure approved staging and execute dry-run -> deploy -> smoke -> external rehearsal -> rollback/redeploy. BK-SR-01 and BK-SR-02 remain CLOSED. Do not start Order implementation.

## Definition of done
- One exact release commit has passing release/security/database evidence.
- Staging deploy + rollback + recovery are proven.
- Merchant onboarding can be followed from documentation.
- Pilot can run without KMO infrastructure or KMO-specific code.
- Remaining commercial unknowns are explicitly pilot measurements, not hidden blockers.

## Stop / escalate
Stop only for a real product defect, missing approved runtime/provider access, security boundary conflict, or Owner-only commercial decision. Do not open new research/Council work merely because an older portfolio pipeline says it is next.
## TEMPORARY EXECUTION LOCK — CLAUDE SESSION LIMIT

Owner direction recorded: 2026-09-06 12:22 Asia/Bangkok (+07:00).
Estimated Claude session reset from Owner report: approximately 2026-09-06 14:05 Asia/Bangkok (+07:00), about 1h43m from the recorded start time.

- Build-to-Sell is the current priority.
- Do NOT open Council, Module Hub Scan, or unrelated new work that does not directly enable sell / deploy / onboard / support.
- Claude is temporarily session-limited. Do NOT dispatch new work to agent-claude before the estimated reset time above.
- At or after 14:05 (+07:00), verify Claude availability before dispatch; the reset time is approximate and must not be treated as guaranteed capacity.
- Existing work already completed by Claude remains valid evidence. Existing partial work must be preserved; do not restart it solely because the provider hit a limit.
- If work must continue before reset, use an already-approved alternate agent only when the existing task can be resumed without scope change.

Owner can override this temporary lock explicitly at any time.
## CLAUDE SESSION LOCK — RELEASED
Owner confirmed at **2026-09-06 14:08 Asia/Bangkok (+07:00)** that the Claude session limit has reset.
- This supersedes the temporary Claude lock above.
- New dispatch to `agent-claude` is permitted again.
- Preserve completed and partial work; resume existing tasks instead of restarting them.
- Build-to-Sell remains the active priority. Do not open Council, Module Hub Scan, or unrelated work.
