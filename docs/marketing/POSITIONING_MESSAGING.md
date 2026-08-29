# BK01 Positioning & Messaging

**Status:** LOCKED STRATEGY / CLAIMS EVIDENCE-CONSTRAINED — 2026-08-28

## Positioning
For single-location Thai salons, barbers, beauty and nail businesses that still coordinate appointments through chat and manual calendars, BK01 is a Thailand-first appointment operations SaaS that combines collision-safe staff scheduling, PromptPay deposit workflows and LINE-assisted customer communication without requiring customers to install an app.

Unlike manual LINE + calendar workflows, BK01 makes availability and appointment state authoritative. Unlike booking marketplaces, the merchant keeps the direct customer relationship. Unlike generic global schedulers, BK01 treats Thai payment and LINE workflows as first-class product requirements.

## Primary pain hierarchy
1. staff/time collisions and manual availability checking;
2. repetitive chat confirmation and follow-up;
3. low-commitment bookings/no-show risk;
4. fragmented schedule/deposit/customer history;
5. owner dependence on staff memory/spreadsheets.

## Value pillars
- **คิวไม่ชนเพราะกติกาอยู่ที่ระบบ** — scheduling integrity, not merely a calendar UI;
- **มัดจำแบบไทย** — PromptPay-native deposit flow directly to merchant;
- **ทำงานกับ LINE ที่ร้านใช้อยู่** — paid production targets merchant-owned OA;
- **ลูกค้าไม่ต้องลงแอป** — link-based mobile booking;
- **ร้านยังเป็นเจ้าของลูกค้า** — no marketplace commission/discovery dependency.

## Lead message
“รับจองออนไลน์ จัดคิวช่าง และเก็บมัดจำผ่าน PromptPay โดยไม่ต้องไล่เช็กคิวในแชทเอง”

## Landing-page order
Pain → how booking works → scheduling/deposit proof → merchant-owned LINE workflow → plan fit → setup steps → privacy/data ownership → CTA for trial/pilot.
## Objection handling
- **“รับจองใน LINE อยู่แล้ว”** → BK01 replaces manual availability/state coordination, not LINE itself.
- **“ลูกค้าจะยอมใช้ไหม”** → no customer app required; booking link is the primary path and LINE remains familiar communication.
- **“กลัวเงินมัดจำหาย/ผ่านตัวกลาง”** → V1 design sends PromptPay payment directly to merchant; BK01 manages booking evidence, not merchant funds.
- **“ย้ายข้อมูลแล้วติดระบบไหม”** → V1 requires owner CSV export and closure/deletion request process.
- **“มีหลายสาขา”** → not V1; do not force-fit.

## WHAT_WE_DO_NOT_CLAIM
BK01 must not claim:
- “ขจัด/ลด No-show 100%”;
- quantified no-show or revenue improvement without pilot evidence;
- automatic slip verification until Pro implementation passes release gates;
- annual billing until annual Stripe flow exists;
- unlimited in an absolute abuse-proof sense; use “ไม่จำกัดคิวสำหรับการใช้งานปกติ / fair-use protected” after final legal/marketing wording review;
- medical/clinic compliance;
- guaranteed LINE/Stripe/provider uptime;
- automatic deposit refund;
- multi-branch support in V1.

## Evidence labels for internal copy review
- `SHIPPED-VERIFIED`: implemented and release-tested.
- `V1-TARGET`: approved requirement but not yet release evidence.
- `PILOT-HYPOTHESIS`: value/outcome requiring field evidence.
Marketing surfaces may publish only `SHIPPED-VERIFIED` capabilities at launch; target/hypothesis language must be clearly future/pilot framed.
