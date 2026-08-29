> [!WARNING]
> **HISTORICAL / NON-AUTHORITATIVE AFTER BK-0 (2026-08-28).** This file is retained as implementation/business evidence only. Current product truth is governed by docs/DOCUMENTATION_INDEX.md, docs/PRODUCT_DECISIONS.md, and numbered docs/00_... through docs/10_.... Do not use old pricing, entitlement, LINE, storage, deployment, role, or marketing claims here as current requirements.

# 🏆 OFFICIAL BUSINESS MODEL & SYSTEM ARCHITECTURE MASTER SPECIFICATION
## "Local Service Booking & LINE Automation SaaS"

> **อนุมัติและบังคับใช้โดย:** คุณฟรี (CEO)
> **วันที่มีผล:** 2026-08-05
> **สถานะ:** 100% Complete & Approved (ผ่านกระบวนการสัมภาษณ์เจาะลึก `/grill-me`)

---

## 🎯 1. Executive Summary & Value Proposition
**Local Service Booking & LINE Automation SaaS** คือแพลตฟอร์มบริหารจัดการคิวและรับเงินมัดจำผ่าน PromptPay QR แบบอัตโนมัติ 100% ออกแบบมาสำหรับร้านค้าบริการขนาดเล็กถึงขนาดกลางในประเทศไทย (ร้านตัดผม, ซาลอน, คลินิกความงาม, สปา, อู่ซ่อมรถ/คาร์แคร์)

### 🌟 คุณค่าหลัก 3 ประการ (Core Value Proposition):
1. **ขจัดปัญหา No-show (ลูกค้าจองแล้วเบี้ยว) 100%:** บังคับโอนเงินมัดจำผ่าน PromptPay QR Code ก่อนล็อกคิวสำเร็จ
2. **Zero-Friction LINE Onboarding (ร้านค้าไม่ต้องตั้งค่าอะไรเลย):** ใช้ LINE Official Account บอทกลางของระบบในการส่งใบนัดหมาย Flex Card และแจ้งเตือนล่วงหน้า 1 ชั่วโมง โดยร้านค้าไม่ต้องไปสมัคร LINE Developers หรือกรอก Token ยาวๆ ด้วยตัวเอง
3. **อัตรากำไรสูงถึง 98% (High Profit Margin):** ใช้สถาปัตยกรรม Supabase PostgreSQL + Central LINE Bot 1,605 บาท/เดือน (ส่งได้ 35,000 ข้อความ) เพียงมีลูกค้าจ่ายแพ็กเกจ Pro 2 ร้านค้าแรก ระบบจะคืนทุนและทำกำไรทันที

---

## 💰 2. Official Pricing Tiers & Subscription Model

| คุณสมบัติ / แพ็กเกจ | 🎁 Free Trial (14 วัน) | ⚡ Basic Starter | 🚀 Pro Plan (Recommended) |
| :--- | :--- | :--- | :--- |
| **ราคาค่าบริการ** | **ฟรี 14 วัน** | **490 บาท/เดือน** *(4,900/ปี)* | **990 บาท/เดือน** *(9,900/ปี)* |
| **โควตาคิวจอง/เดือน** | 50 คิว | 100 คิว/เดือน | 500 คิว/เดือน |
| **โควตาพนักงานสูงสุด** | **5 คน** | **5 คน** | **10 คน** |
| **Dashboard บริหารคิว** | ✅ มีครบถ้วน | ✅ มีครบถ้วน | ✅ มีครบถ้วน |
| **ตารางช่าง & วันหยุดร้าน** | ✅ มีครบถ้วน | ✅ มีครบถ้วน | ✅ มีครบถ้วน |
| **PromptPay QR Deposit** | ✅ มีครบถ้วน | ✅ มีครบถ้วน | ✅ มีครบถ้วน |
| **ตรวจสอบสลิปมัดจำ** | ตรวจมือ + ออโต้ 10 ครั้ง | ตรวจมือผ่าน Dashboard | **ตรวจสลิปออโต้ 100 ครั้ง/เดือน** |
| **แจ้งเตือน LINE OA** | ทดลองส่งในระบบ | ❌ ไม่มี (ดูบน Dashboard) | **✅ ส่ง LINE อัตโนมัติ (เตือนทันที + เตือน 1 ชม. ก่อนนัด)** |

---

## ➕ 3. แพ็กเกจเติมโควตาเสริม (Add-on Top-up Packs)
สำหรับร้านค้าที่ใช้งานคิวจองหรือการตรวจสลิปออโต้จนเกินโควตาประจำเดือน โดยไม่ต้องบังคับเปลี่ยนแพ็กเกจหลัก:
- **📦 แพ็กเกจเพิ่มคิวจอง:** `+100 คิว = 199 บาท` *(ไม่มีวันหมดอายุ ทบไปเดือนถัดไปได้)*
- **🛡️ แพ็กเกจตรวจสลิปออโต้:** `+100 เครดิต = 99 บาท` *(ไม่มีวันหมดอายุ ทบไปเดือนถัดไปได้)*

---

## 🚀 4. กลยุทธ์การตลาดและการหาลูกค้า (Go-To-Market & Conversion Strategy)

### 📣 ช่องทางการหาลูกค้าร้านค้ากลุ่มแรก (GTM Hybrid Channels):
1. **Meta (FB/IG) Targeted Ads:** ยิงโฆษณาตรงหาเจ้าของร้านตัดผม, ซาลอน, คลินิก ชูจุดขาย *"แก้ปัญหาลูกค้าจองแล้วเบี้ยว No-show 100% พร้อมระบบจองคิว PromptPay"*
2. **TikTok Organic Demos:** ทำคลิปวิดีโอสั้นโชว์ความง่าย *"ตั้งค่าร้านใน 2 นาที ไม่ต้องเซ็ตอัป LINE"*
3. **Direct Field Sales:** เดินสายเข้าพบร้านค้าในพื้นที่ย่านธุรกิจ/ห้างสรรพสินค้าพร้อมแท็บเล็ตสาธิต
4. **Referral / Affiliate Program:** ร้านค้าปัจจุบันชวนร้านอื่นมาสมัคร ได้รับฟรี 1 เดือนทั้งคนชวนและคนสมัคร

### 📈 กลยุทธ์การเปลี่ยน Free Trial เป็นลูกค้าจ่ายเงิน (Conversion Nudge):
- **รายงานสรุปผลงานในวันที่ 10 (Day-10 ROI Summary):** ระบบส่งรายงานเข้า LINE เจ้าของร้าน สรุปยอดเงินมัดจำที่ระบบช่วยเซฟได้ และจำนวนคิวที่สำเร็จ
- **Early-Bird Upgrade Discount:** มอบส่วนลดพิเศษ 10% หากกดอัปเกรดชำระเงินก่อนครบกำหนด 14 วัน

---

## 🏗️ 5. สถาปัตยกรรมระบบและความปลอดภัย (System Architecture & Security)

```text
[ ลูกค้าจองคิวบนมือถือ ]
         │
         ▼
[ Supabase PostgreSQL ] ──(RLS Multi-Tenant)──► [ Admin Dashboard ]
         │                                              │
         ▼                                              ▼
[ Central LINE Bot API ]                       [ Stripe Billing ]
 (ส่งใบนัด + เตือน 1 ชม. ก่อนนัด)               (Single Gateway Standard)
```

1. **Supabase PostgreSQL Multi-Tenancy:** ใช้ Row Level Security (RLS) ล็อกสิทธิ์ด้วย `shop_id` มั่นใจได้ว่าข้อมูลลูกค้าและคิวงานของแต่ละร้านจะถูกแยกจากกัน 100%
2. **Central LINE Messaging Bot:** ใช้บอทกลางส่ง LINE Flex Message ทำให้ร้านค้าใช้งานได้ทันทีใน 0 วินาทีโดยไม่ต้องสมัคร LINE Developers Account
3. **Stripe Single Gateway Governance:** ใช้ Stripe เป็น sole provider รายเดียวสำหรับตัดเงิน Subscription (Stripe Checkout / Billing / Customer Portal / Webhooks) เพื่อป้องกันปัญหา Webhook รวน

---

## 📊 6. การวิเคราะห์ตัวเลขทางการเงินและจุดคุ้มทุน (Unit Economics)

- **ต้นทุนคงที่ (Fixed Cost):** ค่าบริการ LINE OA Pro = **1,605 บาท/เดือน** (รวม VAT 7% ส่งได้ 35,000 ข้อความ)
- **ต้นทุนแปรผันต่อร้านค้า Pro (200 คิว/เดือน):** `400 ข้อความ x 0.0458 บาท = 18.32 บาท/เดือน`
- **รายรับจากร้านค้า Pro 1 ร้าน:** **990 บาท/เดือน**
- **กำไรสุทธิต่อ 1 ร้านค้า Pro:** `990 - 18.32 = 971.68 บาท/เดือน (Margin 98.15%)`
- **จุดคุ้มทุนทั้งระบบ (Break-even Point):** ขอเพียงมีลูกค้าสมัครแพ็กเกจ Pro **เพียง 2 ร้านค้าแรก** ระบบคืนทุนค่า LINE 1,605 บาททันที และสร้างกำไรสุทธิเพิ่มขึ้นตามจำนวนร้านค้า!

---

## 📌 เอกสารที่เกี่ยวข้องในระบบ (Document Map)
- 📋 **กติกาผลิตภัณฑ์ฉบับอนุมัติ (Master SSOT):** [`PRODUCT_RULES_V1.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/PRODUCT_RULES_V1.md)
- 📄 **บรีฟสเปกทางเทคนิค Phase 1:** [`BRIEF_PHASE1_AGY.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/docs/technical/BRIEF_PHASE1_AGY.md)
- 💰 **ข้อกำหนดราคาแพ็กเกจ:** [`PRICING_SPEC.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/docs/business/PRICING_SPEC.md)
- 🏠 **ดัชนีภาพรวมระบบ:** [`README.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/README.md)
