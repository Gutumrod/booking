# สเปก SQL — HOUSE-BK01-REMIND-3H (ก้อน 6) + HOUSE-BK01-PACK-ENTITLE (ก้อน 7)

ผู้เขียนสเปก: Hermes session `HOUSE-BK01-PACK-NOTIFY-APP` · ผู้คุม Claude `dd7e55e1` · 2026-10-01
บรีฟ: `25-BK01-PACK-NOTIFY-GROUP6-7.md` · ข้อเสนอ: `platform/PROPOSAL-BK01-PACKS-NOTIFY-2026-10-01.md` (A-21)
branch ที่สเปกนี้อ้าง: `codex/bk01-pack-notify-20261001` — **สเปกเท่านั้น ไม่มี SQL ถูกเขียนในก้อนนี้**

> **ฉบับแก้ตามรีวิว Codex รอบ 1 (2026-10-01)** — 3 จุดที่กระทบสเปก:
> 1. **ทุกแพ็กใช้ OA กลาง** (A-21) — ฝั่งแอปปิดการใช้ OA ร้านแล้ว (ไม่มี SQL ต้องแก้ · ไม่มี path ส่งจริงที่เลือก OA ร้าน)
> 2. **เพดานต้องถูกส่งมากับ entitlement context** — §7.1b ใหม่: `get_line_notification_delivery_context` ต้องคืน `monthly_push_cap` (แอปไม่มีสำเนาเพดานที่ไหนอีกแล้ว; ไม่มีค่า = `unverified` + แจ้ง OPS)
> 3. **การแจ้ง `OPS_ALERT_EMAIL` ต้องจำกัดครั้ง/วัน** — §7.8 ใหม่: ตาราง + ฟังก์ชัน claim ledger ที่แอปเรียก (และเป็นชื่อที่ 2 ใน allowlist)
> · ฐาน SQL ที่ต้องใช้ต่อ = `0a0d5aab5b09c19e9020b54379f00972c9c9036c` (ก้อน 5 รอบ 2 ผ่านรีวิวแล้ว)

เจ้าของฟังก์ชัน SQL: **Codex (ก้อน 5/7)** · migration ใหม่เท่านั้น · ผู้คุมรวมเลข migration

> สถานะสูงสุดของเอกสารนี้ = SPEC (source-level) · ยังไม่มีใคร apply · ไม่มี W-1 ในก้อนนี้ (เครื่องไม่มี PG)
> ทุกชื่อฟังก์ชัน/คอลัมน์ที่อ้างถึงด้านล่าง **ตรวจจริงจากดิสก์ที่ base `f97642c`** — ไฟล์:บรรทัด ระบุทุกจุด

---

## 0. ของจริงบนดิสก์ที่สเปกนี้อ้างอิง (ตรวจเองแล้ว)

| ของ | ที่อยู่จริง | สภาพ |
|---|---|---|
| CHECK ชนิดเหตุการณ์ | `supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql:300-302` | `event_type IN ('booking_created','booking_rescheduled','deposit_approved','booking_cancelled','reminder_1h','reminder_24h')` — **ไม่มี** `reminder_3h` |
| ตัวสร้างแถวเตือน | `supabase/migrations/20260829105155_…:363-380` (`enqueue_booking_notifications`, trigger `trg_enqueue_booking_notifications`) | สร้าง `reminder_24h` ที่ `NEW.start_timestamptz - interval '24 hours'` |
| ตัวสร้างแถวเตือนตอนเลื่อนนัด | `supabase/migrations/20260829105155_…:561-566` (`customer_reschedule_booking`) | ยกเลิกแถว `reminder_24h` เก่า + สร้างใหม่ที่ `v_start - interval '24 hours'` |
| ตัวกันแถวเลยเวลาเกิด | `supabase/migrations/20260907181500_skip_overdue_line_reminders.sql:5-28` | `suppress_new_overdue_line_reminder()` BEFORE INSERT: ปฏิเสธ `reminder_24h` ที่ `scheduled_for <= now()` |
| claim ที่ยังไม่เทียบเวลานัด | `supabase/migrations/20260829105155_…:317-345` | **B9(ข) แก้แล้วในก้อน 5** (`20261001130000_bk01_sql_consolidate.sql:320-350` ของ branch `codex/bk01-sql-consolidate-20261001`) |
| ตารางสิทธิ์ | `supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql:75-107` | `local_service.entitlement_plans` — `services_limit` มีแล้ว, `INSERT` แถว free/basic_490/pro_990 ที่บรรทัด 245-273 |
| กลไกแผนที่มีผล | `20260926120000_…` (`bk01_effective_plan`, `bk01_shop_limits`) | trial (`basic_490`+`trialing` ที่ยังไม่หมด) → `basic_490` |
| log ที่มีอยู่ (ที่มาของตัวนับ) | `local_service.line_notification_logs` | มี `idempotency_key`, `attempt_count`, `scheduled_for`, `sent_at`, `status`, `recipient_type` |
| RPC ที่แอปเรียกได้ | `scripts/lib/bk01-runtime-allowlist.mjs:7-27` | 11 ตัว · **ชื่อที่ไม่อยู่ในลิสต์นี้แอปเรียกไม่ได้** |
| นโยบาย migration | `scripts/lib/bk01-migration-policy.mjs` + `supabase/bk01-migrations/README.md` | ห้ามแตะ `auth`/`extensions`, ห้าม transaction control, revoke+grant คู่กันทุกฟังก์ชัน |

**ข้อบังคับร่วมที่สเปกนี้ออกแบบตาม:** ทุกฟังก์ชันใหม่ = `SECURITY DEFINER` + `SET search_path = pg_catalog, local_service` +
`REVOKE ALL … FROM PUBLIC, anon, authenticated` แล้ว `GRANT EXECUTE … TO bk01_runtime` (หรือ `service_role` ตามที่ระบุ)
· ห้ามแตะ `auth.users` (นโยบาย `README.md:11-16`) · **ทุกชื่อที่แอปเรียกต้องถูกเพิ่มใน `BK01_RUNTIME_ROUTE_FUNCTIONS` โดยผู้คุมก่อน merge** (§7)

---

# ก้อน 6 — HOUSE-BK01-REMIND-3H (SQL)

เป้าหมาย: **เตือนครั้งเดียวที่ 3 ชม.ก่อนนัด แทน 24 ชม.** · คิวที่ยืนยัน/จองตอนเหลือ <3 ชม. = **ไม่ส่ง** (ห้ามยัดซ้ำกับข้อความยืนยัน) ·
เลื่อนนัด → ยกเลิกแถวเก่า สร้างใหม่ตามเวลาใหม่ · เตือนที่เลยเวลานัด = ไม่ส่ง (**predicate เดียวกับ B9(ข)** — ห้ามสร้างเงื่อนไขใหม่ซ้อน)

### 6.1 CHECK ชนิดเหตุการณ์ — เพิ่ม `reminder_3h`

```sql
ALTER TABLE local_service.line_notification_logs
  DROP CONSTRAINT IF EXISTS line_notification_logs_event_type_check;
ALTER TABLE local_service.line_notification_logs
  ADD CONSTRAINT line_notification_logs_event_type_check
  CHECK (event_type IN ('booking_created','booking_rescheduled','deposit_approved',
                        'deposit_slip_submitted','daily_slip_summary','deposit_slip_decision',
                        'booking_cancelled','reminder_1h','reminder_24h','reminder_3h'));
```

- `reminder_24h` **คงไว้** — มีแถวเก่าในตารางและ rollback ต้องได้ (ตาม §5c-6 ของบรีฟ 23: ขยาย CHECK ให้ชนิดเหตุการณ์ชัด ไม่ใช้ตัวแทน)
- เหตุการณ์เพิ่มของก้อน 7 (`deposit_slip_submitted`, `daily_slip_summary`, `deposit_slip_decision`) ใส่รอบเดียวกับก้อนนี้ได้ถ้าผู้คุมรวมเลข migration เดียวกัน

### 6.2 ตัวสร้างแถวเตือน — 3 ชม. แทน 24 ชม.

`enqueue_booking_notifications()` (ฐานจริงอยู่ที่ `20260829105155_…:363`) — **ก้อน 6 ไม่เขียนเอง** สเปกที่ต้องได้:

```sql
-- ในสาขา: IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed')
-- แทนด้วย:
INSERT INTO local_service.line_notification_logs(
    shop_id, booking_id, event_type, recipient_type, status, idempotency_key, scheduled_for)
VALUES
  (NEW.shop_id, NEW.id, 'booking_created', 'customer', 'pending',
   'confirmation:' || NEW.id::text, now()),
  (NEW.shop_id, NEW.id, 'reminder_3h', 'customer', 'pending',
   'reminder_3h:' || NEW.id::text, NEW.start_timestamptz - interval '3 hours')
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
```

**เงื่อนไข <3 ชม. (ห้ามส่ง ต้องบังคับที่ระดับ SQL ไม่ใช่แค่ฝั่งแอป):** แถว `reminder_3h` ที่เกิดตอนนัดเหลือ < 3 ชม. จะมี `scheduled_for <= now()`
ซึ่ง **ตัวกันที่มีอยู่แล้ว** (`suppress_new_overdue_line_reminder`, `20260907181500_…`) ยังเทียบแค่ `event_type = 'reminder_24h'`

⇒ **ต้องแก้ตัวกันตัวเดิมให้ครอบ `reminder_3h` ด้วย** (ไม่สร้างตัวใหม่):

```sql
CREATE OR REPLACE FUNCTION local_service.suppress_new_overdue_line_reminder()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, local_service AS $$
BEGIN
    IF NEW.event_type IN ('reminder_24h','reminder_3h')
       AND NEW.status = 'pending'
       AND NEW.scheduled_for IS NOT NULL
       AND NEW.scheduled_for <= now() THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END; $$;
```

- นี่คือ "ไม่ยัดซ้ำกับข้อความยืนยัน" ที่บรีฟต้องการ: ยืนยันที่เหลือ <3 ชม. → แถวเตือนไม่ถูกสร้างเลย ไม่ใช่สร้างแล้วข้าม
- **หมายเหตุเจ้าของฟังก์ชัน:** `suppress_new_overdue_line_reminder` อยู่ใน `BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS` (`scripts/lib/bk01-runtime-allowlist.mjs:36`) — grant ไม่เปลี่ยน แก้ได้ตามข้อนี้
- `reminder_24h` คงอยู่ใน predicate เพราะแถวเก่าต้องไม่ถูกสร้างเพิ่มหลังอัปเกรดเช่นกัน

### 6.3 เลื่อนนัด — ยกเลิกแถวเก่า สร้างใหม่ที่ T-3h

`customer_reschedule_booking()` (ฐานจริง `20260829105155_…:561-566`; ก้อน 5 ก็แตะฟังก์ชันนี้ — **ดูข้อชน §8**):

```sql
-- ยกเลิกแถวเตือนเก่า (เดิมกรอง event_type='reminder_24h' เท่านั้น → ต้องครอบของใหม่ด้วย)
UPDATE local_service.line_notification_logs
   SET status='failed', error_message='Superseded by customer reschedule', next_retry_at=NULL
 WHERE booking_id=p_booking_id AND event_type IN ('reminder_24h','reminder_3h') AND status='pending';

-- สร้างใหม่ตามเวลาใหม่
INSERT INTO local_service.line_notification_logs(
    shop_id, booking_id, event_type, recipient_type, status, idempotency_key, scheduled_for)
VALUES (v_booking.shop_id, p_booking_id, 'reminder_3h', 'customer', 'pending',
        'reminder_3h:' || p_booking_id::text || ':' || extract(epoch from v_start)::bigint::text,
        v_start - interval '3 hours')
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
```

- กฎ "ไม่ส่งถ้าเลยเวลานัด" **ไม่ต้องเขียนใหม่** — predicate ของ B9(ข) ใน `claim_due_line_notifications` (ก้อน 5, `20261001130000_…:320-350`) ต้องถูกขยายรายการ event จาก `('reminder_1h','reminder_24h')` เป็น **`('reminder_1h','reminder_24h','reminder_3h')`** ทั้งสองที่ (ตัวเกษียณแถวเลยนัด + เงื่อนไขใน `due`)

```sql
-- ใน claim_due_line_notifications (ก้อน 5 แก้ไว้แล้ว) เปลี่ยนสองจุด:
--   ตัวเกษียณแถว:  l.event_type IN ('reminder_1h','reminder_24h','reminder_3h')
--   เงื่อนไข due:  (l.event_type NOT IN ('reminder_1h','reminder_24h','reminder_3h') OR b.start_timestamptz > now())
```

### 6.4 สิทธิ์การส่ง (ผูกกับก้อน 7)

เตือนส่งเมื่อแพ็กมี `customer_reminder_push = true` — **จริงทุกแพ็ก** (§7.1) · ข้อความ/การประกอบข้อความ = ฝั่งแอป (ทำแล้วในก้อนนี้)

---

# ก้อน 7 — HOUSE-BK01-PACK-ENTITLE (SQL)

### 7.1 คอลัมน์สิทธิ์ใหม่บน `entitlement_plans` (migration ใหม่)

```sql
ALTER TABLE local_service.entitlement_plans
  ADD COLUMN customer_reminder_push        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN customer_slip_decision_push   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN shop_email_slip               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN shop_email_booking            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN monthly_push_cap              INTEGER;

ALTER TABLE local_service.entitlement_plans
  ADD CONSTRAINT entitlement_plans_monthly_push_cap_check
  CHECK (monthly_push_cap IS NULL OR monthly_push_cap >= 0);
```

ค่าที่ต้องได้ (A-21 — **ห้ามแก้ราคา / ห้ามแตะ `is_publicly_sellable` / ห้ามแตะ Pro ราคา**):

| plan_code | `services_limit` | `customer_reminder_push` | `customer_slip_decision_push` | `shop_email_slip` | `shop_email_booking` | `monthly_push_cap` |
|---|---|---|---|---|---|---|
| `free` | **5** (จาก 3) | true | false | false | false | 50 |
| `basic_490` | 50 (เดิม) | true | true | true | false | 600 |
| `pro_990` | 100 (เดิม) | true | true | true | true | 1500 |

```sql
UPDATE local_service.entitlement_plans SET services_limit = 5,
  customer_reminder_push = true, customer_slip_decision_push = false,
  shop_email_slip = false, shop_email_booking = false, monthly_push_cap = 50,
  notes = notes || ' | A-21 2026-10-01: services_limit 3 -> 5; push entitlements + cap 50.'
 WHERE plan_code = 'free';
-- basic_490 / pro_990 ตามตาราง (Pro คง is_publicly_sellable = false)
```

- **ทดลอง = สิทธิ์ Basic ผ่านกลไกที่มีอยู่** — ไม่เพิ่มแถว/คอลัมน์สำหรับ trial; `bk01_effective_plan` แปลง (`basic_490`,`trialing`) → `basic_490` อยู่แล้ว ⇒ ไม่มีงาน SQL เพิ่มสำหรับ trial
- **`services_limit` Free = 5 พร้อมเพดาน `CHECK (services_limit > 0)` เดิม** — ไม่ต้องแก้ constraint
- **หลัง apply แล้ว ต้อง mirror ฝั่งแอปด้วย:** `apps/booking-admin/src/lib/business-type-starter-services.ts` `SIGNUP_PLAN_SERVICES_LIMIT.free_trial` ต้องขยับ 3 → 5 ในงานที่ apply จริง (ก้อนนี้ *ไม่* ขยับ เพื่อไม่ให้หน้าสมัครสัญญาบริการตั้งต้น 5 รายการที่ DB ยังสร้างไม่ครบ) — `tests/ui-truth.test.ts` ปักทั้งสองค่าไว้

### 7.1b **เพดานต้องถูกส่งมากับ entitlement context** (เพิ่มตามรีวิว Codex รอบ 1)

แอปฝั่ง dispatch **ไม่มีสำเนาเพดานที่ไหนอีกแล้ว** (ตัด mirror `monthly_push_cap` ออกจาก `notification-entitlement.ts` ตามคำตัดสินผู้คุม) ⇒ ค่าที่แอปใช้ต้องมาจาก
`get_line_notification_delivery_context` ซึ่งก้อน 5 แก้ไว้แล้ว:

```sql
-- ใน get_line_notification_delivery_context (ก้อน 5 · 0a0d5aa) — เพิ่มคอลัมน์ผลลัพธ์:
--   ep.monthly_push_cap          AS monthly_push_cap
-- โดย ep = local_service.entitlement_plans ของ effective plan ที่ bk01_effective_plan() คืน
-- (LEFT JOIN — แถวที่ยังไม่มีค่าต้องคืน NULL ไม่ใช่ตัดแถว delivery context ทิ้ง)
```

- **`NULL` = ยังไม่รู้ ⇒ แอปส่งต่อ + นับ `unverifiedCapChecks` + แจ้ง `OPS_ALERT_EMAIL` (จำกัดครั้ง/วัน)** — ไม่ระงับ
- เพดานที่ไม่รู้ต้องไม่กลายเป็นเพดาน 0: ถ้า `monthly_push_cap` เป็น `NULL` แล้วแอปตีความเป็น "ครบโควตา" = ปิดเตือนของลูกค้าที่จ่ายเงิน (สิ่งที่คำตัดสินห้าม)
- **ห้ามใส่ตัวเลข 50/600/1,500 ในโค้ด TS ทุกไฟล์** (test สแกนแล้วทั้ง 4 โมดูล + route) — แหล่งความจริง = คอลัมน์นี้เท่านั้น
- **ตัวนับ (`bk01_shop_push_usage`) ยังเป็นชื่อที่ 1 ใน allowlist** (§7.7) และแอปยังไม่เรียกชื่อนั้นในโค้ด (ฉีด resolver) — ไม่เปลี่ยนจากรอบก่อน

### 7.2 ตัวนับ push ต่อร้านต่อเดือน (นับจาก log เดิม — **ไม่สร้างตารางใหม่**)

**ฟังก์ชันที่ต้องเพิ่ม (ชื่อตรงตัวสำหรับ allowlist):**

```sql
CREATE FUNCTION local_service.bk01_shop_push_usage(p_shop_id uuid, p_month date)
RETURNS TABLE(metered_pushes integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, local_service AS $$
    SELECT COALESCE(count(*), 0)::integer
      FROM local_service.line_notification_logs l
     WHERE l.shop_id = p_shop_id
       AND l.recipient_type = 'customer'
       AND l.event_type IN ('reminder_3h','reminder_24h','deposit_rejected','deposit_slip_decision')
       AND l.sent_at IS NOT NULL
       AND date_trunc('month', l.sent_at AT TIME ZONE 'Asia/Bangkok')::date = p_month
$$;
REVOKE ALL ON FUNCTION local_service.bk01_shop_push_usage(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_shop_push_usage(uuid,date) TO bk01_runtime;
```

- **นับเฉพาะ `sent_at IS NOT NULL`** = นับที่ส่งจริง ไม่นับที่ถูกระงับ (สิทธิ์/เพดาน) ⇒ ตัวนับไม่บวมจากความพยายามที่ถูกกันไว้
- **ไม่นับ reply ตอนผูกคิว** — กรอง `recipient_type='customer'` + ชนิดเหตุการณ์ที่ระบุ (ยืนยันตอนผูกคิวเดินทางผ่าน reply ไม่มีแถวในตารางนี้อยู่แล้ว)
- รีเซ็ตวันที่ 1 เวลาไทย = `date_trunc('month', … AT TIME ZONE 'Asia/Bangkok')` ตรงกับ `bk01_month_key` ของก้อนสิทธิ์เดิม (`20260926120000_…`)
- **`STABLE`** เพราะอ่านอย่างเดียว (ตรงกับสไตล์ `get_line_notification_delivery_context`)

**ฝั่งแอป (ทำแล้วในก้อนนี้):** `apps/booking-consumer/src/lib/notification-push-budget.ts` ตัดสินจาก `cap` (จาก `DeliveryContext.monthly_push_cap` — §7.1b) + `used` (จากฟังก์ชันนี้) — ถ้า `used` **หรือ `cap`** อ่านไม่ได้ → `unverified` และ **ส่งต่อ** (ตัวคุมต้นทุนไม่ปิดกั้นสิทธิ์ที่จ่ายมาแล้ว) แล้วรายงานจำนวนในคำตอบ dispatch + แจ้ง `OPS_ALERT_EMAIL` จำกัดครั้ง/วัน (§7.8)

### 7.3 เบรกเกอร์โควตา OA กลาง 80%

**ฝั่งแอป (ทำแล้วในก้อนนี้ — ไม่ต้องมี SQL):** `apps/booking-consumer/src/lib/notification-oa-breaker.ts`
อ่าน `GET https://api.line.me/v2/bot/message/quota` (type/value) + `GET https://api.line.me/v2/bot/message/quota/consumption` (totalUsage)
**ยืนยันชื่อ endpoint จากเอกสารทางการแล้ว** (`developers.line.biz/en/reference/messaging-api` — ตรวจ HTML จริงในรอบนี้, ไม่เดา) · เกิน 80% → ระงับเฉพาะร้าน **effective plan = free** · แจ้ง Owner ผ่าน `OPS_ALERT_EMAIL` · ไม่มี credential → transport ปลอมในเทสต์

**SQL ที่ต้องมี (ถ้าผู้คุมต้องการ breaker ทำงานใน cron โดยไม่พึ่งแอป — ไม่บังคับรอบนี้):**
ไม่เสนอเพิ่มในรอบนี้ เพราะ (ก) ค่าโควตาอยู่ที่ LINE API ไม่ใช่ DB และ (ข) ฝั่งแอปมี transport injection + test ครบแล้ว
**ถ้าผู้คุมต้องการตัวนับสำรองใน DB** ให้ใช้ `bk01_shop_push_usage` รวมทั้งระบบ + เทียบกับค่าใน `entitlement_plans` — **ไม่เสนอสร้างตาราง config ใหม่**

### 7.4 LINE reply ตอนผูกคิว — **มีอยู่แล้ว ไม่ต้อง SQL**

ตรวจจริง: `apps/booking-consumer/src/app/api/line/webhook/route.ts:111-131` ส่ง reply ด้วย `createBookingLinkBoundFlexCard` (replyToken, ฟรี)
- ก้อนนี้เพิ่ม **รหัสคิว + "จะเตือนก่อน 3 ชม." TH/EN** ใน card (`line-flex-templates.ts:230-234`)
- reply ล้ม (replyToken หมดอายุ) → **catch แยก ไม่ล้มการผูกคิว** และ finalize เป็น `processed` (`route.ts`) — พฤติกรรมที่ต้องการ
- SQL ที่เกี่ยวข้อง: `bk01_line_bind_booking_trial` (`20260927130000_bk01_trial_line_bind.sql`) — **ไม่ต้องแก้**

### 7.9 ช่องทางส่ง — ทุกแพ็กใช้ OA กลาง (A-21 · เพิ่มตามรีวิว Codex รอบ 1)

- **ไม่มี SQL ต้องแก้** สำหรับข้อนี้: เป็นการปิด *เส้นทางส่ง* ฝั่งแอป
- ฝั่งแอป: `dispatch/route.ts` ตัดสินช่องทางด้วย `resolveCentralChannel()` เท่านั้น · ลบพารามิเตอร์/ตัวเลือก `resolveMerchant` ออกจากการเรียกจริง (เดิมมี fallback เลือก OA ร้านเมื่อ `subscription_plan` เป็น `basic_490`/`pro_990`)
- **โค้ด OA ร้านคงไว้ใน repo ห้ามลบ:** `lib/merchant-line-config.ts` + ทางเข้า merchant webhook (`app/api/line/webhook/merchant/[shopId]/route.ts`) ยังใช้โมดูลนี้ · `lib/line-channel-config.ts` ยังมี `mode:'paid'` และเทสต์ `tests/line-config.test.ts` ยังปักไว้ (เป็นสัญญาของโมดูล ไม่ใช่ของเส้นทางส่ง)
- **อนาคต (ถ้า Owner เปิด OA ร้าน):** ต้องตัดสินจาก **ความสามารถที่ฐานข้อมูลรายงาน** (คอลัมน์สิทธิ์ช่องทางต่อร้านใน delivery context) — **ห้ามตัดสินจากชื่อแพ็ก** ซึ่งเป็นข้อผิดพลาดที่รีวิวรอบ 1 จับได้
- เทสต์ที่ปักพฤติกรรมใหม่: `tests/house-pack-entitle.test.ts` "EVERY pack sends through the central OA" (ยิงจริง 3 แพ็ก: free/basic/pro → ทุก push ใช้ `Bearer central-token`) + test static ว่าเส้นทางส่งไม่ import/เรียกโมดูล OA ร้าน

### 7.5b สลิป — สถานะ

- Free ไม่มีมัดจำ ⇒ คอลัมน์ false ไม่กระทบเส้นทางนี้ · Basic/ทดลอง true
- **การสร้างแถว `deposit_slip_decision`** เมื่อร้านอนุมัติ/ปฏิเสธ: อยู่ในขอบเขตสเปกก้อน 2 ที่ส่งไปแล้ว (`docs/design/BK01-NOTIFY-DESIGN-2026-10-01.md` §5 ข้อ 5 `enqueue_merchant_slip_notifications` + ข้อ 6)
- **เพิ่มที่สเปกนี้:** สาขา *แจ้งลูกค้า* เมื่อ `deposit_status` เปลี่ยนเป็น `rejected`/อนุมัติ → แถว `event_type='deposit_slip_decision'`, `recipient_type='customer'`, `idempotency_key='slip_decision:'||NEW.id||':'||NEW.deposit_status` · ฝั่งแอปอ่านชนิดนี้ผ่าน `pushEntitlementColumn()` (ทำแล้ว)
- **ข้อควรระวัง:** `enqueue_booking_notifications` trigger แจ้งลูกค้าเมื่อ `status='cancelled'` — การปฏิเสธสลิปที่ทำให้ `cancelled` อาจยิงข้อความ "ยกเลิกคิว" ผิดบริบท (ข้อสังเกต §5c-13(ข) ของบรีฟ 23) ⇒ ต้องกันไม่ให้ยิงข้อความยกเลิกซ้อนกับข้อความตัดสินสลิป

### 7.6 ข้อความ "Free 3 บริการ" → 5

**ไม่ใช่ SQL** — ฝั่งแอปทำแล้วในก้อนนี้ (catalog/หน้าราคา/เอกสาร/test) · DB เปลี่ยนผ่าน §7.1 เท่านั้น

---

## 7.7 รายชื่อฟังก์ชันที่ต้องเพิ่มใน allowlist (ผู้คุมทำ — ไม่ใช่ Codex)

`scripts/lib/bk01-runtime-allowlist.mjs` → `BK01_RUNTIME_ROUTE_FUNCTIONS` **ชื่อตรงตัวเท่านั้น** (2 ชื่อในรอบนี้):

```
local_service.bk01_shop_push_usage(uuid,date)          -- ตัวนับ push ต่อร้านต่อเดือน (§7.2)
local_service.bk01_claim_push_alert_once(text,boolean) -- ledger กันแจ้ง OPS ซ้ำต่อวัน (§7.8)
```

- เพิ่ม **พร้อม migration ที่ grant ให้ `bk01_runtime` จริง** (ไม่เพิ่มก่อน) · และต้องอัปเดต test ที่ปักจำนวน (`tests/bk01-trial-line-bind.test.ts:43-44` ปัก `BK01_RUNTIME_FUNCTIONS.length === 11` และ `EFFECTIVE === 19`) + โพรบ non-vacuity ใน `scripts/check-bk01-migration-policy.mjs:85-95` ให้ตรงกับชุดใหม่
- **ห้าม wildcard / ห้าม grant PUBLIC/anon** (§5c-5)
- **ฝั่งแอปของก้อนนี้ไม่เรียกชื่อทั้งสอง** — `apps/booking-consumer/src/app/api/notifications/dispatch/route.ts` รับตัวนับผ่าน `resolvePushUsage` และ ledger ผ่าน `capAlertSink` ที่ฉีดได้ (ค่าเริ่มต้น = `null` ⇒ `unverified` / ไม่ส่ง alert) ⇒ route ไม่มีชื่อ RPC ที่ยังไม่ถูก grant และ guard test เดิม (`tests/bk01-wuc-routes.test.ts:42-47`) ยังผ่าน
- **ลำดับการเปิดใช้:** ledger (§7.8) ต้อง apply + allowlist ก่อน ไม่งั้นแอปจะ **ไม่แจ้ง OPS เลย** (fail-closed — เขียนไว้ชัดว่าเป็นพฤติกรรมที่ตั้งใจ ไม่ใช่ความล้มเหลว) · ตัวนับเป็นตัวเปิดใช้ "เพดานมีผลจริง"

## 7.8 ledger กันแจ้ง `OPS_ALERT_EMAIL` ซ้ำต่อวัน (เพิ่มตามรีวิว Codex รอบ 1)

คำตัดสินผู้คุม: แจ้งทั้ง **ตอนเบรกเกอร์เปิด** และ **ตอนเพดาน/ตัวนับอ่านไม่ได้** — *จำกัดครั้ง/วัน*

```sql
-- ตาราง ledger (product-local) — ไม่ผูกกับ auth, ไม่เก็บ PII
CREATE TABLE local_service.notification_alert_ledger (
  alert_key     text        PRIMARY KEY,   -- '<kind>:<scope>:<YYYY-MM-DD>' (Thai day)
  first_raised_at timestamptz NOT NULL DEFAULT now(),
  delivered     boolean     NOT NULL DEFAULT false
);

-- ฟังก์ชัน claim: คืน true = เพิ่งเปิดวันนี้ (ส่งได้) · false = แจ้งไปแล้ววันนี้
CREATE FUNCTION local_service.bk01_claim_push_alert_once(p_alert_key text, p_delivered boolean)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, local_service AS $$
  INSERT INTO local_service.notification_alert_ledger(alert_key, delivered)
  VALUES (p_alert_key, p_delivered)
  ON CONFLICT (alert_key)
    -- เดือนที่ส่งไม่สำเร็จ: เปิดให้ลองใหม่ได้ระหว่างวัน · ที่ส่งแล้ว: ล็อกทั้งวัน
    DO UPDATE SET delivered = local_service.notification_alert_ledger.delivered OR EXCLUDED.delivered
  RETURNING (xmax = 0 OR NOT local_service.notification_alert_ledger.delivered)
$$;
REVOKE ALL ON FUNCTION local_service.bk01_claim_push_alert_once(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_claim_push_alert_once(text,boolean) TO bk01_runtime;
```

- **คีย์มาจากแอป** (ผ่าน `pushAlertDedupeKey()` ใน `notification-oa-breaker.ts`):
  `push_cap_unverified:<shop_id>:<yyyy-mm-dd>` และ `oa_breaker_open:<yyyy-mm-dd>` (วันไทย +07:00)
- **`p_delivered` = ความหมายของ "ส่งได้/ไม่ส่ง":** แอปส่ง `false` ตอนแจ้งเพดาน (ยังยืนยันการส่งไม่ได้ในจุดนั้น ถ้าส่งไม่สำเร็จต้องลองใหม่ได้ในวันเดียวกัน) และ `true` ตอนแจ้งเบรกเกอร์เปิด (อ่านค่าสำเร็จแล้ว = ข้อเท็จจริงของ OA ไม่ต้องยิงซ้ำ)
- **ยังไม่มีฟังก์ชันนี้ → แอปไม่ส่ง alert** และคืน `sent:false` (fail-closed) · ไม่มี fallback ไป LINE/Telegram/ช่องทางอื่น
- ควรมีตัวล้าง ledger เก่า (เช่น > 90 วัน) ในงานบำรุง — ไม่จำเป็นต่อฟังก์ชันการทำงานรอบนี้

## 8. จุดที่ชนกับก้อน 5 — ผู้คุมรวมเลข

| ฟังก์ชัน | ก้อน 5 (`20261001130000_bk01_sql_consolidate.sql`) | ก้อน 6 ต้องแก้เพิ่ม |
|---|---|---|
| `claim_due_line_notifications` | แก้แล้ว (เกษียณแถวเลยนัด + เงื่อนไข due) — บรรทัด 320-350 | เปลี่ยน 2 รายการ event ให้ครอบ `reminder_3h` (§6.3) |
| `enqueue_booking_notifications` | ไม่แตะ | เปลี่ยน 24h → 3h + idempotency key (§6.2) |
| `suppress_new_overdue_line_reminder` | ไม่แตะ | เพิ่ม `reminder_3h` เข้า predicate (§6.2) |
| `customer_reschedule_booking` | แก้ (`20261001130000_…:134`) | เปลี่ยน event list 24h → 24h+3h และเวลาใหม่ (§6.3) |
| `entitlement_plans` | ไม่แตะ | เพิ่ม 5 คอลัมน์ + ค่า (§7.1) |
| `reject_deposit_slip` / `approve_booking_deposit` | แก้ (`:65`, `:95`) | พิจารณาสาขาแจ้งลูกค้า (§7.5) |

**เจ้าของ:** ก้อน 5/7 = Codex · ห้าม Hermes เขียนไฟล์ `supabase/**` เอง (ก้อนนี้ไม่แตะเลย)

## 9. สิ่งที่ยังพิสูจน์ไม่ได้ (ต้องบอกตรง)

- ไม่มี PostgreSQL บนเครื่องนี้ ⇒ **ไม่มี W-1** · ไม่มีการเรียกฟังก์ชัน SQL จริง · ทั้งก้อนนี้ไม่แตะ DB
- ไม่มี credential LINE จริง ⇒ breaker/quota พิสูจน์ได้แค่ fake transport + ชื่อ endpoint ที่ตรวจจากเอกสารทางการ
- ไม่มีคีย์ Resend จริง (สืบเนื่องจากก้อน 2) ⇒ ไม่ส่งอีเมลจริง
- `bk01_shop_push_usage` และ `customer_slip_decision_push` ในเส้นทาง DB → **ยังไม่มีผลจริงจน migration นี้ถูก apply + allowlist ถูกเพิ่ม**
- **`monthly_push_cap` ยังไม่ถูกส่งมากับ delivery context จนกว่าก้อน 5 จะถูกแก้ (§7.1b)** ⇒ ตอนนี้แอปจะได้ `unverified` ทุกครั้ง (ส่งต่อ + รายงาน + แจ้ง OPS ถ้ามี ledger) — เป็นพฤติกรรมที่ตั้งใจ ไม่ใช่ความล้มเหลว
- **การแจ้ง OPS จำกัดครั้ง/วัน ยังไม่ทำงานจริงจนกว่า ledger (§7.8) + allowlist จะถูกเพิ่ม** ⇒ ตอนนี้ `sendOpsAlert` ถูกเรียกในเส้นทางจริงด้วย sink = `null` จึง **ไม่ส่งอีเมลเลย** (fail-closed) — เทสต์พิสูจน์เส้นทาง/การจำกัดครั้ง/วันด้วย sink ปลอมเท่านั้น
- **ไม่มี credential/transport อีเมลจริงในโค้ดก้อนนี้** (ยังไม่มี adapter อีเมลใน repo — §7.8 เป็นสเปก) ⇒ `OPS_ALERT_EMAIL` ถูกพิสูจน์ถึงระดับ "เรียกถูกที่ + ไม่มีออกนอกช่องทาง" เท่านั้น
- สถานะสูงสุด = **SOURCE_LEVEL / BUILD_PASS** ไม่ใช่ "พร้อมใช้จริง"
