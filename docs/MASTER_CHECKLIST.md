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
- [ ] private deposit-slip storage/read path
- [ ] auth-user→staff mapping and staff self-scope
- [ ] annual UI/copy removed; monthly billing truth reconciled
- [ ] legacy paid booking quota wall retired/remediated
- [ ] merchant-owned LINE OA secret/config boundary
- [ ] confirmation + reminder automation evidence
- [ ] Pro automatic slip verification + cost/allowance/failure policy
- [ ] controlled PromptPay QR generation
- [ ] customer self-reschedule/cancel atomic flow
- [ ] completion/no-show operational actions + analytics
- [ ] owner CSV export + deletion/account-closure request path
- [ ] platform-admin/support privileged audit verification
- [ ] unsupported absolute public copy (including `ปลอดภัย 100%`) removed or replaced using `SHIPPED-VERIFIED` evidence
- [ ] commercial UI/copy reconciled with PD-002/PD-003/PD-008: no annual offer, no legacy 100/500 paid wall, and no provisional price presented as final

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
