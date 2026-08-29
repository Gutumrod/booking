# BK01 UX User Flows

**Status:** LOCKED TARGET V1 — 2026-08-28

## Customer booking
1. Open canonical shop booking URL.
2. Load public-safe shop/service/provider data; blocked/expired subscription shows unavailable state, never partial booking UI.
3. Select service → provider or Any Staff → date/time.
4. Enter name + Thai mobile phone; validate before hold request.
5. Server creates collision-safe hold or immediate confirmation for no-deposit service.
6. If deposit required: show controlled PromptPay QR + hold countdown → upload slip privately → show `pending_review` or verified result.
7. On confirmation: show booking code, appointment detail, merchant contact and LINE linking/notification state.

Recovery states: unavailable slot refreshes availability; expired hold returns to slot selection; failed upload retains safe retry path only while hold valid; ambiguous auto-slip stays reviewable; LINE failure never changes confirmed state.

## Customer change flow
Customer opens authenticated/recovery-token booking action surface → sees merchant cancellation/reschedule policy → chooses cancel or new slot → server validates policy and availability → atomic mutation → updated confirmation + notification. Failure leaves original booking unchanged.

## Owner onboarding
Sign up → verify email when required → shop/profile/category/slug → select plan intent → PromptPay recipient → provision shop idempotently → configure at least one service → provider → weekly schedule → publish/copy booking link → first successful booking = first-value candidate.

## Owner/admin daily flow
Dashboard shows today/upcoming/pending deposits and operational alerts. Owner/admin can review slips, confirm/reject, cancel with reason, reschedule, complete/no-show, manage services/schedules/closures and tickets. Owner additionally manages staff, shop settings, billing, export/account requests.

## Staff flow
Authenticated staff account maps to exactly one provider identity per shop for V1. Staff sees own schedule and own assigned bookings only, plus minimum customer/service detail necessary to perform work. Staff does not access shop-wide ticket/support operations in V1. Missing/ambiguous mapping fails closed and routes to owner/admin setup.

## Platform operator flow
Authenticated platform admin searches tenant → inspects minimum support context → performs only explicit controls such as suspend/restore, trial correction or approved entitlement support action → action is audited. No silent impersonation or browsing of tenant data outside a support purpose.
