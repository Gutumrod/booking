# BK01 Product Requirements Document

**Status:** LOCKED — Owner approved 2026-08-28
**Baseline audited:** `main @ e99615d`
**Scope:** Target V1 contract. BK-A implements/remediates gaps.

## Requirement conventions
- `FR-*` functional requirement
- `SEC-*` security/tenancy requirement
- `REL-*` reliability requirement
- `OPS-*` operational requirement
- `NFR-*` non-functional requirement

## Account and onboarding
| ID | Requirement | V1 |
|---|---|---|
| FR-AUTH-001 | Merchant owner can sign up with email/password and complete verification when required by Supabase Auth. | Required |
| FR-AUTH-002 | User can login, logout, recover password and recover cleanly from session expiry. | Required |
| FR-ONB-001 | Authenticated owner can provision exactly one V1 shop with unique slug, business category, owner identity and PromptPay recipient details. | Required |
| FR-ONB-002 | Provisioning is idempotent and cannot create duplicate shops on retry. | Required |
| FR-ONB-003 | V1 canonical technical host is `bk01.wstera.com`; customer/admin routing must preserve two-Worker deployment boundaries. | Required |

## Service and provider setup
| ID | Requirement | V1 |
|---|---|---|
| FR-SVC-001 | Owner/admin can create, edit, activate and deactivate services with duration, price and deposit amount. | Required |
| FR-STF-001 | Owner can create/activate/deactivate providers subject to plan entitlement. | Required |
| FR-STF-002 | Auth users mapped to staff identity can view only their own operational booking/schedule scope; owner/admin can view shop scope. | Required |
| FR-SCH-001 | Owner/admin can maintain provider weekly hours, breaks, shop closures and provider time-off. | Required |
| FR-SCH-002 | Missing provider schedule is fail-closed and must not produce bookable availability. | Required |
## Booking and deposit flow
| ID | Requirement | V1 |
|---|---|---|
| FR-BKG-001 | Public customer can open a shop booking page without creating a customer app account. | Required |
| FR-BKG-002 | Customer can select service, provider or Any Staff, date and an available time. | Required |
| FR-BKG-003 | Availability excludes closures, time-off, missing schedules, breaks and overlapping active bookings. | Required |
| FR-BKG-004 | Booking creation is atomic and collision-safe under concurrency. | Required |
| FR-BKG-005 | Deposit-required booking creates a temporary hold; no-deposit booking may confirm immediately. | Required |
| FR-BKG-006 | Hold expiry releases capacity and stale holds cannot block future booking. | Required |
| FR-DEP-001 | PromptPay QR is generated inside the approved BK01 dependency boundary; no public `promptpay.io` runtime dependency. | Required |
| FR-DEP-002 | Slip upload accepts approved image types/size only and stores objects privately. | Required |
| FR-DEP-003 | Merchant can reject/verify submitted slip; target Pro provides automatic verification with auditable result/failure state. | Required |
| FR-DEP-004 | Duplicate transaction reference, provider failure and ambiguous verification must fail safely without auto-confirming money state. | Required |

## Appointment lifecycle
| ID | Requirement | V1 |
|---|---|---|
| FR-LIFE-001 | Owner/admin can cancel active bookings with reason and audit history. | Required |
| FR-LIFE-002 | Customer can cancel/reschedule within merchant policy; mutation must be atomic and preserve audit history. | Required |
| FR-LIFE-003 | Owner/admin can mark completed and no-show; both are measurable terminal outcomes. | Required |
| FR-LIFE-004 | Blacklist is optional V1 only after explicit block/unblock UX and booking behavior exist. | Optional |
| FR-LIFE-005 | Customer history is tenant-scoped and supports operational lookup without becoming a marketing CRM promise. | Required |
## LINE, billing, support and data rights
| ID | Requirement | V1 |
|---|---|---|
| FR-LINE-001 | Confirmation and at least one pre-appointment reminder are required notification events with sent/failed audit evidence. | Required |
| FR-LINE-002 | Paid production supports merchant-owned LINE OA; central WSTERA OA is limited to trial/onboarding mode. | Required |
| FR-LINE-003 | Notification failure never mutates authoritative booking state and exposes recoverable operator evidence. | Required |
| FR-BILL-001 | Trial, Basic and Pro state are sourced from authoritative subscription data; Stripe webhook state is idempotent and out-of-order safe. | Required |
| FR-BILL-002 | Only monthly paid billing is public V1; annual billing UI/copy is removed until annual prices exist. | Required |
| FR-BILL-003 | Paid booking volume is not constrained by legacy 100/500 value walls; fair-use guard may exist for abuse/reliability only. | Required |
| FR-BILL-004 | Variable-cost automation allowances such as auto-slip/managed LINE are explicit and measurable. | Required |
| FR-DATA-001 | Owner can export core business data in CSV. | Required |
| FR-DATA-002 | Export, deletion and account-closure requests have an operator process and audit trail. | Required |
| FR-SUP-001 | Owner/admin can create, read and update tenant support tickets; staff has no shop-wide ticket access in V1. Ticket/case remains an operational capability, not a lead purchase claim. | Required |
| FR-OPS-001 | Platform admin actions are authenticated, authorized and auditable; no hidden impersonation. | Required |

## Security and reliability
| ID | Requirement | V1 |
|---|---|---|
| SEC-TEN-001 | Every private tenant read/write is scoped to an authorized shop membership and role. | Required |
| SEC-TEN-002 | Public surfaces expose only the minimum approved booking/profile data. | Required |
| SEC-STO-001 | Deposit slips are private and accessed only through authorized/signed mechanisms. | Required |
| SEC-PRIV-001 | Secrets never enter client bundles, documentation, logs or tenant-visible data. | Required |
| REL-001 | Booking collision prevention is authoritative at database level and tested under concurrency. | Required |
| REL-002 | External-provider failure is fail-safe and observable; Stripe/LINE/slip verification retries are idempotent where applicable. | Required |
| NFR-001 | Thai and English UI remain supported; business-time semantics use Asia/Bangkok. | Required |
| NFR-002 | Core customer booking flow is mobile-first and keyboard/accessibility regressions are release blockers for critical actions. | Required |

## Public-launch blockers
BK01 cannot be marketed as public V1 until all Required rows above have passing traceability evidence. Existing baseline implementation may satisfy some rows already; unsatisfied rows are BK-A work, not documentation exceptions.
