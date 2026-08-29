# BK01 Data Security & Tenancy

**Status:** LOCKED TARGET V1 — 2026-08-28

## Identity model
- Public customer booking is anonymous by design.
- Merchant users authenticate through Supabase Auth.
- `shop_users` expresses tenant membership and coarse role: owner/admin/staff.
- V1 adds explicit auth-user→staff identity mapping for staff-role self-scope.
- Platform admins are separately authorized and are not ordinary shop members.

## Role contract
| Role | Read scope | Mutation scope |
|---|---|---|
| Customer/public | approved public profile/services/providers/availability; own booking recovery token where explicitly supported | create booking; submit own deposit; self-cancel/reschedule through guarded public flow |
| Owner | full own-shop operational data + billing | shop settings, staff, services, schedules, bookings, billing, export/closure request |
| Admin | full own-shop operational data excluding owner billing/secrets | services, schedules, booking lifecycle, tickets/support operations |
| Staff | own mapped schedule/bookings and minimum customer context needed to serve them | only explicitly allowed own-work actions; never shop-wide administration or shop-wide ticket/support operations |
| Platform operator | support/admin scope only through platform-admin controls | suspension, approved support actions, audited entitlement/admin corrections |

## Tenant isolation
All private tables are RLS-enabled or inaccessible directly to client roles. SECURITY DEFINER RPCs must verify tenant and role internally, use pinned `search_path`, expose minimum parameters and revoke unintended execute grants. Cross-tenant foreign-key/reference mismatches are rejected before mutation.

## Public data boundary
Public clients may access only fields required to display a booking page and calculate availability. Subscription state, owner identity, internal notes, billing IDs, audit records, private customer data and secrets are never exposed through public views.

## Deposit-slip storage
`deposit-slips` target state is private. Upload path is booking-scoped and non-guessable; read access uses short-lived signed/authorized access for merchant review. Permanent public object URLs are prohibited. MIME/size validation occurs at client convenience layer and authoritative storage/server boundary.
## Secrets and provider credentials
Stripe secret/webhook keys, Supabase service-role key, LINE channel secrets/tokens and any auto-slip provider credentials stay server-side only. Merchant-owned LINE credentials require a dedicated secret-storage/configuration boundary; ordinary shop columns, browser local storage and client-readable environment variables are prohibited for raw tokens.

## Audit
At minimum audit booking state/deposit changes, reschedule/cancel/no-show, platform-admin mutations, support-sensitive access, subscription override/correction, export/deletion/closure processing and privileged storage access when feasible. Audit evidence must identify actor, tenant, action, target and timestamp.

## Data lifecycle
- booking/customer operational records: retained while account is active and according to final merchant/legal retention policy;
- deposit slips: shortest operational retention consistent with dispute/support needs; target policy must be approved before public launch;
- tickets/logs/audit: retained according to support/security evidence policy;
- billing records: retention follows Stripe/accounting/legal requirements and cannot be deleted merely because app account closes;
- auth identity: closure procedure coordinates Supabase Auth deletion after required business-data handling.

Exact retention durations are legal/privacy readiness blockers, not values to invent in engineering docs.

## Export/deletion/correction
Owner can request/export core shop data. Data-subject correction/deletion requests must be tenant-verified and routed through the support/privacy process. Deletion must distinguish data that can be removed, anonymized or must be retained for legal/accounting/security reasons.

## Security release baseline
BK01 release verification maps to a current OWASP ASVS-aligned checklist plus BK01-specific invariants: tenant isolation, staff self-scope, public-view minimization, private slip storage, booking collision safety, webhook authenticity/idempotency and privileged-operator audit.

## Baseline gap
The audited `e99615d` implementation does not yet satisfy the target private-slip and staff-self identity contract. Those are BK-A blockers; this document does not claim baseline compliance.
