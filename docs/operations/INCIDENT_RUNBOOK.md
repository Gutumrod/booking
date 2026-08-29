# BK01 Incident Runbook

**Status:** LOCKED TARGET OPERATIONS — 2026-08-28

## Severity
- **SEV-0:** suspected cross-tenant/private-slip/secret exposure, booking corruption affecting multiple tenants, or unauthorized privileged action. Stop affected access/release immediately and preserve evidence.
- **SEV-1:** public booking outage, systematic double-booking risk, Stripe entitlement drift, widespread auth/LINE/deposit verification failure.
- **SEV-2:** tenant-limited degraded workflow with safe workaround.
- **SEV-3:** minor defect/no material customer-data or money risk.

## Universal response
Detect → classify → stop further harm → preserve logs/evidence → identify affected tenants/entities → restore safe service → verify invariants → communicate through approved channel → write incident record and follow-up remediation.

## Playbooks
- **Cross-tenant exposure:** disable offending surface/RPC, rotate compromised credential if applicable, preserve access logs, enumerate exposure, legal/privacy escalation before external notification wording.
- **Booking collision/corruption:** pause affected booking creation, preserve booking/history rows, identify overlapping intervals, repair only through reviewed reconciliation, notify merchants where action is required.
- **Public booking outage:** verify Cloudflare Worker/routing → Supabase availability → provider dependency; fail with unavailable state rather than accepting unverified bookings.
- **Stripe drift:** stop entitlement-changing manual edits, compare Stripe event/subscription truth with DB, replay/reconcile idempotently.
- **LINE failure:** booking remains authoritative; retry according to provider rules, expose failed delivery and merchant fallback.
- **Slip exposure:** remove public access immediately, invalidate URLs where possible, inventory accessed objects/logs, privacy escalation.
- **Auth/Supabase degradation:** fail closed for merchant actions; never bypass auth/RLS to restore convenience.
- **Quota/entitlement bug:** prevent unfair blocking/overcharge, preserve ledger, reconcile affected shops before re-enabling enforcement.
- **Operator misuse:** revoke access, preserve audit, owner/security escalation; never delete audit evidence.
## Explicit infrastructure playbooks
- **Cloudflare deployment/routing failure:** stop further rollout; compare deployed Worker artifact/config to last known good; validate canonical host routing and both Worker health endpoints; rollback only to a tested compatible artifact or apply reviewed forward-fix; rerun auth, booking, Stripe callback and LINE callback smoke gates before reopening traffic.
- **Database/Supabase degradation:** determine whether Auth, Postgres, Storage or API gateway is degraded; fail closed for writes that cannot preserve booking/tenant/money invariants; do not bypass RLS/RPC boundaries; preserve failed transaction evidence; after recovery verify tenant reads, booking collision constraints, subscription state and private-slip access before normal operations resume.

Both playbooks require an incident record containing start/end time, affected tenants/surfaces, evidence, mitigation, verification and follow-up owner.
