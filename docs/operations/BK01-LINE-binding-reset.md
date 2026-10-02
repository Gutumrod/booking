# BK01: รีเซ็ตการผูก LINE ด้วยมือ

ใช้เมื่อร้านยืนยันว่าลูกค้าต้องเปลี่ยนบัญชี LINE และทางกู้คืนอัตโนมัติปฏิเสธการผูกซ้ำ งานนี้ทำได้โดยผู้ดูแลแพลตฟอร์มที่ได้รับมอบหมายเท่านั้น; ไม่มี RPC สำหรับ reset

## ผู้ร้องและตรวจตัวตน

1. เจ้าของร้านส่งคำขอผ่านช่องทางซัพพอร์ตที่ลงทะเบียน ระบุ `shop_id`, `customer_id`, เหตุผล และรหัสนัดที่เกี่ยวข้อง ห้ามส่ง LINE channel token/secret
2. เจ้าของร้านยืนยันลูกค้ากับรหัสนัดและช่องทางติดต่อที่มีอยู่แล้ว ห้ามขอเลขบัตรหรือเก็บข้อมูลใหม่เพื่อขั้นตอนนี้ ผู้ดูแลแพลตฟอร์มตรวจว่าร้านกับลูกค้าตรงกันจาก UUID และรหัสนัดก่อนอนุมัติ
3. ผู้ดูแลที่ปฏิบัติงานเข้าสู่ระบบด้วยบัญชีส่วนบุคคล ตรวจ UUID ของบัญชีกับ Supabase Auth และยืนยันว่ามีแถว `local_service.platform_admins.user_id` ตรงกัน ผู้ดูแลคนที่สองตรวจ ticket, shop/customer UUID และ LINE ID เก่าก่อนสั่ง SQL

## คำสั่ง

รันบนฐานข้อมูล local/staging ที่ได้รับอนุมัติโดยใช้ platform operator credential ผ่าน SQL console ที่เชื่อถือได้ แทนค่า UUID/LINE ID ทุกจุดจาก ticket ที่ตรวจแล้ว ห้ามรันกับ LAB หรือ production โดยอาศัย runbook นี้เพียงอย่างเดียว

```sql
BEGIN;
SET LOCAL ROLE bk01_migrator;
SELECT set_config('request.jwt.claim.sub', '<PLATFORM_ADMIN_USER_UUID>', true);

DO $reset$
DECLARE
    v_admin uuid := '<PLATFORM_ADMIN_USER_UUID>';
    v_shop uuid := '<SHOP_UUID>';
    v_customer uuid := '<CUSTOMER_UUID>';
    v_old_line_user_id varchar(100) := '<OLD_LINE_USER_ID>';
    v_rows integer;
BEGIN
    IF local_service_internal.request_user_id() IS DISTINCT FROM v_admin
       OR NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION 'Verified platform admin identity required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM local_service.customers
        WHERE id=v_customer AND shop_id=v_shop AND line_user_id=v_old_line_user_id
    ) THEN
        RAISE EXCEPTION 'Customer LINE binding does not match the approved ticket';
    END IF;

    DELETE FROM local_service.line_users
    WHERE shop_id=v_shop AND customer_id=v_customer AND line_user_id=v_old_line_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Expected exactly one LINE mapping, got %', v_rows; END IF;

    UPDATE local_service.customers SET line_user_id=NULL
    WHERE id=v_customer AND shop_id=v_shop AND line_user_id=v_old_line_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Expected exactly one customer binding, got %', v_rows; END IF;
END;
$reset$;
COMMIT;
```

Any error aborts the transaction; do not retry with broader predicates. Re-check the UUIDs and current mapping, then open a new approved ticket if the recorded values differ.

## ตรวจหลัง reset

Run these read-only queries as the platform operator. Both customer and LINE mapping should be absent, and the audit query should show the same admin UUID on the `line_users` DELETE and `customers` UPDATE with the old LINE ID recorded.

```sql
SELECT id, shop_id, line_user_id
FROM local_service.customers
WHERE id='<CUSTOMER_UUID>' AND shop_id='<SHOP_UUID>';

SELECT id, shop_id, customer_id, line_user_id
FROM local_service.line_users
WHERE shop_id='<SHOP_UUID>' AND customer_id='<CUSTOMER_UUID>';

SELECT changed_at, actor_user_id, actor_session_user, actor_effective_role,
       table_name, operation, shop_id, row_id, customer_id,
       old_line_user_id, new_line_user_id
FROM local_service_internal.line_binding_audit
WHERE shop_id='<SHOP_UUID>' AND customer_id='<CUSTOMER_UUID>'
ORDER BY changed_at DESC
LIMIT 10;
```

The first two queries must return no LINE binding (`customers` returns a row with `line_user_id IS NULL`; `line_users` returns no rows). Confirm the two audit records, link them to the ticket, then ask the shop to have the customer bind again through the normal LINE flow. Do not edit or delete audit rows.
