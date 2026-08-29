# BK01 Support Runbook

**Status:** LOCKED TARGET OPERATIONS — 2026-08-28

## Access principle
Support gets the minimum data and privilege needed to resolve a documented case. Platform-admin membership is separate from tenant membership. No undocumented impersonation, password sharing or direct production-data editing.

## Support intake
Record tenant/shop, reporter identity/contact, affected booking/entity IDs, issue type, severity, timestamps, reproduction/evidence and customer-visible impact. Sensitive credentials/slip images must not be copied into ordinary ticket comments when a controlled reference is sufficient.

## Allowed support actions
- inspect platform-level shop/subscription/support metadata through authorized surfaces;
- suspend/restore a shop when required and authorized;
- extend trial or correct plan label only under documented business/support reason and audit;
- guide merchant through supported recovery/export/closure workflows;
- escalate engineering/security/billing/provider incidents.

## Prohibited actions
- silently change booking/deposit truth to “make it work”;
- read unrelated tenant/customer data;
- obtain merchant passwords or raw provider secrets;
- impersonate a merchant without an explicit audited product mechanism and policy;
- delete audit/billing evidence to resolve a complaint;
- promise refunds, legal outcomes or provider uptime outside approved policy.

## Escalation
SEV-0/1 uses `INCIDENT_RUNBOOK.md`. Billing disputes involving Stripe truth, privacy/data requests, suspected security incidents and merchant deposit/refund disputes are routed to the appropriate owner/operator/legal review path rather than improvised in support.

## Data requests
Owner export: verify tenant ownership → generate approved core CSV export → deliver through controlled mechanism → record completion. Correction/deletion/account closure: verify requester and scope → classify records removable/anonymizable/retained → execute approved procedure → record outcome and exceptions.
## Merchant ticket role boundary
Target V1 merchant ticket operations are owner/admin only. Staff users do not read or mutate shop-wide tickets/timelines. The current baseline migration is broader and is a BK-A authorization blocker recorded as `ROLE-003`.

## Response expectations
These are internal operating targets, not a public contractual SLA. Public support hours and any customer-facing SLA require explicit owner approval before launch.
- **SEV-0:** acknowledge/assign within 15 minutes; active incident updates at least every 30 minutes until containment.
- **SEV-1:** acknowledge/assign within 1 hour; update at least every 4 hours while materially unresolved.
- **SEV-2:** acknowledge within 1 business day; provide next-action/owner or workaround in the first substantive response.
- **SEV-3:** acknowledge within 2 business days; schedule into normal support/product triage.
- Security/privacy incidents bypass normal queue ordering and follow incident/legal escalation immediately.

If staffing or coverage cannot meet these targets, launch documentation must be updated with approved support hours/targets rather than silently missing them.
