> [!NOTE]
> **BK-0 AUTHORITY NOTICE (2026-08-28):** Historical/implementation evidence only. Current product and production contract is governed by docs/DOCUMENTATION_INDEX.md and the numbered BK-0 SSOT. Preserve this file for evidence; do not treat older architecture, pricing, deployment or completion wording as current authority.

# 🛡️ ARCHITECTURE & SECURITY STANDARD SPECIFICATION
## "Local Service Booking & LINE Automation SaaS"

> **อนุมัติและบังคับใช้โดย:** คุณฟรี (CEO)
> **วันที่มีผล:** 2026-08-06
> **Supabase Live Project URL:** `https://gyleqrjdzwwlqierdwcy.supabase.co`

---

## 🏗️ 1. ARCHITECTURE & TECH STACK
- **Monorepo Architecture:** npm workspaces (`apps/booking-consumer`, `apps/booking-admin`)
- **Framework:** Next.js 16 (App Router + Turbopack) + TypeScript + Tailwind CSS
- **Live Supabase Project URL:** `https://gyleqrjdzwwlqierdwcy.supabase.co`
- **Database Engine:** Supabase PostgreSQL with Row Level Security (RLS) under `local_service` schema
- **Master Business Rules Standard:** [`PRODUCT_RULES_V1.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/PRODUCT_RULES_V1.md) (Single Source of Truth)
- **Notifications:** Central LINE Messaging API (`@central_oa_id`) with Webhook HMAC-SHA256 verification
- **Subscription Payment Provider:** **Stripe Single Provider Standard** (Checkout / Billing / Portal / Webhooks)

---

## 🔒 2. SECURITY & SECRETS GOVERNANCE
1. **No Plain-Text Token Inputs in Client DOM:**
   `Channel Access Token` และ `Channel Secret` ของระบบส่ง LINE ต้องถูกจัดเก็บเป็น Environment Variables หรือ Supabase Secrets บน Server-side เท่านั้น **ห้ามเปิดช่อง Input ใน React Component Client-side เด็ดขาด**
2. **Zero-Friction Central LINE Bot Security:**
   ร้านค้าใช้งานระบบโดยไม่ต้องกรอก LINE Token ใดๆ ระบบดึง `shop_id` จาก JWT/Session และส่งผ่าน Central LINE API บน Server-side อย่างปลอดภัย
3. **Multi-Tenant Row Level Security (RLS):**
   ทุกคำสั่ง Database Query ต้องอิงตาม `shop_id` เสมอ มั่นใจว่าร้านค้า A ไม่สามารถอ่านหรือแก้ไขข้อมูลคิวงานของร้านค้า B ได้ 100%
4. **Anti-Slip Duplication & Private Storage:**
   รูปสลิปมัดจำเก็บใน Private Bucket เท่านั้น เข้าถึงผ่าน Signed URL อายุ 5 นาที และมี Unique Index บน `bookings.trans_ref` ป้องกันสลิปซ้ำทั้งระบบ

---

## 💳 3. STRIPE SINGLE GATEWAY GOVERNANCE
- **Single Subscription Provider Rule:** ใช้ Stripe เป็น sole payment gateway ตัวเดียวสำหรับจัดการ Subscription Tiers (Basic 490 THB/mo, Pro 990 THB/mo) และ Top-up Add-on Packs (+100 Bookings = 199 THB, +100 Auto-Slips = 99 THB)
- **Prevent Dual Gateway Conflicts:** ห้ามทำระบบรับชำระค่าสมาชิกผ่านผู้ให้บริการบัตรเครดิตรายอื่นซ้อนทับกับ Stripe เพื่อป้องกันปัญหา Webhook Status Conflict และ Reconciliation ล้มเหลว

---

## 🤖 4. CENTRAL LINE BOT AUTOMATION & REMINDERS
1. **Customer Receipt Flex Cards:** ส่งใบจองคิว Flex Message ทันทีหลังลูกค้ากดยืนยันมัดจำ
2. **Automated Reminders (1 Hour Before - Pro Plan):** ทำงานผ่าน Scheduled Cron Job / Supabase Edge Functions ตรวจสอบคิวที่จะถึงในอีก 1 ชั่วโมงข้างหน้า และยิง LINE แจ้งเตือนลูกค้าโดยอัตโนมัติ (เว้น Quiet Hours 21:00-08:00 น.)
