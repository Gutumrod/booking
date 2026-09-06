# BK01 Master Checklist

**Status:** BK-0 governance checklist — 2026-08-28

## BK-0 documentation lock
- [x] baseline branch/commit recorded (`main @ e99615d`)
- [x] mandatory governing docs/code/routes/migrations audited
- [x] contradictions ledger created
- [x] current market/source ledger created
- [x] segmentation, competitor landscape and ICP/JTBD created
- [x] owner decision queue surfaced and full recommendation set approved
- [x] numbered SSOT 00–10 created
- [x] feature traceability created with one disposition per capability
- [x] marketing/GTM/launch/KPI pack created
- [x] deployment/incident/backup/support/legal-privacy pack created
- [x] authority order and ADR/change-control defined
- [x] final cross-document audit complete with no unresolved P0/P1 documentation contradiction
- [x] independent documentation reviewer PASS
- [x] owner authorizes commit/push

## BK-A implementation blockers from approved V1 contract
Implementation snapshot (2026-08-29): code/static/build work is recorded in `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`. Original blocking condition: clean DB replay, pgTAP, tenancy, and provider-backed gates proven.

**2026-09-06 CONT-04 reconciliation:** DB-backed gates are now PASS — `CONT04_PASS` at HEAD `6e1c0c6`: 29/29 migration replay, pgTAP 26/26, G3 8/8 / G4 10/10 / G5 22/22 / G6A 10/10 / G6B 8/8 / G7 8/8 / G8 9/9 / G9 9/9 — all PASS; WSTERA Lab runtime, production not accessed. Evidence: `docs/CURRENT_STATUS.md` §Verified Current State and `.secretary-relay/t_ef1cef98/CONT04-FINAL-EVIDENCE-2026-09-06.json`. Items blocked solely by DB-backed evidence are marked [x]; items requiring real LINE-provider runtime or Owner pricing approval remain [ ].

- [x] private deposit-slip storage/read path — *CONT04_PASS: deposit RLS/storage gates G5/G6A PASS (HEAD 6e1c0c6)*
- [x] auth-user→staff mapping and staff self-scope — *CONT04_PASS: auth/role gate G4 10/10 PASS (HEAD 6e1c0c6)*
- [x] annual UI/copy removed; monthly billing truth reconciled — *CONT-03 static PASS (no annual offer) + CONT04_PASS G8 billing 9/9 PASS (HEAD 6e1c0c6)*
- [x] legacy paid booking quota wall retired/remediated — *CONT-03 static PASS (no legacy 100/500 paid claim) + CONT04_PASS entitlement gates G3/G4 PASS (HEAD 6e1c0c6)*
- [ ] merchant-owned LINE OA secret/config boundary — *DB boundary G6B 8/8 PASS (CONT04_PASS); real LINE-provider runtime evidence still required*
- [ ] confirmation + reminder automation evidence — *real LINE message delivery evidence required (not covered by DB gates)*
- [ ] Pro automatic slip verification + cost/allowance/failure policy — *real auto-slip provider integration evidence required*
- [ ] controlled PromptPay QR generation — *CONT-03 static: no promptpay.io; runtime implementation evidence required*
- [x] customer self-reschedule/cancel atomic flow — *CONT04_PASS: concurrency/atomic gate G5 22/22 PASS (HEAD 6e1c0c6)*
- [x] completion/no-show operational actions + analytics — *CONT04_PASS: completion gate G7 8/8 PASS (HEAD 6e1c0c6)*
- [x] owner CSV export + deletion/account-closure request path — *CONT04_PASS: platform gate G9 9/9 PASS (HEAD 6e1c0c6)*
- [x] platform-admin/support privileged audit verification — *CONT04_PASS: support/platform-admin audit gate G9 9/9 PASS (HEAD 6e1c0c6)*
- [ ] unsupported absolute public copy (including `ปลอดภัย 100%`) removed or replaced using `SHIPPED-VERIFIED` evidence — *CONT-03 static removal confirmed; ongoing SHIPPED-VERIFIED claim management required*
- [ ] commercial UI/copy reconciled with PD-002/PD-003/PD-008: no annual offer, no legacy 100/500 paid wall, and no provisional price presented as final — *Owner pricing approval required (BK-C)*

## BK-A runtime closure checkpoint — 2026-09-06
- [x] CONT-04 final verdict = `CONT04_PASS` on approved WSTERA Lab only
- [x] migration history verified `29/29`
- [x] pgTAP contract `26/26 PASS`; pgTAP extension removed after run
- [x] DB-backed G3-G9 accepted with zero fixture residue
- [x] unit/static `19/19`, lint PASS, consumer build PASS, admin build PASS recorded in final closure evidence
- [x] production not accessed during CONT-04 verification
- [x] closure remediations committed at `6e1c0c6`

The capability checklist above is preserved as the original BK-A implementation checklist. `CONT04_PASS` closes its former database/runtime blocker; it does not convert downstream external-provider, deployment, pricing, legal/privacy, or public-launch evidence into PASS. Canonical closure summary: `docs/audit/CONT04-CLOSURE-EVIDENCE-2026-09-06.md`.

## BK-SR-02 / BK-B release checkpoint — 2026-09-06
- [x] dependency audit remediation limited to `package-lock.json`: `qs 6.15.3 -> 6.16.0`
- [x] exact release checkpoint committed at `d2ee14f`
- [x] `npm ci` PASS with 0 vulnerabilities
- [x] `npm audit --omit=dev` PASS with 0 vulnerabilities
- [x] unit/static tests PASS 19/19
- [x] lint PASS with 0 errors (13 existing warnings)
- [x] consumer + admin production builds PASS
- [x] `git diff --check` PASS
- [x] exact clean-clone verification of `d2ee14f` PASS; clone status clean

BK-SR-02 / BK-B is CLOSED. BK-SR-03 staging/external-system rehearsal is next; this does not waive provider, deployment, legal/privacy or commercial gates.
## BK-C/BK-D downstream commercial and public-launch gates
- [ ] final Basic/Pro public prices approved by owner
- [ ] final Pro auto-slip provider, included allowance, unit cost/top-up and failure policy approved
- [ ] any WSTERA-managed LINE allowance and cost model approved before it is offered
- [ ] production backup capability verified against proposed targets
- [ ] final RPO/RTO explicitly approved
- [ ] final retention durations approved for booking, customer, slip, ticket, audit and backup data
- [ ] `past_due` grace duration/policy implemented, tested and approved
- [ ] qualified legal/privacy review completed
- [ ] final competitor refresh completed before commercial lock
- [ ] final public marketing claims limited to `SHIPPED-VERIFIED` evidence
- [ ] support hours and customer-facing SLA wording approved, if any is offered
- [ ] all BK-A technical and release gates PASS before public V1
