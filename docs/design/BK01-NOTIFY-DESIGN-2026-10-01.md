# BK01 NOTIFY — design note (ก้อน 2 · B3 + B4)

Task: `HOUSE-BK01-NOTIFY` · ผู้คุม Claude `dd7e55e1` · ผู้รีวิว Codex · 2026-10-01
branch `codex/bk01-notify-20261001` · base `c5e6650d9c3e46c76d05e27fdcf76f49da62ffd1`
บรีฟ 23 ส่วน 0, 1, 3 · สถานะสูงสุดที่เอกสารนี้รับรอง = `SOURCE_LEVEL` เท่านั้น

## 1. ของที่มีอยู่จริงบนดิสก์ (ตรวจเองที่ base ก่อนออกแบบ)

| ของ | ที่อยู่ | สภาพจริง |
|---|---|---|
| outbox | `local_service.line_notification_logs` | มี `idempotency_key`, `attempt_count`, `scheduled_for`, `next_retry_at`, `sent_at`, `status`, `recipient_type` (`customer`\|`shop_owner`), `error_message` |
| claim/complete | `claim_due_line_notifications(int)`, `complete_line_notification(...)` | SECURITY DEFINER · `GRANT` ให้ `service_role` |
| นโยบายลองใหม่ | `apps/booking-consumer/src/lib/notification-policy.ts` | `nextNotificationAttempt()` เพียว ๆ ไม่มี I/O — backoff 60·2^n cap 3600s, หยุดที่ 5 ครั้ง / cancelled |
| ตัวส่ง | `apps/booking-consumer/src/app/api/notifications/dispatch/route.ts` | claim 25 → delivery context → **LINE push อย่างเดียว** ทั้ง `customer` และ `shop_owner` |
| ตัวตั้งเวลา | `apps/booking-consumer/custom-worker.ts` + `wrangler.jsonc` | cron `*/5 * * * *` |
| ป้ายหลังบ้าน | `apps/booking-admin/src/app/dashboard/page.tsx:222` | `pendingDeposit = bookings.filter(status==='pending_review').length` แสดงที่ KPI card แล้ว — แต่ไม่ polling ไม่มีเสียง ไม่มีตัวนับ "ค้างรอตัดสินหลังวันนัด" |
| หน้าลูกค้า | `apps/booking-consumer/src/app/manage-booking/page.tsx` | มีแค่ฟอร์มยกเลิก/เลื่อน — **ไม่มีหน้าสถานะ ไม่มีลิงก์อัปโหลดใหม่** |
| ปฏิเสธสลิป | `local_service.reject_deposit_slip` | ตั้ง `status='hold'`, `deposit_status='rejected'`, `expires_at = NOW()+15min` |
| upload gate | `local_service.authorize_deposit_slip_upload` | รับเฉพาะ `status='hold'` + `deposit_status IN ('awaiting','rejected')` + `expires_at > now()` |
| นับครั้ง | `bookings.slip_submit_count` | มีจริง เพิ่มที่ `submit_deposit_slip` |

## 2. B3(ก) — ป้ายหลังบ้าน (ไม่แตะ DB)

- ตัวเลขที่ต้องการ 2 ตัว: `รอตรวจสลิป N` (จาก `status='pending_review'`) และ `ค้างรอตัดสินหลังวันนัด M`
- **ตัวนับ M ยังนับไม่ได้วันนี้** เพราะยังไม่มีสถานะ/ธงสำหรับ "เลยวันนัดแล้วร้านยังไม่ตัดสิน" — ก้อน 1 เป็นเจ้าของ (บรีฟ 23 §2 ข้อ 2) ⇒ หน้าจอเรนเดอร์ช่องนี้แบบ **fail-closed**: ไม่มีตัวนับจาก server = แสดงข้อความ "ยังไม่เปิดใช้ · รอตัวนับจากก้อน 1" ไม่เดาเลข
- polling เบา ๆ **60 วินาที** เฉพาะแท็บ `bookings` และเฉพาะเมื่อ `document.visibilityState === 'visible'` — ใช้ `loadDashboardBookings(false)` เดิม (ไม่แตะ gate/tenant boundary เดิม)
- เสียงเตือน: เมื่อจำนวน `pending_review` **เพิ่มขึ้น** ระหว่างเปิดหน้า → เล่นเสียงสั้น ๆ ครั้งเดียวต่อการเพิ่มหนึ่งครั้ง · ปิดได้ · เก็บค่าที่ `localStorage` (คีย์ `bk01.admin.slipAlertSound`)
- เสียงสร้างจาก `WebAudio` oscillator ไม่ใช้ไฟล์ asset (ไม่เพิ่ม dependency, ไม่มีไฟล์ไบนารีใหม่ในเรポ) · ปิดเป็นค่าเริ่มต้น? **ไม่** — เปิดเป็นค่าเริ่มต้น แต่มีปุ่มปิดชัดเจน (บรีฟเขียนว่า "เสียงเตือนเมื่อมีรายการใหม่ตอนเปิดหน้าอยู่ (ปิดได้)")
- ไม่ใช้ Notification API / Web Push (บรีฟบอก Web Push = ทำทีหลัง)

## 3. B3(ข) — อีเมลถึงร้าน

### 3.1 ทำไมไม่สร้างตารางใหม่
ใช้ outbox เดิม (`line_notification_logs`) ต่อ เพราะมี claim/complete/backoff/idempotency ครบแล้ว การทำตารางใหม่จะซ้ำ mechanism และต้องรื้อ claim/complete ⇒ ผิด YAGNI

### 3.2 ช่องทางตัดสินจาก `recipient_type`
`shop_owner` → **อีเมลเท่านั้น ห้าม LINE เด็ดขาด** (ข้อจำกัด Owner A-20) · `customer` → LINE เดิม
⇒ `resolveNotificationChannel()` เป็นฟังก์ชันเพียว ที่ route ใช้ตัดสิน; เคส `shop_owner` จะไม่แตะ LINE code path เลย

### 3.3 Quiet hours (22:00–08:00 Asia/Bangkok)
- ฟังก์ชันเพียว `resolveEmailSchedule(nowUtc, eventKind)`:
  - `immediate` → ถ้าอยู่ใน quiet hours → เลื่อนเป็น **09:00 Bangkok ของวันถัดไป** · นอกช่วง → ส่งทันที
  - `daily_summary` (09:00 / 17:00) → รอบ 09:00 ถูกส่งอยู่แล้วหลัง quiet hours จึงไม่ถูกเลื่อน
- แปลงเวลาด้วย offset คงที่ **+07:00** (ไทยไม่มี DST) และใช้ `Intl.DateTimeFormat` กับ `timeZone: 'Asia/Bangkok'` เป็นตัวตัดสินจริง เพื่อไม่ให้ offset ในโค้ดเป็นความจริงคู่ขนาน
- 09:00 Bangkok = 02:00 UTC · 17:00 Bangkok = 10:00 UTC

### 3.4 ตัวส่ง = Resend (adapter เดียว)
- `RESEND_API_KEY` + `EMAIL_FROM` จาก env · **ไม่มีคีย์ = fail-closed**: `configurationError = 'EMAIL_NOT_CONFIGURED'` · คืนสถานะ "ยังไม่ได้ตั้งค่า" ให้ caller บันทึกเป็น `error_message` · **ห้ามลอบส่งทางอื่น** (ไม่มี fallback ไป LINE/SMTP)
- `EmailTransport` เป็น interface ที่ฉีดได้ · default = `fetch('https://api.resend.com/emails')` · test ใช้ fake transport และยืนยันว่า **ถูกเรียกจริง** ด้วย payload ที่ถูกต้อง
- ยังไม่มี dependency ใหม่: เรียก Resend HTTP API ตรงด้วย `fetch` (มีอยู่แล้วใน runtime ของ worker)

### 3.5 เนื้อหาอีเมล — น้อยที่สุด (บังคับด้วยเทสต์)
อนุญาตเฉพาะ: **ชื่อร้าน · จำนวน + รหัสคิว · ลิงก์เข้าหลังบ้าน**
ห้าม: ชื่อลูกค้า · เบอร์ลูกค้า · ยอดเงิน · ภาพ/ลิงก์สลิป · ชื่อบริการ/พนักงาน
⇒ `buildMerchantEmail()` รับ input ที่ **มีเฉพาะฟิลด์ที่อนุญาต** (type ระดับ TS บังคับ) และมีเทสต์ที่ (ก) ยืนยันว่าข้อความไม่มีฟิลด์ต้องห้าม แม้ caller ส่ง object ที่มี field แปลกปลอมเข้ามา (ข) ตรวจว่า subject/body ไม่มี `@`, ไม่มีเลขโทรศัพท์, ไม่มี `฿`, ไม่มีคำว่า `amount`/`slip`/`ยอด`/`สลิป`

### 3.6 ผู้รับ
อีเมลล็อกอินเดิมของเจ้าของร้าน = `auth.users.email` ผ่าน `shop_users.role='owner'`
**อ่านจาก client เดิมไม่ได้** — `get_line_notification_delivery_context` ไม่มีคอลัมน์อีเมล และ runtime role ไม่มีสิทธิ์อ่าน `auth.users`
⇒ route ฉีด `MerchantRecipientResolver` ได้ · default = เรียก RPC ใหม่ `get_shop_notification_recipient(uuid)` ที่ **ยังไม่มีบนดิสก์** ⇒ ต้องเป็น SQL ที่ส่งสเปก (§5) · resolver ล้ม = fail-closed ไม่ส่ง และไม่ปิดงานเป็น `sent`

### 3.7 สรุปอีเมลรายวัน 09:00/17:00
การสร้างแถวสรุปรายวันต้องมีตัว enqueue ฝั่ง DB (§5) · โค้ดฝั่ง route/นโยบายรองรับ event `daily_slip_summary` แล้ว (ตัดสินรอบเวลาจาก `scheduled_for` + quiet-hours policy)

## 4. B4 — ลูกค้าถูกปฏิเสธ

- หน้าจอใหม่ใน `manage-booking`: อ่านสถานะคิวจริง (ต้องมี read path) → TH/EN
- กติกาผู้คุม (บรีฟ 23 §3): อัปโหลดใหม่ได้เฉพาะ **คิวยังว่าง** · จำกัดครั้งตาม `slip_submit_count` · ถ้าคิวถูกจองแล้วบอกให้จองใหม่
- เกณฑ์ "คิวยังว่าง" ที่ผูกกับความจริงบนดิสก์: `status='hold'` **และ** `deposit_status IN ('awaiting','rejected')` **และ** `expires_at > now()` — ตรงกับ `authorize_deposit_slip_upload` เป๊ะ (ไม่ประดิษฐ์นิยามที่สอง)
- จำนวนครั้งสูงสุด: ใช้เพดานเดิมของระบบ **5** (เท่ากับเพดาน retry ใน `notification-policy.ts`) — เป็นค่าที่มีอยู่แล้ว ไม่ตั้งเลขใหม่
- ข้อความแจ้งลูกค้าเมื่อถูกปฏิเสธ: ผ่าน **LINE เดิมของลูกค้า** (ใช้ dispatch เดิม) — เทมเพลตข้อความ TH/EN อยู่ใน `line-flex-templates.ts` แบบเดิม
- ส่วนที่ต้องแก้ SQL ของการปฏิเสธ/อัปโหลดใหม่ = **ของก้อน 1** ⇒ §5

## 5. รายการฟังก์ชัน/วิว SQL ที่ต้องแตะ (ส่งผู้คุม — เราไม่เขียน)

> ทั้งหมดนี้ **ไม่ได้เขียน** ในก้อนนี้ · ก้อน 1 เป็นเจ้าของฟังก์ชันที่ทับซ้อน (`submit_deposit_slip`, `reject_deposit_slip`, `create_booking_hold`) · ผู้คุมรวมเลข migration ไม่ให้ชน

1. `local_service.submit_deposit_slip` — **ของก้อน 1** (ก้อน 1 แก้ `expires_at`/ล็อกคิว) · ก้อน 2 ไม่แตะ
2. `local_service.reject_deposit_slip` — **ของก้อน 1** (ต้องให้ "อัปโหลดใหม่ได้เมื่อคิวยังว่าง" จริง — ปัจจุบันรีเซ็ต `expires_at` เป็น +15 นาทีเสมอ) · ก้อน 2 ไม่แตะ
3. `local_service.create_booking_hold` — **ของก้อน 1** · ก้อน 2 ไม่แตะ
4. **ใหม่** `local_service.get_shop_notification_recipient(p_shop_id uuid) RETURNS TABLE(shop_name text, recipient_email text)` — SECURITY DEFINER · `GRANT EXECUTE TO bk01_runtime` · คืนอีเมลของ `shop_users.role='owner'` ที่ match `auth.users.email` (ตัวแรกถ้าหลายคน) · ไม่คืนคอลัมน์อื่น · ใช้โดย B3(ข)
5. **ใหม่** ตัว enqueue แจ้งเตือนร้าน — เสนอ `local_service.enqueue_merchant_slip_notifications()` (trigger `AFTER UPDATE OF status, deposit_status ON local_service.bookings`):
   - `NEW.status='pending_review' AND OLD.status IS DISTINCT FROM 'pending_review'` → แถว `event_type='deposit_slip_submitted'`, `recipient_type='shop_owner'`, `idempotency_key='shop_slip:'||NEW.id`
   - ต้องขยาย CHECK ของ `event_type` (ปัจจุบันไม่มีค่า `deposit_slip_submitted` / `daily_slip_summary`) — **ถ้าผู้คุมไม่อยากแตะ CHECK**: ใช้ event เดิมที่อนุญาตอยู่ (`deposit_approved`) เป็น carrier แล้วแยกด้วย `recipient_type` · **นี่เป็นจุดที่ต้องให้ผู้คุมตัดสิน**
6. **ใหม่** ตัวสร้างสรุปรายวัน 09:00/17:00 — เสนอ `local_service.enqueue_daily_slip_summary()` เรียกจาก cron/pg_cron ทุกชั่วโมง แล้วให้ตัวมันเลือกยิงเฉพาะ 02:00Z/10:00Z · แถว `event_type='daily_slip_summary'`, `recipient_type='shop_owner'`, `scheduled_for` = รอบนั้น · `idempotency_key='daily_slip:'||shop_id||':'||date`
7. **ใหม่** ตัวนับ "ค้างรอตัดสินหลังวันนัด" M — ต้องมีสถานะ/ธงจากก้อน 1 (บรีฟ 23 §2 ข้อ 2) · เสนอ `local_service.bk01_shop_pending_decision_counts()` คืน `(waiting_slip int, overdue_undecided int)` · **ก้อน 2 ยังไม่เรียก** (หน้าจอแสดง fail-closed)
8. `get_line_notification_delivery_context` — **ไม่ต้องแก้** ถ้าเลือกใช้ข้อ 4 แยก (แนะนำ) เพราะคอลัมน์อีเมลไม่ควรไหลเข้า context ของ LINE

## 6. สิ่งที่พิสูจน์ไม่ได้ในก้อนนี้

- ไม่มี PostgreSQL บนเครื่องนี้ ⇒ **ไม่มี W-1 harness** และไม่มีการเรียกฟังก์ชัน SQL จริง — ทั้งก้อนนี้ไม่แตะ DB เลย (ตรงกับบรีฟ: ก้อน 2 ส่วนหน้าจอ/อีเมลทำได้ทันที)
- ไม่มี `RESEND_API_KEY` จริง ⇒ ไม่ส่งอีเมลจริง · พิสูจน์ได้แค่ fake transport + payload
- ยังอ้างได้สูงสุด `SOURCE_LEVEL` + BUILD_PASS · ไม่ใช่ "พร้อมใช้จริง"
