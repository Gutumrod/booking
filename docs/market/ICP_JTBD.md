# BK01 ICP & Jobs To Be Done

**Date:** 2026-08-28
**Status:** OWNER-APPROVED PRIMARY ICP — pilot validation still required

## 1. Primary ICP

Single-location hair salon, barber, beauty or nail business in Thailand with approximately 1–10 bookable service providers.

Operational profile:
- receives appointments through LINE/chat today;
- offers named services with known or reasonably bounded durations;
- maintains provider working hours, breaks and days off;
- has enough appointment volume that chat coordination or schedule errors are noticeable;
- may require deposits for selected services;
- owner or manager operates primarily from mobile/web and does not want customers to install a new app.

## 2. Secondary ICP

Single-location massage/spa/non-medical wellness businesses with similar provider-time scheduling. Keep secondary until room/resource, therapist rotation and package/course needs are validated.

## 3. Current workaround

Typical alternatives to test in interviews:
- owner/admin answers LINE manually and writes appointments in paper, Google Calendar or Sheets;
- staff coordinate through group chat;
- customer asks repeatedly for available time slots;
- deposit is handled by sending PromptPay/account information and manually checking a slip;
- reminders are manual or absent.

## 4. Primary JTBD

**When appointment coordination starts consuming staff time or causing schedule mistakes, I want customers to choose a genuinely available service/provider/time through the channel they already use, so the shop can confirm and operate the appointment without repeated chat and without creating overlapping bookings.**

## 5. Pain hierarchy

### Functional
1. repeated availability questions and manual slot checking;
2. overlapping bookings / schedule mistakes;
3. deposit collection and confirmation work;
4. changes/cancellations/reminders creating more chat work;
5. fragmented customer/booking history.

### Operational
- owner must know which provider is actually available;
- changes must not create a second conflicting source of truth;
- staff access must expose only the intended operational scope;
- payment/deposit evidence must be reviewable without weakening customer privacy;
- system failure must fail predictably rather than silently accept invalid bookings.

### Emotional / trust
These are hypotheses for interviews, not facts: fear of missing a customer message, embarrassment from double-booking, distrust of software that is harder than LINE, and anxiety about losing customer data when switching vendors.

## 6. Trigger event hypotheses

- first repeated double-booking or customer complaint;
- owner/admin spends a material part of the day answering availability;
- team grows beyond one provider;
- no-show/deposit handling becomes painful;
- shop adds enough services that manual duration/staff matching becomes error-prone;
- owner wants booking after hours without hiring another admin.

## 7. Willingness-to-pay hypothesis

**Status: UNPROVEN.** Current competitor prices show an active low-price band around ฿299–฿690/month and more complete/multi-branch systems around ฿990+, but this does not establish BK01's willingness-to-pay.
The existing ฿490/฿990 pricing is therefore a hypothesis, not a locked truth.

## 8. Disqualifying conditions for V1

A prospect is not primary-ICP fit when its core scheduling requires:
- medical records/clinical workflow or regulated health-practice operations;
- bays, rooms, vehicles, equipment or parts as primary scarce resources rather than providers;
- restaurant table/walk-in queue optimization;
- group-class capacity/membership logic as the primary booking model;
- complex multi-branch governance;
- marketplace demand generation as the main reason for buying software.

## 9. Pilot/interview questions

1. Show the last five appointments: where did each request arrive and where was it recorded?
2. How many messages are normally exchanged before one appointment is confirmed?
3. What caused the last booking mistake or double-booking?
4. Which services need deposits, how much, and who checks payment today?
5. How often do customers cancel, reschedule or fail to arrive? How is this measured today?
6. Do customers already add/follow the shop LINE OA? If not, what channel owns the relationship?
7. Would the shop prefer a shared booking OA or its own branded OA? Why?
8. Which staff should see all bookings versus only their own appointments?
9. What must be imported before the shop would switch: future appointments, customers, services, staff, history?
10. What would make the owner stop using the system after one week?
11. What monthly price would feel obviously cheap, acceptable, expensive-but-possible, and impossible? Capture reasons, not just numbers.
12. What proof would the owner need before trusting automatic deposit verification?

## 10. Evidence needed to validate/relock ICP after pilot

Minimum before final commercial validation/relock: structured interviews across at least the primary proposed subsegments plus live pilots measuring setup completion, first booking, booking completion/cancel/no-show, support burden and trial-to-paid intent.
Public competitor pages validate category activity; they do not replace customer discovery.
