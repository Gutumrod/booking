# BK01 Feature Requirement Traceability

**Status:** LOCKED TARGET V1 TRACEABILITY — 2026-08-28

Disposition values are written literally as `V1 REQUIRED`, `V1 OPTIONAL`, `POST-V1`, or `RETIRED`. Baseline evidence state is separate from disposition; a `V1 REQUIRED` row may still be a BK-A implementation gap.

| Feature | Disposition | Role | Requirement | Entitlement | Authority/API | UX / negative states | Analytics | Release evidence | Marketing claim |
|---|---|---|---|---|---|---|---|---|---|
| Signup | V1 REQUIRED | Owner | FR-AUTH-001 | all | Supabase Auth | duplicate/invalid/email failure | signup_started/completed | auth E2E | signup available |
| Email verification | V1 REQUIRED | Owner | FR-AUTH-001 | all | Supabase Auth | delayed/expired link | signup_completed | provider E2E | verification as configured |
| Login/session expiry/logout | V1 REQUIRED | Merchant | FR-AUTH-002 | all | Supabase Auth | invalid/expired session | — | auth negative E2E | secure login |
| Password recovery | V1 REQUIRED | Merchant | FR-AUTH-002 | all | Supabase Auth | expired/reused link | — | recovery E2E | account recovery |
| Shop provisioning | V1 REQUIRED | Owner | FR-ONB-001, FR-ONB-002 | trial+ | `provision_owner_shop` | duplicate slug/retry/auth fail | shop_provisioned | idempotency/tenant tests | self setup |
| Canonical URL lifecycle | V1 REQUIRED | Owner/customer | FR-ONB-003 | all | routing + shop slug | invalid/blocked slug | booking_link_published/opened | routing smoke | booking link |
| Service management | V1 REQUIRED | Owner/Admin | FR-SVC-001 | all | service RPCs | invalid duration/price/deposit | service_setup_completed | role/input tests | configure services |
| Provider management | V1 REQUIRED | Owner | FR-STF-001 | plan staff limit | staff RPCs | limit/concurrency/reactivation | staff_setup_completed | entitlement tests | manage providers |
| Staff identity mapping | V1 REQUIRED | Staff | FR-STF-002 | all | target auth→staff mapping | missing/foreign mapping fails closed | — | cross-role tests | staff sees own work |
| Weekly schedules/breaks | V1 REQUIRED | Owner/Admin | FR-SCH-001, FR-SCH-002 | all | schedule RPC | missing row fails closed | schedule_setup_completed | schedule negative tests | real availability |
| Shop closures/time-off | V1 REQUIRED | Owner/Admin | FR-SCH-001 | all | holiday/time-off data | closed date unavailable | — | availability tests | closures supported |
| Public booking page | V1 REQUIRED | Customer | FR-BKG-001 | all active/trial | public profile/read | blocked shop/not found | booking_page_opened | public security E2E | no app required |
| Service/provider/Any Staff choice | V1 REQUIRED | Customer | FR-BKG-002, FR-BKG-003 | all | availability + hold RPC | inactive/foreign/unavailable | availability_viewed | domain E2E | choose service/provider |
| Hold creation | V1 REQUIRED | Customer | FR-BKG-004, FR-BKG-005 | trial/paid | `create_booking_hold` | race/invalid input/blocked shop | hold_created | concurrency tests | collision-safe booking |
| Hold expiry | V1 REQUIRED | Customer/system | FR-BKG-006 | all | booking state/expiry | expired submit rejected | hold_expired | expiry tests | temporary slot hold |
| No-deposit confirm | V1 REQUIRED | Customer | FR-BKG-005 | all | booking RPC | invalid deposit config | booking_confirmed | state tests | deposit optional per service |
| PromptPay QR | V1 REQUIRED | Customer | FR-DEP-001 | all | controlled QR generator | invalid recipient/amount | deposit_required | deterministic tests | PromptPay deposit |
| Private slip upload | V1 REQUIRED | Customer | FR-DEP-002, SEC-STO-001 | all | private Storage | bad MIME/size/foreign path | deposit_submitted | storage auth tests | secure slip upload |
| Manual slip review | V1 REQUIRED | Owner/Admin | FR-DEP-003 | Trial/Basic/Pro | approve/reject RPC | wrong state/tenant | deposit_verified/rejected | role/state tests | verify deposit |
| Automatic slip verification | V1 REQUIRED | Pro | FR-DEP-003, FR-DEP-004 | Pro allowance | provider + guarded orchestration | timeout/unknown/duplicate ref | deposit_verified/rejected | provider failure tests | only after shipped-verified |
| Customer cancellation | V1 REQUIRED | Customer | FR-LIFE-002 | all | target guarded lifecycle API | policy window/token fail | booking_cancelled | policy/rollback tests | self cancel within policy |
| Customer reschedule | V1 REQUIRED | Customer | FR-LIFE-002 | all | target atomic lifecycle API | collision/policy failure keeps original | booking_rescheduled | atomic rollback/concurrency | self reschedule within policy |
| Merchant cancellation | V1 REQUIRED | Owner/Admin | FR-LIFE-001 | all | `cancel_booking`/target rules | terminal/foreign/reason missing | booking_cancelled | role/state tests | manage cancellations |
| Completion | V1 REQUIRED | Owner/Admin | FR-LIFE-003 | all | target lifecycle RPC | non-confirmed/foreign | booking_completed | state tests | appointment outcomes |
| No-show | V1 REQUIRED | Owner/Admin | FR-LIFE-003 | all | target lifecycle RPC | non-confirmed/foreign | booking_no_show | state/metric tests | no-show tracking |
| Blacklist | V1 OPTIONAL | Owner/Admin | FR-LIFE-004 | TBD | target block/unblock API | unblock/identity ambiguity | TBD | complete flow tests | no claim until verified |
| Customer history | V1 REQUIRED | Merchant | FR-LIFE-005 | all | tenant-scoped customer/booking read | cross-tenant denied | — | RLS tests | operational history |
| LINE binding/receipt | V1 REQUIRED | Customer | FR-LINE-002, FR-LINE-003 | central trial / merchant paid | LINE webhook | bad token/signature/provider fail | line_linked/notification_* | webhook/security tests | LINE-assisted communication |
| Confirmation notification | V1 REQUIRED | Customer | FR-LINE-001 | all | notification service/log | send failure does not alter booking | notification_sent/failed | delivery failure test | booking confirmation |
| Reminder | V1 REQUIRED | Customer | FR-LINE-001 | all | target scheduler + LINE | retry/failure evidence | notification_sent/failed | scheduled integration tests | appointment reminder |
| Trial | V1 REQUIRED | Owner | FR-BILL-001 | 14d/50 eval bookings | subscriptions + gate | expired/missing state fail closed | quota_warning/exhausted | boundary tests | 14-day trial |
| Monthly checkout | V1 REQUIRED | Owner | FR-BILL-001, FR-BILL-002 | Basic/Pro | Stripe Checkout + authoritative webhook state | invalid plan/owner/provider fail | checkout_started, checkout_completed_authoritative | Stripe test mode + webhook reconciliation | monthly subscription |
| Billing portal | V1 REQUIRED | Owner | FR-BILL-001 | paid | Stripe Portal | no customer/unauthorized | — | role/provider tests | manage subscription |
| Stripe webhook sync | V1 REQUIRED | System | FR-BILL-001 | paid | signed webhook + sync RPC | invalid sig/duplicate/out-of-order | subscription_* | replay tests | no direct marketing claim |
| Annual billing | POST-V1 | Owner | PD-008 | future | future Stripe annual prices/state | unsupported in V1 | — | future annual billing tests | not V1 |
| Legacy annual discount UI/copy | RETIRED | Owner | FR-BILL-002 | none V1 | baseline registration UI to remove | must not appear in V1 | — | absence test | prohibited V1 claim |
| Paid 100/500 booking wall | RETIRED | Merchant | FR-BILL-003 | none | legacy entitlement logic to remediate | must not block normal paid ICP usage | quota_* | migration/entitlement tests | no 100/500 claim |
| Automation allowance/top-up | V1 REQUIRED | Pro | FR-BILL-004 | explicit provider allowance | entitlement ledger | exhaustion/idempotent top-up | automation_topup_consumed | ledger/provider tests | allowance only after price lock |
| Ticket/support module | V1 REQUIRED | Owner/Admin | FR-SUP-001 | all | target owner/admin-scoped ticket RPCs | staff/cross-tenant/invalid transition denied | support_ticket_created | role/RLS/state tests | support capability, not lead feature |
| Platform admin | V1 REQUIRED | Operator | FR-OPS-001 | platform | platform-admin RPCs | non-admin denied/audit required | privileged_action | authorization/audit tests | no public feature claim |
| CSV export | V1 REQUIRED | Owner | FR-DATA-001 | all | target export service | non-owner/cross-tenant denied | data_exported | scope/content tests | data portability |
| Deletion/account closure request | V1 REQUIRED | Owner | FR-DATA-002 | all | target support/privacy workflow | identity/retention exceptions | account_request | process evidence | request path available |
| Thai/English | V1 REQUIRED | All | NFR-001 | all | next-intl/UI | missing key/fallback | — | locale E2E | Thai/English UI |
| Asia/Bangkok time semantics | V1 REQUIRED | All | NFR-001 | all | DB/UI business time | boundary/DST-independent cases | — | date boundary tests | Thai business dates |
| Mobile booking UX | V1 REQUIRED | Customer | NFR-002 | all | consumer UI | narrow viewport/error states | — | mobile E2E/accessibility | mobile-first booking |
| Multi-branch | POST-V1 | Owner | PD-015 | future | future tenancy design | unsupported V1 | — | future | not V1 |
| Medical clinic workflow | POST-V1 | — | PD-016 | future decision | none | unsupported V1 | — | future compliance review | explicitly excluded V1 |

## Traceability rule
No feature may appear in pricing, marketing or launch copy without a row here. A new feature must receive one disposition and requirement/ADR coverage before implementation or claim changes.

## Cross-cutting security traceability
| Feature | Disposition | Role | Requirement | Entitlement | Authority/API | UX / negative states | Analytics | Release evidence | Marketing claim |
|---|---|---|---|---|---|---|---|---|---|
| Tenant isolation | V1 REQUIRED | Merchant/operator | SEC-TEN-001 | all | RLS + guarded RPCs | cross-shop ID substitution denied | security_denied internal | cross-tenant suite | data separated by shop |
| Public data minimization | V1 REQUIRED | Public | SEC-TEN-002 | all | restricted views/public RPCs | internal/billing/PII columns unavailable | — | anon permission tests | privacy-oriented public booking |
| Secret handling | V1 REQUIRED | System/operator | SEC-PRIV-001 | all | runtime secret stores | missing/misplaced secret fails safely; never client-visible | secret_config_failure internal | bundle/log/config review | no public secret claim |
| Booking collision reliability | V1 REQUIRED | System/customer | REL-001 | all | DB exclusion constraint + transactional booking RPC | concurrency loser rejected; no accepted overlap | booking_integrity incident metric | concurrent overlap/race suite | collision-safe only after release evidence |
| External-provider fail-safe reliability | V1 REQUIRED | System/operator | REL-002 | all | Stripe/LINE/auto-slip orchestration | timeout, duplicate, invalid signature, ambiguous result fail safely and observably | provider failure metrics | controlled provider failure/idempotency suite | no provider-reliability guarantee |

These cross-cutting rows supplement user-visible capability rows and must remain exact-ID searchable.
