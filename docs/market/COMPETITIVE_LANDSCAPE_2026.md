# BK01 Competitive Landscape 2026

**Research date:** 2026-08-28
**Status:** CURRENT EVIDENCE — used for 2026-08-28 owner decisions; final public price remains pending PD-003
**Source ledger:** `../audit/MARKET_SOURCE_LEDGER.md`

`UNKNOWN` means the reviewed official public evidence did not establish the field. Vendor outcome/security claims are observations, not independently verified outcomes.

## 1. Market frame
BK01 competes with three layers: Thailand LINE-first booking products, global appointment SaaS, and manual LINE/DM + calendar/spreadsheet workflows. LINE and PromptPay are already common in Thailand; the relevant question is whether BK01 removes enough operational work with lower switching/setup burden and trustworthy scheduling.

## 2A. Required-field matrix — commercial structure
| Competitor | Segment / positioning | Price + cadence / tax | Free/trial | Booking quota definition | Staff/provider limit | Locations/branches |
|---|---|---|---|---|---|---|
| Onque [TH-ONQ-1] | Thai service shops; LINE-first, no-GP, assisted setup | starts ฿299/mo; monthly; VAT included | 30 days, no card | unlimited bookings every advertised plan | Lite Basic 15 staff/services; higher plans advertised unlimited | UNKNOWN |
| MeQueue [TH-MEQ-1] | Thai service ops; LINE OA + booking + CRM/reporting | Free; Pro ฿399/mo or ฿3,900/yr; Business ฿599/mo or ฿6,900/yr; VAT status UNKNOWN | Free, no card | Pro described as unlimited in official beauty guide; Free exact booking cap UNKNOWN | Free: 2 staff / 3 services; paid exact staff caps UNKNOWN | Business positioned for multi-branch; exact cap UNKNOWN |
| JongQ [TH-JQ-1] | Thai LINE appointment system; one all-feature plan | ฿499/mo; ฿4,790/yr; monthly price page says VAT excluded (≈฿534 incl.) | 1 month, no card | unlimited queues | unlimited staff/customers | UNKNOWN |
| QueueBooking [TH-QB-1] | LINE booking + branches + PromptPay payment | Free; ฿990/mo; ฿2,490/mo; LINE message cost excluded | Free forever | 50 / 2,000 / 10,000 bookings per month | UNKNOWN | 1 / 5 / multi-store-multi-branch |
| EikQueue [TH-EIK-1] | Thai service booking/queue + LINE + deposit | Pro ฿590/mo; Business ฿1,290/mo; tax status UNKNOWN | 14 days, no card | Starter 50/mo; paid quota UNKNOWN | Starter 1; Pro unlimited | Business multi-branch |
| Bookio [TH-BOOKIO-1] | Thai appointment businesses; simple LINE booking | Free ฿0; Growth ฿990/mo | Free forever; Growth 14-day trial | UNKNOWN | UNKNOWN | Free 1 location; Growth unlimited locations |
| FoxConnect [TH-FOX-1] | LINE-first booking + CRM for growing service businesses | ฿690/฿1,590/฿2,990 monthly with 3-month minimum; annual ฿7,590/฿17,490/฿32,890 | trial UNKNOWN in reviewed pricing evidence | 200 / 600 / 2,000 per month | 3 / 10 / 25 staff | 1 / 3 / 10 branches |
| Bangkok Boost [TH-BKB-1] | done-for-you LINE LIFF booking for Thai SMBs | ฿990/฿1,590/฿2,590+ monthly; setup from ฿3,000 on advanced plans, often waived | 14 days | core booking plan advertises unlimited bookings | Essential up to 3 staff; higher caps UNKNOWN | Enterprise multi-branch |
| Booking Whale [TH-BW-1] | broad next-gen booking platform; still beta | free during beta; post-beta price UNKNOWN | beta free / early access | UNKNOWN | UNKNOWN | UNKNOWN |
| Fresha [GL-FRE-1] | beauty/wellness operations + marketplace | retrieved locale: DKK105/mo independent; DKK75/bookable member/mo team; taxes excluded on page | 7 days | unlimited bookings | 1 or unlimited team billed per bookable member | multi-location supported on team/enterprise |
| Booksy [GL-BOOKSY-1] | beauty/barber/salon scheduling + payments + marketplace | US page: US$29.99/mo + US$20/additional user + tax | 14 days, no card | unlimited bookings | 1 included + paid additional users | UNKNOWN on reviewed pricing |
| SimplyBook.me [GL-SBM-1] | configurable global booking SaaS | Free; $13.9/$29.9/$59.9 monthly; annual $11.9/$24.9/$49.9; Enterprise custom | Free forever + 14-day trial | 50 / 100 / 500 / 2,000; add 100 bookings $4 | 1 / 5 / 15 / 30 / custom | Enterprise multi-location cluster |
| Setmore [GL-SET-1] | general SMB scheduling | Free; Pro page shows $12/user monthly or $5/user on annual billing | Free plan | unlimited appointments | Free up to 4 users; Pro advertised unlimited users | enterprise/custom discussion available; exact location model UNKNOWN |
| Acuity Scheduling [GL-ACU-1][GL-ACU-2] | general/professional appointment scheduling | monthly + annual billing available; exact price not exposed in retrieved official surface; applicable taxes may be added | free trial; no card | unlimited services/appointments | 1 / up to 6 / up to 36 bookable calendars | calendars can represent staff/location/resource; exact branch entitlement UNKNOWN |
## 2B. Required-field matrix — booking/channel/payment
| Competitor | LINE mode | Customer app requirement / booking surface | Deposit/payment | PromptPay / Thai QR | Auto verification | Reminders | Reschedule/cancel | Waitlist | Calendar sync |
|---|---|---|---|---|---|---|---|---|---|
| Onque | central OA on Lite; merchant shop OA on Pro | no new app; LINE/link workflow | deposit flow | PromptPay QR | SlipOK by tier | yes | customer manages cancellation/reschedule in “My appointments” | UNKNOWN | UNKNOWN |
| MeQueue | merchant LINE OA + LIFF; Rich Menu | no app; LIFF plus public booking link | service-level deposit on Business | QR payment shown; PromptPay brand not explicitly established in reviewed text | UNKNOWN | Pro/Business: 1 day + 2 hours | booking states/change messaging exist; exact customer self-service rules UNKNOWN | UNKNOWN | one-way Google Calendar sync stated in privacy policy |
| JongQ | LINE booking | no new app; customer manages in LINE | UNKNOWN | UNKNOWN | UNKNOWN | yes | self reschedule/cancel in chat | automatic waitlist | UNKNOWN |
| QueueBooking | merchant LINE OA/LIFF | no new app; LINE booking | Omise payment flow | native PromptPay QR | webhook-confirmed payment; not “slip OCR” | LINE messaging implied; exact reminder schedule UNKNOWN | Google Calendar receives new/reschedule/cancel; customer rules UNKNOWN | UNKNOWN | Google Calendar integration |
| EikQueue | merchant LINE OA; LIFF | LINE or public link; no separate app requirement stated | transfer deposit + slip upload | bank transfer/deposit; exact PromptPay QR UNKNOWN | manual merchant slip confirmation evidenced; automatic verification UNKNOWN | LINE confirmations/reminders/status updates | cancelled status exists; customer self-service rule UNKNOWN | UNKNOWN | external calendar sync UNKNOWN |
| Bookio | booking inside LINE | no app download | UNKNOWN | UNKNOWN | UNKNOWN | Growth automatic LINE reminders | team can cancel; customer self-service UNKNOWN | UNKNOWN | UNKNOWN |
| FoxConnect | merchant LINE OA + LIFF | LIFF universal link opens LINE/external browser | payment/deposit support UNKNOWN in reviewed core pricing evidence | UNKNOWN | UNKNOWN | automated reminders/reconfirmations | cancellation/rescheduling options in reminder workflows | UNKNOWN | multiple internal calendars; external sync UNKNOWN |
| Bangkok Boost | merchant LINE OA / LIFF | no extra app; LINE LIFF | Professional deposit | PromptPay QR | UNKNOWN | automated reminders | UNKNOWN | UNKNOWN | UNKNOWN |
| Booking Whale | LINE OA / LINE Login planned | booking platform in beta | secure payments planned | UNKNOWN | UNKNOWN | LINE reminders planned/advertised | cancellation rules advertised; exact self-service flow UNKNOWN | UNKNOWN | Google Calendar integration advertised |
| Fresha | LINE integration UNKNOWN | customer app + direct web links + social/Google booking | upfront payments, deposits/no-show/cancel fees | Thai PromptPay UNKNOWN | not applicable to slips; payment processor confirms money | automated email/SMS/WhatsApp | easy rescheduling + cancellation policies | yes | calendar/scheduling native; external sync UNKNOWN in reviewed evidence |
| Booksy | LINE integration UNKNOWN | free customer app + web/profile/social/Google | integrated payments, deposits/cancellation fees | Thai PromptPay UNKNOWN | payment-based, no slip workflow | confirmations/reminders included | customer app manages appointments; cancellation policies | yes | calendar management; external sync UNKNOWN |
| SimplyBook.me | LINE integration UNKNOWN | booking website/widget/client app | payments/deposits/tips | Thai PromptPay UNKNOWN | payment gateway, no slip workflow | email/browser reminders; SMS add-on | easy cancellation/rescheduling; cancellation policy feature | UNKNOWN | calendar sync custom feature |
| Setmore | LINE integration UNKNOWN | branded booking page/mobile app | Stripe/Square/PayPal; optional/required prepayment | Thai PromptPay UNKNOWN | payment processor, no slip workflow | email; Pro SMS + custom reminders | booking management supported; exact customer policy rules UNKNOWN | UNKNOWN | Pro 2-way sync |
| Acuity Scheduling | LINE integration UNKNOWN | website embed or branded booking page; mobile admin app | Stripe/Square/PayPal payments + deposits | Thai PromptPay UNKNOWN | payment processor, no slip workflow | email all plans; SMS on higher plan | cancellation policy supported; exact customer self-service setting varies | UNKNOWN | calendar syncing supported |
## 2C. Required-field matrix — data/platform/commercial trust
| Competitor | CRM/history | Reports/analytics | API/webhooks | Export/data portability | Support/onboarding | Marketplace/discovery | Commission/transaction fees | Branding/custom domain | Trust/privacy claims |
|---|---|---|---|---|---|---|---|---|---|
| Onque | customer/appointment/course data | exact analytics scope UNKNOWN | public API/webhook UNKNOWN | CSV export anytime; 30-day read-only period after cancellation advertised | free remote setup; developer-direct support, advertised ≤4 working hours | UNKNOWN — none established in reviewed evidence | 0% GP; SlipOK credits are variable-cost add-on | merchant OA on Pro; custom domain UNKNOWN | vendor states Supabase Singapore + RLS; export ownership claim |
| MeQueue | CRM, booking history, notes/no-show signals | bookings/revenue/workload reports | LINE webhook setup documented; public business API UNKNOWN | export UNKNOWN | onboarding help through LINE + help center | UNKNOWN — none established in reviewed evidence | VAT/transaction fees UNKNOWN | Rich Menu builder; custom domain UNKNOWN | privacy policy defines merchant/controller-style responsibility, processors, Google Calendar and data rights |
| JongQ | customer list/history dashboard | 7/30/90-day historical reports | UNKNOWN | UNKNOWN | setup/help advertised; exact SLA UNKNOWN | UNKNOWN — none established in reviewed evidence | VAT excluded from headline monthly price; payment fees UNKNOWN | LINE menu customizable; custom domain UNKNOWN | vendor claims system/key encryption and merchant data ownership |
| QueueBooking | exact CRM depth UNKNOWN | UNKNOWN | Omise webhook for payment; public business API UNKNOWN | UNKNOWN | 24/7 help advertised | UNKNOWN — none established in reviewed evidence | LINE message cost paid directly to LINE; booking system price separate | custom brand/domain UNKNOWN | merchant Omise secret keys claimed encrypted and masked |
| EikQueue | customer history; membership/points on relevant plans | daily/monthly and revenue/queue stats | public API/webhook UNKNOWN | UNKNOWN | contact/demo; Business priority care | UNKNOWN — none established in reviewed evidence | tax/payment-processing fees UNKNOWN | Business adds brand customization; custom domain UNKNOWN | terms under Thai law; vendor pages claim PDPA-oriented access control for clinic use |
| Bookio | CRM depth UNKNOWN | Growth advanced analytics/logs | UNKNOWN | UNKNOWN | Free email support; Growth priority onboarding | UNKNOWN — none established in reviewed evidence | transaction/commission fees UNKNOWN | custom branded UI/domain UNKNOWN | privacy/security specifics UNKNOWN in reviewed source |
| FoxConnect | rich CRM: contacts, booking history, preferences, notes/conversations | plan pages emphasize CRM; exact analytics package UNKNOWN | public API/webhook UNKNOWN; LINE setup docs use platform callbacks | inbound data migration advertised; outbound export UNKNOWN | demo, onboarding/data migration; priority support on higher plans | UNKNOWN — none established in reviewed evidence | subscription payments via Stripe; customer payment/commission model UNKNOWN | booking in merchant LINE; custom domain UNKNOWN | vendor feature page makes security/compliance claims; not independently verified |
| Bangkok Boost | CRM/history UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | done-for-you setup, Thai/English support; Enterprise dedicated support | UNKNOWN — none established in reviewed evidence | setup fee may apply; booking commission not advertised | custom branded UI; Enterprise custom LINE OA | privacy/security specifics UNKNOWN in reviewed source |
| Booking Whale | booking/customer history planned | real-time analytics planned | integrations advertised; exact API/webhook UNKNOWN | UNKNOWN | Free/Starter email ≤24h working-time claim; Professional 24/7 ≤4h; Enterprise custom SLA/onboarding | UNKNOWN — none established in reviewed evidence | pricing/fees UNKNOWN during beta | branding/custom domain UNKNOWN | beta/planned product; trust/privacy specifics UNKNOWN |
| Fresha | client management | reporting + optional Insights | Data Connector paid add-on; public API scope UNKNOWN | import supported; outbound connector available as paid add-on | email support; Team phone/chat/email; paid premium support in some plans | strong Fresha Marketplace | 20% one-time new-client marketplace fee in retrieved locale; payment processing fees apply | direct links/social booking; custom domain UNKNOWN | official pricing lists HIPAA/ISO 9001/ISO 27001/GDPR-related certifications/claims |
| Booksy | client cards/history/notes | detailed stats/reports | public API/webhook UNKNOWN | CSV import + free data transfer; outbound export UNKNOWN | guided trial + help center | Booksy Marketplace + optional Boost | Boost 30% one-time first-visit fee; payment processing fees by method | profile/direct links; custom domain UNKNOWN | official Trust Center linked; pricing/security specifics require separate review |
| SimplyBook.me | client history + notes | admin statistics/reporting via feature set | API available as custom feature; Zapier integration | Personal Data Report after cancel; broad export specifics UNKNOWN | help center/email/live chat; paid account-manager/setup services | Booking.page directory listing | no SimplyBook.me transaction fee; payment processor fees separate; optional add-ons | booking website, white-label tiers; custom domain add-on $119 | HIPAA/SAML/data-location features by tier; privacy claims are provider statements |
| Setmore | customer/appointment records | analytics depth UNKNOWN | integrations advertised; public API scope UNKNOWN | export portability UNKNOWN | 24/7 human support; Pro priority support | marketplace/discovery UNKNOWN — none established in reviewed evidence | payment processor fees separate; subscription no booking fee stated | branded booking page; Pro removes Setmore branding; custom domain UNKNOWN | privacy/security specifics UNKNOWN in reviewed pricing |
| Acuity Scheduling | client profiles + intake forms | reporting depth UNKNOWN | Premium includes custom API/CSS | data export specifics UNKNOWN | 24/7 Squarespace support + webinars/help center | marketplace/discovery UNKNOWN in reviewed evidence | Squarespace says no Acuity transaction fee; processor fees apply; tax may apply | branded/embedded scheduler; Premium removes Powered by Acuity; custom CSS/API | Premium supports BAA for HIPAA; general privacy governed by Squarespace/Acuity policies |
## 3. Price architecture comparison
Thai direct competitors currently use several value metrics: unlimited-booking low-price plans (Onque/JongQ), explicit booking-volume tiers (QueueBooking/FoxConnect), staff/branch scaling (EikQueue/FoxConnect/Bangkok Boost), and feature/automation tiers. Global tools add per-provider pricing, feature-count limits, marketplace economics and payment fees.

**BK01 implication:** the legacy 100/500 paid booking wall is not a defensible default. Paid booking capacity should be effectively unlimited for the primary ICP or use a high operational fair-use ceiling; variable-cost automation such as auto-slip or managed messaging can have explicit allowances once provider cost is known. ฿490/฿990 remain pilot references, not final public prices.

## 4. Feature parity / gap and win-tie-lose
| Capability | Market signal | BK01 baseline @ e99615d | Assessment / target |
|---|---|---|---|
| LINE-assisted booking | common in Thai direct set | central LINE webhook + web booking | TIE category; paid target moves to merchant-owned OA |
| No customer app | common | public web booking | TIE |
| Scheduling integrity / collision control | rarely exposed as deep technical promise | DB exclusion constraint, hold, fail-closed schedules | POTENTIAL WIN after release/pilot evidence |
| Any Staff allocation | not consistently advertised | deterministic availability/load assignment | POTENTIAL WIN; validate buyer value |
| PromptPay deposit | common | QR/deposit/manual slip baseline | TIE conceptually; baseline dependency needs remediation |
| Auto-slip/payment verification | present in leading Thai products | entitlement schema but no provider flow | LOSE baseline; V1 Pro blocker |
| Automated reminders | table stakes | scheduler not evidenced | LOSE baseline; V1 blocker |
| Customer reschedule/cancel | common in stronger products | incomplete/absent | LOSE baseline; V1 blocker |
| Waitlist | available in some competitors | absent | LOSE where needed; POST-V1 candidate unless pilot changes priority |
| Customer history/CRM | common | data exists but narrow operational UX | TIE/LOSE; intentionally not full CRM promise |
| Export/portability | visible in some competitors | self-service export absent | LOSE baseline; V1 blocker |
| Multi-branch | common higher-tier feature | single shop/account | INTENTIONAL V1 GAP |
| Marketplace/discovery | global differentiator | none | DIFFERENT STRATEGY, not V1 gap |
| Ticket/platform operations | mostly invisible to buyers | real internal capability | OPERABILITY VALUE, not lead claim |
## 5. Switching cost and onboarding
The primary substitute is often manual LINE chat plus paper/calendar/spreadsheet, so setup burden competes directly with perceived pain. Competitors reduce switching friction through assisted LINE setup, onboarding, data migration or done-for-you configuration. BK01 therefore treats setup and portability as product requirements, not after-sales decoration.

Target onboarding benchmark: a qualifying owner can provision one shop, configure at least one service/provider/valid schedule and publish a booking link without developer intervention. Exact time-to-onboard is a pilot metric; no “setup in X minutes” claim is authorized yet.

## 6. Defensibility
**Weak/commodity alone:** LINE integration, Thai language, PromptPay QR, simple booking page, and low price.

**Potentially defensible if executed and evidenced:**
- database-enforced scheduling and collision integrity;
- low-friction migration/onboarding plus real data portability;
- reliable, measurable notification and deposit workflows;
- deep workflow fit for the single-location hair/barber/beauty/nail beachhead;
- merchant-owned customer relationship without marketplace dependence;
- evidence-backed reliability/outcome data from Thai pilots.

## 7. Claims competitors make that BK01 must not copy
BK01 must not claim quantified or absolute outcomes such as “eliminates no-shows,” “higher conversion,” “setup in X minutes,” “99.9% uptime,” “PDPA compliant,” or security superiority without evidence owned by BK01 for that exact statement. Competitor testimonials, support-speed, security/compliance, customer-count and ROI claims remain vendor claims.

## 8. Commercial decision from this gate
The evidence supports the owner-approved decisions: primary beachhead is single-location hair/barber/beauty/nail; legacy 100/500 paid booking walls are retired; merchant-owned LINE OA is the paid-production direction; auto-slip/reminder/reschedule/data portability gaps must close before corresponding public claims.

This gate does **not** authorize final public price or auto-slip allowance. Final commercial lock requires provider cost, support burden, pilot willingness-to-pay, competitor refresh and owner approval under PD-003/PD-004.

## 9. Evidence coverage
Every competitor row above maps to one or more IDs in `../audit/MARKET_SOURCE_LEDGER.md`. Fields not established by the reviewed official evidence are explicitly `UNKNOWN`; they are not inferred from competitor positioning or third-party comparison sites.
