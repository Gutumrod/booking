> [!WARNING]
> **HISTORICAL / NON-AUTHORITATIVE AFTER BK-0 (2026-08-28).** This file is retained as implementation/business evidence only. Current product truth is governed by docs/DOCUMENTATION_INDEX.md, docs/PRODUCT_DECISIONS.md, and numbered docs/00_... through docs/10_.... Do not use old pricing, entitlement, LINE, storage, deployment, role, or marketing claims here as current requirements.

# 🚀 Project Executive Brief & Session Handoff

> **โปรเจกต์:** Local Service Booking & LINE Automation SaaS
> **ผู้พัฒนาหลัก:** คุณฟรี (CEO) & Antigravity AI Pair Programmer
> **สถานะปัจจุบัน:** **Phase A-D + E1-E3.3 ผ่าน live verification แล้ว**; E4.1-E4.8 ผ่าน live verification ครบแล้ว (2026-08-13, รวม billing tab UI + Stripe Checkout redirect ที่เจ้าของโปรเจกต์ล็อกอินเช็คเอง) — เหลือแค่ **E4.9 ส่วน production Stripe config** (Price ID จริง + webhook endpoint จริง) ที่ต้องรอมีโดเมนจริงก่อน — ดู [`docs/technical/PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md`](docs/technical/PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md) หัวข้อ "2026-08-13 live-gate results" และ [`docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md`](docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md)
> **หมายเหตุ E3.3:** ทำเองคนเดียวโดยไม่มี Codex รีวิว (ผู้ใช้อนุมัติล่วงหน้าคืน 2026-08-08 — ดู vault handoff) เจอบั๊กจริง 2 จุดระหว่าง live verification ของตัวเอง (view `security_invoker` ทำให้ anon อ่านไม่ได้, และ dashboard initial load ไม่โหลด phone/PromptPay/LINE field) แก้และ verify ซ้ำก่อนปิด checkpoint ทั้งคู่
> **หมายเหตุ E4.3-E4.4 (2026-08-11):** implementation แรกทำโดย Qwen Code (dispatch ผ่าน agent-relay-dispatch skill), Claude ตรวจ+verify live ต่อ เจอบั๊กจริง (`sync_subscription_state` RPC — `RETURNS TABLE(..., shop_id UUID)` ชนกับคอลัมน์ `subscriptions.shop_id` จน ambiguous ตอนรันจริง แม้ build/CREATE FUNCTION ผ่านสะอาด) แก้แล้ว verify ซ้ำครบ ดู [`QWEN_E4_3_E4_4_HANDOFF.md`](docs/technical/QWEN_E4_3_E4_4_HANDOFF.md) และ vault log ล่าสุด
> **Supabase Live Project:** `https://gyleqrjdzwwlqierdwcy.supabase.co` (`local_service` schema)
> **GitHub Repository:** [`https://github.com/Gutumrod/local-service-booking-saas`](https://github.com/Gutumrod/local-service-booking-saas)

---

## 1. บริบทและวิสัยทัศน์ของโปรเจกต์ (Project Vision & Core Value)

ระบบ **Local Service Booking SaaS** เป็นแพลตฟอร์มรับจองคิวออนไลน์สำหรับร้านค้าบริการในไทย (ร้านตัดผม/บาร์เบอร์, ร้านทำเล็บ/ขนตา, คลินิกเสริมความงาม, คาร์แคร์, สปา/นวด ฯลฯ)
- **Pain Point ที่เราแก้:** ร้านค้าในไทยไม่อยากจ่ายค่าข้อความ LINE Official Account (LINE OA) มหาศาล และไม่อยากได้ระบบจองคิวที่ซับซ้อนยุ่งยาก
- **จุดเด่นของเรา (Core Solution):**
  1. **Hybrid LINE Messaging Model:** ร้านค้าเล็กใช้ **LINE กลางของระบบ (`@central_booking_oa`)** ฟรี ไม่ต้องจ่ายค่าข้อความ LINE เพิ่มเติม! ร้านใหญ่ที่อยากใช้ LINE ร้านตัวเอง สามารถกรอก Channel Access Token ในหลังบ้านเพื่อสลับไปใช้ LINE ร้านค้าได้
  2. **15-Min Slot Lock & Dynamic PromptPay QR Deposit:** ลูกค้าจองคิว ล็อกเวลาไว้ 15 นาที พร้อมสแกน PromptPay QR โอนมัดจำเข้าบัญชีร้านค้าโดยตรง 100% (แพลตฟอร์มไม่หักเปอร์เซ็นต์มัดจำ)
  3. **Multi-Tenant SaaS Model:** สมัครสมาชิกร้านค้าใหม่ฟรี 14 วัน (Free Trial) ปรับเป็น Basic (฿490/ด. คิวจอง 100 คิว) หรือ Pro (฿990/ด. คิวจอง 500 คิว)

---

## 2. โครงสร้าง Monorepo & สถาปัตยกรรมระบบ (App Architecture)

```
D:\AI-Workspace\projects\local-service-booking-saas
├── apps/
│   ├── booking-consumer/       # Next.js 16 (Port 3000) -> หน้าจองคิวฝั่งลูกค้า /book/[slug] + LINE Webhook /api/line/webhook
│   └── booking-admin/          # Next.js 16 (Port 3001) -> หน้าหลังบ้าน /dashboard, /register, /platform-admin, /forgot-password
├── supabase/                   # Migration SQL files (local_service schema)
├── .env.local                  # Single Shared Environment Configuration (Hardlinked to both apps)
├── PRODUCT_RULES_V1.md         # เอกสารกฎการออกแบบและสเปกระบบฉบับสมบูรณ์ (Master Spec)
└── README.md                   # ดัชนีภาพรวมโปรเจกต์
```

---

## 3. สรุปผลงานที่เสร็จสิ้นจริง (ตรวจยืนยันผ่าน REST API จริง ไม่ใช่แค่ execute_sql)

1. ✅ **Supabase PostgreSQL Engine (`local_service` schema) — Phase 1 + Phase A:**
   - Apply migration ทั้งหมดใน `supabase/migrations/` ลงบน Supabase Project `gyleqrjdzwwlqierdwcy` จริง (ระหว่างทางเจอและแก้บั๊ก syntax/trigger-timing/exclusion-constraint ที่ทำให้ apply ไม่ผ่านหรือใช้งานไม่ได้จริงหลายจุด)
   - RPC `create_booking_hold` ล็อกสล็อตเวลา 15 นาที ออกรหัสจอง `BK-XXXXXX` กันคิวชนด้วย Postgres Exclusion Constraint จริง (ทดสอบ race condition ด้วย concurrent request 2 อันแย่ง slot เดียวกันแล้วผ่าน)
   - Seed ข้อมูลร้านค้าตัวอย่าง **Good Cuts Barber** (`slug: good-cuts-barber`) พร้อมบริการ/ช่าง/ตารางงาน/วันหยุด
   - **Phase A hardening:** ปิดช่องโหว่ privileged RPC ที่ anon เรียกได้, ปิด anon direct insert ข้าม RPC, validate slip URL ผูกกับ booking จริง — ดู [`PHASE_A_COMPLETION_REPORT_2026-08-07.md`](docs/technical/PHASE_A_COMPLETION_REPORT_2026-08-07.md)
2. ✅ **Single Shared Environment Configuration (`.env.local`):**
   - สร้างไฟล์ `.env.local` ตัวหลักที่ root directory และทำ Hardlink เชื่อมตรงไปยังทั้ง 2 apps
   - รองรับการตั้งค่า `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_CENTRAL_LINE_OA_ID`, `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN` ในจุดเดียว
3. ✅ **LINE OA Webhook Gateway (`/api/line/webhook`) — Phase B เสร็จแล้ว ใช้งานได้จริง:**
   - HMAC-SHA256 signature verification ด้วย `crypto.timingSafeEqual` (กัน timing attack), parse คำสั่ง `ผูกคิว {booking_code}-{link_token}` ครบ
   - เปลี่ยนมาใช้ `apps/booking-consumer/src/lib/supabase-admin.ts` (service_role client, server-only, ไม่หลุดไป client-side) แทน anon key ที่โดน RLS บล็อกเงียบๆ ของเดิม
   - Audit log (`line_notification_logs`) ใช้ lifecycle `pending → sent/failed` กันเคสที่ LINE ส่งสำเร็จแต่บันทึกผลไม่สำเร็จแล้วโดนตีเป็น "failed" เท็จ
   - Verify จริงด้วย signed webhook POST ต่อ dev server (ไม่ใช่แค่อ่านโค้ด) — ดูรายละเอียดที่ [`2026-08-07-phase-b-checkpoint-gotchas.md`](file:///D:/AI-Workspace/vault/06-Agent-Logs/Local-Service-Booking-SaaS/2026-08-07-phase-b-checkpoint-gotchas.md) ใน vault (local path, git-synced แยกจาก repo นี้)
4. ✅ **เชื่อมต่อ Frontend เข้ากับ Backend + Phase C fail-closed/no-deposit fixes:**
   - หน้า `/book/[slug]` ฝั่งลูกค้า **เชื่อมและทดสอบ end-to-end จริงแล้ว** (จอง → ล็อกสล็อต → อัปโหลดสลิปเข้า Supabase Storage จริง → ยืนยัน)
   - **Phase C:** บริการไม่มีมัดจำ (`status=confirmed, deposit_status=not_required`) ข้ามหน้าอัปโหลดสลิปไปหน้ายืนยันคิวทันที ไม่บังคับ QR/สลิปอีกต่อไป
   - **Phase C:** พนักงานที่ไม่มีแถว `staff_schedules` ของวันนั้นถือว่า **ไม่ว่าง** (fail-closed) ทั้ง RPC `create_booking_hold` และ frontend availability check — เดิมเป็น fail-open (ถือว่าว่างเสมอ) เป็นบั๊กที่แก้แล้ว บันทึกกฎไว้ใน [`PRODUCT_RULES_V1.md`](PRODUCT_RULES_V1.md) ข้อ 3.5
5. ✅ **หน้า `/dashboard` ฝั่งร้านค้า — Phase E1-E3.2 เชื่อม backend จริงแล้ว (ยกเว้น settings/billing ที่ยังรอ E3.3-E4):**
   - **E1 — Owner Auth:** Supabase Auth email/password จริง, `/login`, `/auth/callback` (รองรับทั้ง PKCE และ email OTP confirm), dashboard guard เช็ค session + `shop_users` membership จริงฝั่ง server, logout — `/register` สร้างบัญชี Auth จริง + เรียก RPC `provision_owner_shop` (atomic, idempotency-keyed, กัน 1 account เป็นเจ้าของได้แค่ 1 ร้าน)
   - **E2 — Bookings Tab:** ลบ `INITIAL_BOOKINGS` mock, โหลดคิวจริงตาม shop ของผู้ใช้ที่ login, approve/reject/cancel ผ่าน RPC ที่เช็ค `is_shop_member` + row lock (`FOR UPDATE`) ทั้งหมด ไม่ใช่ raw `.update()` เหมือนเดิม — ยกเลิกบังคับระบุเหตุผลจริง ไม่ auto-mark มัดจำเป็น refunded (ร้านต้องคืนเงินเองแล้วบันทึกย้อนหลังตาม V1 ข้อ 4.4)
   - **E3.1 — Services & Staff:** เพิ่ม `has_shop_role()`/`is_shop_owner()`, RPC จัดการบริการ (owner/admin) และพนักงาน (owner เท่านั้น) ตรงตาม role matrix ใน V1 ข้อ 7, soft-disable ผ่าน `is_active` (services มี booking FK แบบ `ON DELETE RESTRICT` ลบจริงไม่ได้)
   - **E3.2 — Schedules & Holidays:** RPC บันทึกตารางพนักงาน 7 วันแบบ atomic (ตรวจวันซ้ำ/เวลา/break) + RPC จัดการวันหยุดร้าน (idempotency-keyed) — owner/admin แก้ได้, staff อ่านอย่างเดียว (ยังไม่มี column เชื่อม `auth user` กับ `staff.id` จึงพิสูจน์ "ตัวเอง" ของ staff ไม่ได้ — deferred)
   - **ทุก checkpoint ปิดช่องโหว่เดียวกัน:** table เดิมมี `GRANT ALL`/policy `FOR ALL USING (is_shop_member(...))` ที่ไม่แยก role เลย แปลว่า **staff ธรรมดาเขียนตรงเข้าตารางได้มาตลอด** ก่อนหน้านี้ — ทุก RPC ใหม่ revoke direct write จาก `authenticated` แล้วบังคับผ่าน RPC ที่เช็ค role จริง
   - **E3.3 — Shop Settings:** เสร็จแล้ว — พบและปิดช่องโหว่: `shops` table เปิดให้ anon `select *` ได้ทุกคอลัมน์รวม `subscription_status`, `trial_ends_at`, `owner_name` (ยืนยันจริงผ่าน REST) แก้ด้วย view `shop_public_profile` (คอลัมน์จำกัดเฉพาะที่หน้าจองใช้จริง) + RPC `update_shop_settings` (owner เท่านั้น ตาม V1 ข้อ 7) ตัด Custom LINE Channel Token input ออกจาก client ทั้งหมด (ไม่เคยเชื่อม backend เลย ถอดก่อนจะกลายเป็น client secret risk)
   - **E4 (Billing/Stripe) — Launch-1 staged, not live-complete:** E4.1-E4.6 ได้ verify live แล้ว. E4.7 billing tab ใช้ `subscriptions` จริง, E4.8 booking-acceptance gate และ E4.9 docs อยู่ใน source แล้ว แต่ต้อง apply migration + verify Stripe/REST/browser ก่อนปิด phase. ดู [`PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md`](docs/technical/PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md).

---

### 📌 เอกสารอ้างอิงสำคัญในโปรเจกต์
- 🏠 **Project README:** [`README.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/README.md)
- 📄 **Master Spec & Rules:** [`PRODUCT_RULES_V1.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/PRODUCT_RULES_V1.md)
- 🛠️ **แผนงาน Phase A-E:** [`docs/technical/BRIEF_PHASE2_HARDENING_A_TO_E.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/docs/technical/BRIEF_PHASE2_HARDENING_A_TO_E.md)

## 3.2 หน้าหลังบ้านร้านค้า (`apps/booking-admin/src/app/dashboard/page.tsx`) — 6/6 แท็บเชื่อมใน source, Launch-1 รอ live gate

- สถานะ 6 แท็บ (อัปเดต 2026-08-08 หลัง E3.3):
  1. `bookings` ✅ **จริง (E2):** โหลดคิวจริงตาม shop ของผู้ login, approve/reject/cancel ผ่าน RPC, loading/error/empty state, ป้องกันกดซ้ำระหว่าง mutation
  2. `staff` ✅ **จริง (E3.1):** เพิ่ม/เปิด-ปิดพนักงานผ่าน RPC (owner เท่านั้น), soft-disable ไม่ลบจริง
  3. `services` ✅ **จริง (E3.1):** เพิ่ม/แก้/ปิดบริการผ่าน RPC (owner/admin), soft-disable ผ่าน `is_active`
  4. `schedules` ✅ **จริง (E3.2):** ตารางพนักงาน 7 วัน + วันหยุดร้าน โหลด/บันทึกจริงผ่าน RPC แบบ atomic (owner/admin), ตัด state "เวลาเปิดร้านรวม" ที่ไม่มี backend column ออกแล้ว
  5. `settings` ✅ **จริง (E3.3):** ชื่อร้าน/เบอร์/ที่อยู่/PromptPay/LINE OA ID บันทึกผ่าน RPC `update_shop_settings` (owner เท่านั้น) — ตัด Channel Token input และปุ่มทดสอบส่ง LINE (mock) ออกหมดแล้ว
  6. `billing` ✅ **จริง (E4.7, verify ครบ 2026-08-13):** เจ้าของโปรเจกต์ล็อกอินเช็คเองจริง เห็นแพ็กเกจ/สถานะ/วันหมดอายุ trial ตรงกับ DB เป๊ะ ไม่มี mock, กดปุ่ม upgrade แล้ว redirect ไปหน้า Stripe Checkout (sandbox) จริงพร้อมข้อมูลถูกต้องครบ; Portal ขึ้น "No billing account yet" ถูกต้องเพราะยังไม่เคย checkout จริง

### 🟢 3.3 หน้าสมัครสมาชิกร้านค้าใหม่ (`apps/booking-admin/src/app/register/page.tsx`)
- **4-Step Onboarding Wizard:** ข้อมูลร้านค้า ➔ เลือกแพ็กเกจ (ผูก query string `?plan=...`) ➔ ตั้งค่า PromptPay ➔ สำเร็จ
- **Free-text Business Category:** กรอกหมวดหมู่อิสระ พร้อมปุ่ม Quick Suggestion Chips 8 ประเภท
- **Editable URL Slug Input:** มีช่องกรอก URL สลักร้านค้าภาษาอังกฤษ พร้อมข้อความกำกับกระชับ: `💡 หมายเหตุ: URL ใช้ภาษาอังกฤษเพื่อป้องกันการแปลงภาษาผิด` (แก้ปัญหาร้านค้าชื่อไทยโดนลบหลุดเป็น `my-shop`)

### 🟢 3.4 หน้าศูนย์ควบคุม CEO คุณฟรี (`apps/booking-admin/src/app/platform-admin/page.tsx`)
- **Pending Shop Approval Queue:** การ์ดสีส้มเตือนเมื่อมีร้านใหม่สมัครเข้ามา มีปุ่ม `อนุมัติเปิดใช้งาน` / `ปฏิเสธ` / `โทรหาเจ้าของร้าน`
- **Status Filter Tabs:** ซ่อนร้านค้าที่ยกเลิก/ระงับบริการโดยอัตโนมัติ มีแท็บสลับดู `Active`, `Pending`, `Cancelled`, `All`
- **Expiration Date Column:** คอลัมน์วันหมดอายุ/ตัดรอบบิลถัดไป พร้อมปุ่มกดขยายเวลา **`+14 วัน`** สำหรับคุณฟรี
- **Impersonation Button:** ปุ่มทางลัด **`👁️ ดูหลังบ้าน`** แอบวาร์ปเข้าแดชบอร์ดหลังบ้านของร้านค้า

### 🟢 3.5 หน้ากู้คืนรหัสผ่านร้านค้า (`apps/booking-admin/src/app/forgot-password/page.tsx`)
- แบบฟอร์มกู้คืนรหัสผ่านสำหรับร้านค้าที่ลืมรหัสผ่าน สำหรับส่งอีเมลรีเซ็ตใน Phase 1

---

## 4. ผลการตรวจวิเคราะห์คุณภาพ (Independent Audit Passed)

โปรเจกต์ผ่านการสแกนตรวจโค้ดจาก **Independent Quality Auditor Subagent** แบบ 100% Honest & Zero Flattery และผ่านการแก้ไขบั๊กวิกฤตครบถ้วนทั้ง 3 จุด:
1. ✅ **แก้บั๊ก Slug ร้านภาษาไทยใน `/register`:** ใช้ unique slug `shop-XXX` + editable input พร้อมข้อความหมายเหตุภาษาอังกฤษ
2. ✅ **แก้บั๊กสล็อตเวลา 15 นาทีใน `/book/[slug]`:** ล็อกฟอร์มเมื่อหมดเวลา มีแถบสีแดงเตือน + ปุ่มเลือกเวลาใหม่
3. ✅ **แก้ปุ่มดาวน์โหลดรูป QR มัดจำ:** โหลดไฟล์ `.png` ยอดมัดจำลงเครื่องจริง

---

## 5. แผนการดำเนินงานต่อ (Roadmap & Next Steps)

Phase A-D เสร็จแล้ว, Phase E แตกเป็น checkpoint ย่อย (E1, E2, E3.1-E3.3, E4) ตาม [`docs/technical/BRIEF_PHASE2_HARDENING_A_TO_E.md`](docs/technical/BRIEF_PHASE2_HARDENING_A_TO_E.md) — **ห้ามข้ามลำดับ** แต่ละ checkpoint ต้อง verify ผ่าน REST API จริง (+ browser สำหรับ UI) ก่อนเริ่ม checkpoint ถัดไป:

- ✅ **Phase B:** แก้ LINE webhook ให้ใช้ `SUPABASE_SERVICE_ROLE_KEY` ผ่าน server-only admin client — commit `370473f`
- ✅ **Phase C:** แก้ frontend no-deposit flow + fail-closed staff schedule — commit `c8a00e3`
- ✅ **Phase D:** เอกสารขั้นตอน manual "Exposed schemas" กันเจอ `406 PGRST106` ซ้ำตอน deploy ใหม่
- ✅ **Phase E1:** Owner auth (Supabase Auth email/password + atomic shop provisioning RPC) — commit `a42ec09`
- ✅ **Phase E2:** Bookings tab เชื่อมจริง + approve/reject/cancel RPC — commit `38058a6`
- ✅ **Phase E3.1:** Services & Staff management RPC + role authorization — commit `bd761fe`
- ✅ **Phase E3.2:** Schedules & Holidays RPC + role authorization — commit `8bd6a45`
- ✅ **Phase E3.3:** Shop Settings จริง + ตัด LINE Channel Token ออกจาก client + ปิดช่องโหว่ `shops` table เปิด column ภายในให้ anon อ่านได้ — ดู [`PHASE_E3_3_COMPLETION_REPORT_2026-08-08.md`](docs/technical/PHASE_E3_3_COMPLETION_REPORT_2026-08-08.md)
- 🟡 **Phase E4 (กำลังทำ):** ดู checklist เต็มที่ [`BRIEF_PHASE_E4_STRIPE_BILLING.md`](docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md)
  - ✅ E4.1 subscriptions schema — commit `53f3be9`
  - ✅ E4.2 Product/Price สร้างจริงใน Stripe test mode ผ่าน CLI (`STRIPE_PRICE_BASIC`/`STRIPE_PRICE_PRO` ใน `.env.local`)
  - ✅ E4.3 idempotency table + E4.4 webhook handler (5 events) — commit `d5d5e2d` (เจอ+แก้บั๊ก `sync_subscription_state` ambiguous column ระหว่าง live test)
  - ✅ E4.5 Checkout Session route + ต่อปุ่ม upgrade ใน dashboard จริง — commit `5fb989f`
  - ✅ E4.6 Customer Portal route + ปุ่ม "จัดการการชำระเงิน" ใน dashboard ต่อจริงแล้ว — ระหว่าง verify เจอบั๊กจริงใน E4.4 (`current_period_end` ไม่มีอยู่ระดับบนของ Subscription object แล้วใน API version ปัจจุบัน, การกด cancel ผ่าน Portal ไม่ตั้ง `cancel_at_period_end=true` แต่ตั้ง `cancel_at` แทน) แก้แล้ว verify ซ้ำผ่าน — ดู [`BRIEF_PHASE_E4_STRIPE_BILLING.md`](docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md)
  - ✅ **E4.7 billing tab เลิก mock:** verify ครบแล้ว (2026-08-13) — query `subscriptions` จริง + เจ้าของโปรเจกต์ล็อกอินเช็ค UI เองจริง เห็นข้อมูลถูกต้อง กด Checkout redirect ไป Stripe จริง (sandbox)
  - ✅ **E4.8 booking-acceptance gate:** apply migration บน live DB แล้ว (2026-08-13) — verify จริงผ่าน anon REST ครบทุก state (`canceled`/`unpaid` บล็อก, `active`/`past_due`/`trialing` ผ่าน, trial หมดอายุบล็อก) และ browser จริงทั้ง blocked/allowed page ดู [`PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md`](docs/technical/PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md) หัวข้อ "2026-08-13 live-gate results"
  - 🟡 **E4.9 manual config docs:** เขียนแล้ว; production webhook/Price IDs ต้องกรอกโดย owner เมื่อมี domain จริง

เมื่อเปิดแชทใหม่ ให้บอก AI Agent ในแชทใหม่ดังนี้:

```text
"สวัสดีครับ ผมต้องการลุยโปรเจกต์ Local Service Booking SaaS ต่อ
โปรดอ่านไฟล์ PRODUCT_RULES_V1.md, PROJECT_HANDOVER_BRIEF.md,
docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md ในคลังไฟล์

Phase A-D, E1-E3.3 และ E4.1-E4.6 ผ่าน live verification แล้ว
Launch-1 (E4.7-E4.9) อยู่ใน source แต่ยังรอ apply migration และ live verification
โปรดอ่าน PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md แล้วทำเฉพาะ live gate ที่เหลือ"
```

## 6. ⚠️ ขั้นตอน Manual ที่ทำอัตโนมัติไม่ได้ (ต้องทำเองทุกครั้งที่ deploy โปรเจกต์ใหม่)

หลัง apply migration ทั้งหมดใน `supabase/migrations/` ลง Supabase project ใหม่แล้ว **ต้องเข้า Dashboard ไปเพิ่ม `local_service` ใน Exposed schemas เอง** ที่ Project Settings → API → Data API → Exposed schemas

ขั้นตอนนี้ทำผ่าน SQL, Supabase Management API, หรือ MCP tool ใดๆ **ไม่ได้** ต้องกดผ่านหน้า Dashboard เท่านั้น ถ้าข้ามขั้นตอนนี้ไป ทุก request ที่ยิงเข้าตาราง/RPC ใน schema `local_service` จะได้ error `406 PGRST106: Invalid schema` แม้ migration และ RLS grants จะถูกต้องครบทุกอย่างแล้วก็ตาม — เคยเกิดขึ้นจริงกับโปรเจกต์นี้มาแล้วครั้งหนึ่ง (2026-08-07) กว่าจะวินิจฉัยเจอ

### ⚠️ Auth Redirect URLs (เพิ่มใหม่จาก Phase E1 — ต้องอัปเดตอีกครั้งตอน deploy จริง)

`/register` และ `/login` ของ `booking-admin` ใช้ Supabase Auth email/password + email confirmation จริง ซึ่งต้องเพิ่ม URL ไว้ล่วงหน้าที่ Dashboard → Authentication → URL Configuration:

- **ตอนนี้ (dev, ใส่ไว้แล้ว 2026-08-07):** Site URL = `http://localhost:3001`, Redirect URLs = `http://localhost:3001/auth/callback` (+ `http://localhost:3001/**`)
- **ตอน deploy ขึ้นโดเมนจริง (ยังไม่ทำ):** ต้องกลับมาเพิ่ม `https://<โดเมนจริง>/auth/callback` (และปรับ Site URL) ที่หน้าเดียวกัน — ถ้าลืม ลิงก์ยืนยันอีเมลที่ส่งจาก production จะ redirect ไม่ได้ (เข้าทำนองเดียวกับ Exposed Schemas ข้างบน คือทำผ่าน SQL/MCP ไม่ได้ ต้องกด Dashboard เอง)

---

### 📌 เอกสารอ้างอิงสำคัญในโปรเจกต์
- 📄 **Master Spec & Rules:** [`PRODUCT_RULES_V1.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/PRODUCT_RULES_V1.md)
- 🏠 **Project README:** [`README.md`](file:///D:/AI-Workspace/projects/local-service-booking-saas/README.md)
