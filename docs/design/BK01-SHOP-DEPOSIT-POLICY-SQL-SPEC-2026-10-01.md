# HOUSE-BK01-SHOP-POLICY-APP — สเปก SQL สำหรับ Codex (บรีฟ 26 ก้อน 8)

**สถานะ: สเปกเท่านั้น — ไม่ใช่ migration** · งานฝั่งแอปของ Hermes ไม่เขียน/แตะ `supabase/**` เลย
ผู้เขียนสเปก: Hermes (session HOUSE-BK01-SHOP-POLICY-APP) · ผู้คุม Claude dd7e55e1 · 2026-10-01
ฐาน: `codex/bk01-shop-policy-20261001` @ `0a0d5aab5b09c19e9020b54379f00972c9c9036c` (= tip ที่ผ่านรีวิวของก้อน 5)
**ให้ Codex เขียน migration จากสเปกนี้** (ลำดับถัดจากก้อน 5/6/7 ตามที่ผู้คุมรวมเลขให้)

กติกาที่สเปกนี้ยึด (บรีฟ 26 §3 + บรีฟ 23 §5c + คำตัดสินผู้คุม 2026-10-01):
- **ห้ามแก้ `local_service.update_shop_settings`** (ลายเซ็น 9 พารามิเตอร์ถูกล็อกแล้ว) — เพิ่มฟังก์ชันใหม่เท่านั้น
- **allowlist ของ `bk01_runtime` เพิ่มได้ 19→20 เท่านั้น** และเฉพาะ RPC อีเมลร้านแบบ claim ของก้อน 7 · งานนี้ต้องไม่เพิ่มชื่อ
  ⇒ `update_shop_deposit_policy` เป็น RPC ของ `authenticated` เท่านั้น (ไม่ grant ให้ `bk01_runtime`) ⇒ allowlist คงเดิม
- owner/admin เท่านั้น · staff และผู้ใช้ที่ล็อกอินร้านอื่นถูกปฏิเสธ · ไม่ NULL-bypass · audit event เมื่อแก้
- ไม่แตะ LAB/production · ไม่แตะราคา/`is_publicly_sellable`

---

## 1. คอลัมน์เก็บข้อความ 2 ภาษา (ตาราง `local_service.shops`)

**ทำไมบน `shops`:** ข้อความนี้เป็นของคุณสมบัติของร้าน 1 แถวต่อ 1 ร้าน และต้องอ่านได้ผ่าน `shop_public_profile` ที่มีอยู่แล้ว
(ตาม RLS ปัจจุบัน) ⇒ ไม่ต้องสร้างตารางใหม่ ไม่ต้องเพิ่ม policy ⇒ พื้นผิวสิทธิ์ใหม่ = 0

```sql
ALTER TABLE local_service.shops
  ADD COLUMN IF NOT EXISTS deposit_policy_th text,
  ADD COLUMN IF NOT EXISTS deposit_policy_en text;
```

- `NULL` = ร้านยังไม่ได้ระบุ (แอปแสดงข้อความกลาง "ร้านยังไม่ได้ระบุเงื่อนไข…")
- `''` = ร้านล้างข้อความเอง (แอปตีความเป็น "ยังไม่ได้ระบุ" เช่นกัน — ดู §5)
- **สาธารณะโดยเจตนา** (บรีฟ 26 §3): อ่านได้ทุกคนที่เห็นหน้าร้าน · **ห้ามเก็บข้อมูลส่วนตัวในคอลัมน์นี้**
  (อีเมล/เบอร์/ชื่อลูกค้า/ข้อมูลภายในร้าน) — ข้อจำกัดนี้ต้องเขียนเป็น `COMMENT ON COLUMN` เพื่อให้คนถัดไปเห็น

**ไม่ต้องเพิ่ม CHECK constraint ที่ตาราง** สำหรับความยาว: ข้อความยาวเกินที่ค้างในฐานะข้อมูลเก่าต้องไม่ทำให้การอ่านหน้าร้านพัง
และ RPC (§2) เป็นด่านบังคับ (ถ้าผู้คุมต้องการ CHECK ที่ตาราง เพิ่มได้ แต่ต้องยอมรับว่าแถวเก่าที่เกินจะทำให้ ALTER ล้ม
⇒ สเปกนี้เลือกไม่เพิ่ม และให้ RPC เป็นด่านเดียว)

## 2. RPC `local_service.update_shop_deposit_policy` (ใหม่)

```sql
CREATE FUNCTION local_service.update_shop_deposit_policy(
    p_shop_id uuid,
    p_deposit_policy_th text,
    p_deposit_policy_en text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
DECLARE
    v_role text;
BEGIN
    -- 1) ต้องล็อกอินและมีบทบาท owner/admin ของร้าน "นั้น" เท่านั้น
    --    (staff ถูกปฏิเสธ · ผู้ใช้ร้านอื่นถูกปฏิเสธ · ไม่มี auth = ปฏิเสธ)
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication required';
    END IF;

    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner','admin']::text[]) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Owner or admin role required';
    END IF;

    -- 2) ไม่ NULL-bypass: ค่าที่ไม่ระบุต้องส่ง '' มา ไม่ใช่ NULL
    IF p_deposit_policy_th IS NULL OR p_deposit_policy_en IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit policy text must not be null; send an empty string to clear';
    END IF;

    -- 3) ตรวจความยาว (code points) — เพดานเดียวกับฝั่งแอป = 1500
    IF char_length(p_deposit_policy_th) > 1500 OR char_length(p_deposit_policy_en) > 1500 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit policy text must be at most 1500 characters per language';
    END IF;

    -- 4) เก็บเป็น '' เมื่อว่าง (ตัดช่องว่างหัวท้าย) — สถานะ "ยังไม่ระบุ" คือ '' หรือ NULL เท่านั้น
    UPDATE local_service.shops
       SET deposit_policy_th = NULLIF(BTRIM(p_deposit_policy_th), ''),
           deposit_policy_en = NULLIF(BTRIM(p_deposit_policy_en), ''),
           updated_at = NOW()
     WHERE id = p_shop_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop not found';
    END IF;

    -- 5) audit event ทุกครั้งที่แก้ (actor = ผู้ใช้จริง · ไม่บันทึกข้อความเต็ม)
    INSERT INTO local_service.audit_events(shop_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    VALUES (p_shop_id, local_service_internal.request_user_id(), 'merchant', 'shop_deposit_policy_updated',
            'shop', p_shop_id,
            jsonb_build_object(
              'th_chars', char_length(BTRIM(p_deposit_policy_th)),
              'en_chars', char_length(BTRIM(p_deposit_policy_en)),
              'th_cleared', NULLIF(BTRIM(p_deposit_policy_th), '') IS NULL,
              'en_cleared', NULLIF(BTRIM(p_deposit_policy_en), '') IS NULL
            ));
END;
$function$;

REVOKE ALL ON FUNCTION local_service.update_shop_deposit_policy(uuid,text,text) FROM PUBLIC, anon, service_role, bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.update_shop_deposit_policy(uuid,text,text) TO authenticated;
```

**จุดที่ผู้รีวิวต้องตรวจเป็นพิเศษ**
1. **`has_shop_role` (ไม่ใช่ `is_shop_owner`)** — บรีฟให้ owner/admin แก้ได้ (ต่างจาก PromptPay/LINE ที่ owner เท่านั้น)
   `has_shop_role` เป็น `SECURITY DEFINER` ของร้านเป้าหมายอยู่แล้ว ⇒ ผู้ใช้ที่ล็อกอินร้านอื่นได้ `42501`
   (ต้องมี test เรียกจริงด้วย role/ผู้ใช้ปลอมแบบเดียวกับที่พิสูจน์ `update_shop_settings`)
2. **REVOKE ... FROM PUBLIC** บังคับ (F-6 ใน `scripts/lib/bk01-migration-policy.mjs`) และต้องมี REVOKE จาก `bk01_runtime` ด้วย
   เพื่อไม่ให้พื้นผิวสิทธิ์ของ runtime ขยาย (allowlist ยัง 19/20 เท่าเดิม)
3. **`local_service_internal.request_user_id()`** คือผู้ช่วยที่ bootstrap สร้าง (`supabase/shared-runtime/…`) — ใช้แทน `auth.uid()`
   ตาม A11b (ห้ามอ้าง `auth.` schema) และ policy checker ปฏิเสธ `auth.uid()` ที่ไม่ได้ประกาศ
4. **ไม่แตะ `update_shop_settings`** เด็ดขาด — ถ้าต้องการให้แอปบันทึกรวมในปุ่มเดียว ให้เป็นเรื่องของ release checklist (9 args) ไม่ใช่ไฟล์นี้
5. **audit metadata ไม่เก็บข้อความเต็ม** — เก็บเฉพาะความยาว + ธงว่าล้าง · ข้อความอยู่ในคอลัมน์สาธารณะอยู่แล้ว
   (ถ้าผู้คุมต้องการเก็บข้อความเดิมด้วย ให้เพิ่ม — แต่สเปกนี้เลือกไม่เก็บ เพื่อไม่ทำสำเนาข้อความในตาราง audit)

## 3. มุมมองสาธารณะ `shop_public_profile` — เพิ่ม 2 คอลัมน์

หน้าจองลูกค้าอ่านร้านผ่าน `local_service.shop_public_profile` (ไม่ใช่ `shops` ตรง ๆ) ⇒ ต้องเพิ่มคอลัมน์ที่นั่น

```sql
CREATE OR REPLACE VIEW local_service.shop_public_profile AS
SELECT
    s.id, s.name, s.slug, s.phone, s.address, s.line_oa_id,
    s.promptpay_number, s.promptpay_name, s.require_deposit, s.default_deposit_amount,
    s.deposit_policy_th,          -- ใหม่ (บรีฟ 26): สาธารณะโดยเจตนา
    s.deposit_policy_en,          -- ใหม่
    /* …CASE เดิมของ is_accepting_online_bookings ต้องคัดลอกมาทั้งก้อนตามไบต์… */
FROM local_service.shops AS s
LEFT JOIN local_service.subscriptions AS sub ON sub.shop_id = s.id
WHERE s.is_active = true;
```

> **สำคัญ:** ต้อง `CREATE OR REPLACE VIEW` ด้วยนิยาม **ปัจจุบันทั้งก้อน** (จาก
> `supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql:854+`) แล้ว **แทรก 2 คอลัมน์** — ห้ามพิมพ์ CASE ใหม่จากความจำ
> (บทเรียน: view นี้เป็น security_invoker=false โดยเจตนา และมี CASE ที่อ้าง `bk01_shop_effective_plan` / `bk01_bookings_used_in_month`)
> และ **ห้าม REVOKE/GRANT ของ view เปลี่ยน** — คง `GRANT SELECT … TO anon, authenticated` เดิม
> rollback คู่ต้องคืน view นิยามเดิม (ไม่มี 2 คอลัมน์) + drop 2 คอลัมน์ + drop ฟังก์ชัน

## 4. RLS / สิทธิ์การอ่าน — เหตุผลที่ไม่ต้องมี policy ใหม่

- `shop_public_profile` มี `GRANT SELECT TO anon, authenticated` อยู่แล้ว ⇒ ลูกค้าที่ไม่ล็อกอินอ่านได้ (นี่คือเจตนา)
- ฝั่งหลังบ้านอ่าน `shops` โดยตรงผ่าน RLS `"Members view own shop"` (E1) ⇒ เจ้าของ/แอดมินอ่านของตัวเองได้
- **ไม่มีข้อมูลส่วนตัวในสองคอลัมน์นี้** ⇒ ไม่ต้องมี policy ใหม่ และไม่ต้อง FORCE RLS อะไรเพิ่ม
- **⚠️ ต้องตรวจก่อน apply:** `shop_public_profile` ถูกอ่านด้วย `anon` — ตรวจว่าไม่มีคอลัมน์อื่นหลุดตามมาในรอบเดียวกัน
  (ดูบทเรียน A-21: `shop_notification_contacts` ต้องแยกตารางเพราะ `shops` ถูกอ่านข้ามร้านโดย `authenticated` —
  เคสนี้ปลอดภัยเพราะเป็นข้อความที่ร้านตั้งใจเผยแพร่ต่อสาธารณะ ไม่ใช่ข้อมูลติดต่อ)

## 5. สัญญา SQL↔แอป (ตรงกับที่แอปทำจริง — ห้ามเพี้ยน)

| กรณี | SQL | แอปหน้าจองลูกค้า (`resolveShopDepositPolicy`) | แอปหลังบ้าน (preview/บันทึก) |
|---|---|---|---|
| ข้อความภาษา viewer มี | ส่งค่ามา | `published` → แสดงค่านั้น | preview ภาษานั้น |
| มีแค่ภาษาอื่น | ส่งค่ามา | `fallback` → แสดงอีกภาษา + บรรทัดบอกว่ามาจากภาษาอะไร | preview + บรรทัด fallback |
| `NULL` / `''` ทั้งคู่ | ไม่มีค่า | แสดงข้อความกลาง "ร้านยังไม่ได้ระบุเงื่อนไข ติดต่อร้านก่อนชำระ" | preview = "ยังไม่มีข้อความ" |
| `NULL` ภาษาเดียว | เก็บเป็น `NULL` | อ่านเป็น "ไม่มี" (ไม่ใช่ `null` string) | ช่องว่าง |
| ยาวเกิน 1500 | RPC ปฏิเสธ 22023 | (อ่านได้ แต่แสดงไม่พัง — wrap) | ปุ่มบันทึกถูกปิด + แจ้งความยาว |
| ช่องว่างหัวท้าย | `BTRIM` ทั้งสองด้าน | `trim()` ก่อนตัดสิน fallback | `normalizePolicyText` |

- แอป **ไม่** ส่ง `NULL` ลง RPC เลย (ส่ง `''` เสมอ) ⇒ ผู้รีวิวตรวจได้ว่า NULL-bypass ไม่มีทางมาจากแอป
- แอปอ่าน `null` จาก view เป็น `''` (`?? ''`) ⇒ สถานะ "ยังไม่ระบุ" มีค่าเดียวในฝั่ง UI
- **test ที่ต้องมี (Codex ฝั่ง SQL):** staff → `42501` · ผู้ใช้ร้านอื่น → `42501` · ไม่ล็อกอิน → `42501` ·
  NULL ภาษาใดก็ได้ → `22023` · 1500 ผ่าน · 1501 → `22023` · `''` ทั้งคู่ผ่านและล้างค่า ·
  audit event ถูกสร้าง 1 แถวต่อการแก้ 1 ครั้ง · เรียกด้วย role จริง (`authenticated` + ผู้ใช้จำลอง) ไม่ใช่ service_role

## 6. allowlist `bk01_runtime` — งานนี้ไม่เพิ่มชื่อ

- `update_shop_deposit_policy` grant เฉพาะ `authenticated` ⇒ `BK01_RUNTIME_FUNCTIONS` (11) และ
  `BK01_RUNTIME_EFFECTIVE_FUNCTIONS` (19) **ไม่เปลี่ยน** ⇒ `tests/bk01-trial-line-bind.test.ts` (ปัก `11` / `19`) ไม่ต้องแก้
- ถ้าผู้คุม/Codex เห็นว่าจำเป็นต้องให้ runtime เรียกฟังก์ชันนี้ (ไม่จำเป็น — การอ่านเป็นสาธารณะผ่าน view) ⇒ **หยุดถามผู้คุม**
  ห้ามเพิ่มชื่อเอง (เพดาน 19→20 สงวนให้ RPC อีเมลร้านของก้อน 7)

## 7. Rollback (คู่กับ forward)

ต้องคืนสภาพเดิมครบ:
1. `CREATE OR REPLACE VIEW local_service.shop_public_profile` ด้วยนิยามเดิม (ไม่มี 2 คอลัมน์)
2. `DROP FUNCTION IF EXISTS local_service.update_shop_deposit_policy(uuid,text,text);`
3. `ALTER TABLE local_service.shops DROP COLUMN IF EXISTS deposit_policy_th, DROP COLUMN IF EXISTS deposit_policy_en;`
4. ไม่มี grant/role/ตารางใหม่ให้เก็บกวาด (งานนี้ไม่สร้างอะไรนอกจาก 2 คอลัมน์ + 1 ฟังก์ชัน)

## 8. รายการที่ **ไม่** อยู่ในสเปกนี้ (ตามบรีฟ 26 §4)

- ข้อความกฎหมายกลางของ WSTERA ลงแอป → **รอทนายตรวจ** (Owner/ผู้คุมเปิดงาน)
- ระบบลบสลิป/log อัตโนมัติ 1 ปี (purge) → งานแยก ก่อนใช้ข้อความ "เก็บ 1 ปี" กับลูกค้าจริง
- การรวม `update_shop_settings` ให้รับ 11 พารามิเตอร์ → ไม่ทำ (ลายเซ็นถูก freeze)
- การแจ้งเตือน/อีเมลเมื่อร้านแก้ข้อความ → ไม่มี (audit event พอสำหรับ PDPA/การตรวจสอบ)
