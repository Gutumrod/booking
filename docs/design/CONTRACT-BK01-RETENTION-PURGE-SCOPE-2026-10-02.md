# สัญญาสั้น — BK01 retention / purge scope (ขอให้ Codex ทำ SQL)

**จาก:** Qwen Code (ผู้ตรวจอิสระ, กอง 2) · **ถึง:** Codex (ผู้ถือ SQL scope)
**วันที่:** 2026-10-02 · **ที่มา:** G33 + ครึ่งหลังของ G36 (`COUNCIL-MASTER-ALL-ANSWERS-2026-10-01.md` ส่วน 2)
**สถานะ:** ข้อเสนอ ยังไม่ได้รับการอนุมัติ — ต้องการผู้อนุมัติ live window ก่อน apply

---

## 1. บริบท (อ่านสั้น ๆ)

- **G36 (ครึ่งแรก) แก้แล้วฝั่งแอป** — rate limit ที่ `/api/deposit-slips/upload-intent`
  (`apps/booking-consumer/src/lib/deposit-slip-upload-intent.ts`) พร้อมเทสต์ที่พิสูจน์ว่าไม่ vacuous
  ไม่ต้อง SQL สำหรับครึ่งนี้
- **G36 (ครึ่งหลัง) และ G33 ต้องการ SQL/storage scope ใหม่** — ไฟล์สลิปที่อัปโหลดแล้วไม่ถูก
  `submit_deposit_slip` จะไม่ถูกอ้างถึงเลย และไม่มีกลไกเก็บกวาดหรือลบตามอายุ
- **ผู้เขียนสัญญานี้ไม่เขียน SQL** ตามกติกาของงาน — เอกสารนี้ระบุ *สิ่งที่ต้องมี* และ
  *ข้อห้าม* ให้ Codex ออกแบบ SQL เอง

ความจริงที่ตรวจแล้ว (อ้างอิงได้):
- `local_service.deposit_slip_upload_grants` (`supabase/bk01-migrations/20260927120000_bk01_runtime_route_rpcs.sql:20-33`)
  มี `object_path` UNIQUE + `expires_at`; ไม่มี index บน `expires_at` และไม่มีผู้เก็บกวาดแถวที่หมดอายุ
- `local_service.authorize_deposit_slip_upload` (:157-196) INSERT แถวใหม่ทุกครั้งที่สำเร็จ
  และไม่เคยลบแถวเดิม; grant ที่หมดอายุจึงค้างเป็นขยะในตารางต่อไป
- `submit_deposit_slip` ตั้ง `bookings.slip_url` เป็น object path นั้น — **แถวนี้คือร่องรอยเดียว**
  ที่บอกว่าวัตถุใดถูกใช้งานจริง
- Bucket `deposit-slips` เป็น private, `file_size_limit = 5242880`, MIME jpeg/png/webp
  (`supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql:8-14`)
- House grant ของวัตถุอยู่ใน `wstera_platform_internal.storage_upload_grants` (House-owned;
  BK01 เขียนเองไม่ได้) — ดู `docs/platform/shared-runtime/storage/README-BK01-UPLOAD-GRANT-FOLLOWUP.md`
- `bk01_runtime` มี allowlist แบบ exact (11 RPC + 8 legacy PUBLIC exceptions) ตรวจโดย
  `scripts/lib/bk01-runtime-allowlist.mjs` — การเพิ่ม RPC ต้องแก้ allowlist ด้วย ไม่ใช่แค่ SQL

---

## 2. ข้อเสนอเป็นคำขอ (3 ข้อ — Owner/House เลือกได้ว่าจะเอาข้อไหน)

### R1 — เก็บกวาด grant ที่หมดอายุ (ราคาถูกสุด, ความเสี่ยงต่ำ)

**ต้องการ:** กลไกที่ลบแถว `local_service.deposit_slip_upload_grants` ที่ `expires_at < now() - grace`
**ทำไม:** แถวที่หมดอายุแล้วไม่ถูกใช้ตัดสินใจอะไรอีก (การ consume เป็น one-shot ที่ House trigger)
การค้างไว้ทำให้ตารางโตแบบไม่มีเพดานตามจำนวนการยิงที่ G36 ตรวจพบ
**ข้อห้ามที่ต้องคงไว้:**
- ห้ามลบแถวที่ `expires_at > now()` — นั่นคือ upload ที่ลูกค้ายังทำค้างอยู่
- ห้ามลบแถวที่ `object_path` ตรงกับ `bookings.slip_url` ใด ๆ (หลักฐาน) แม้จะหมดอายุแล้ว
- ต้องเพิ่ม index ให้ query นี้ไม่กลายเป็น sequential scan บนตารางที่โต
**คำถามที่ต้องให้ Codex ตัดสิน (พร้อมเหตุผล):** ควรเป็น SECURITY DEFINER RPC ที่เรียกจาก job/
scheduler หรือเป็น House-owned job? ใครถือ EXECUTE? ถ้าเพิ่ม RPC ต้องเพิ่มใน allowlist — คุ้มไหม
เทียบกับให้ House เก็บกวาดเอง

### R2 — เก็บกวาดวัตถุใน storage ที่ไม่มีใครอ้าง (ราคากลาง, ต้องตัดสินให้ชัด)

**ต้องการ:** รายการ (ไม่ใช่การลบอัตโนมัติ) ของวัตถุใน `deposit-slips` ที่
(ก) ตรงรูปแบบ path `<booking_uuid>/<grant_uuid>.<ext>`
(ข) `created_at` เก่ากว่าเกณฑ์
(ค) ไม่ตรงกับ `bookings.slip_url` ใด ๆ
(ง) ไม่มี grant ที่ยังไม่หมดอายุชี้มาที่ path นั้น
**ทำไม:** สคริปต์ฝั่งแอป (`scripts/cleanup-stale-deposit-slips.mjs`) ทำได้แล้ววันนี้ในโหมด
dry-run ผ่าน Storage HTTP API แต่ต้องพึ่ง operator ดึงข้อเท็จจริงเองและถือ service key —
การมี read surface ที่ปลอดภัยกว่านี้จะลดความเสี่ยง operator
**ข้อห้ามที่ต้องคงไว้:**
- **ห้ามลบวัตถุที่ `bookings.slip_url` อ้างถึงทุกกรณี** ไม่ว่าการจองจะเก่าหรือปิดแล้ว
- ห้ามลบวัตถุที่อ่าน `created_at` ไม่ได้
- ห้ามลบวัตถุที่ยังมี grant ไม่หมดอายุ
**คำถามที่ต้องให้ Codex ตัดสิน:** ควรมี read-only RPC/view ที่คืน *รายการ* ให้ operator ตรวจ
(และ operator เป็นคนลบผ่าน Storage API ที่มีอยู่) แทนที่จะให้ SQL สั่งลบเองหรือไม่ — ผู้เขียน
เอนไปทาง read-only เพราะลดความเสียหายถ้าเกณฑ์ผิด แต่เป็นคำตัดสินของ Codex/House

### R3 — anonymize สำหรับคำขอลบของลูกค้า (ราคาแพงสุด, ต้องมีก่อนเปิดขายถ้าจะสัญญา PDPA)

**ต้องการ:** ความสามารถทำให้ข้อมูลระบุตัวตนของลูกค้าไม่ระบุตัวได้ โดยไม่ทำลายความสมบูรณ์ของ
การอ้างอิง (foreign key) และไม่ลบหลักฐานที่กฎหมายบังคับให้เก็บ
**ทำไม:** `request_account_closure` (migration :604) เป็นเพียงการ INSERT คำขอ —
ไม่มีกลไกทำตามคำขอ (G33, LANE F-14)
**ข้อห้ามที่ต้องคงไว้:**
- ห้ามลบแถว `bookings` ที่มีหลักฐานการชำระเงินโดยไม่พิจารณาภาระทางบัญชีก่อน
- ต้องไม่ทำให้ `bookings.slip_url` ชี้ไฟล์ที่หายไป
- ต้องมีบันทึก audit ของการ anonymize ทุกครั้ง
**คำถามที่ต้องให้ Codex ตัดสิน:** field ใดนับเป็น "ข้อมูลระบุตัวตน" ในสคีมาปัจจุบัน (`customers`,
`line_users`, `bookings.notes`?) — ผู้เขียนไม่ตัดสินแทน เพราะกระทบสัญญาและ PDPA

---

## 3. สิ่งที่ผู้เขียน "ไม่" ขอ (เพื่อไม่ให้ขอบเขตบาน)

- ไม่ขอให้แก้ RLS/policy ที่มีอยู่
- ไม่ขอให้เปลี่ยนโครง `deposit_slip_upload_grants` หรือ return shape ของ
  `authorize_deposit_slip_upload`
- ไม่ขอเพิ่ม dependency ฝั่งแอป
- ไม่ขอให้แตะ House SQL (`wstera_platform_internal.*`) เว้นแต่ House อนุมัติเอง

---

## 4. หลักฐานที่ผู้เขียนมีอยู่ ให้ Codex ต่อยอด

- เทสต์ฝั่งแอปสองชุด (GREEN แล้ว): `tests/g36-upload-intent-abuse.test.ts` (6 เคส),
  `tests/g36-deposit-slip-cleanup.test.ts` (11 เคส)
- ตัว planner ที่พิสูจน์แล้วว่าไม่ vacuous ด้วย mutation harness 6 mutations (caught 6/6):
  `scripts/lib/deposit-slip-retention.mjs`
- สคริปต์ dry-run: `scripts/cleanup-stale-deposit-slips.mjs` (dry-run เป็นค่าเริ่มต้น,
  ต้องมี `--min-age-hours` เสมอ ไม่มี default)
- `npm test` = 477/477 PASS บน worktree `bk01-g2-qwen-20261002` @ `9f452d4`+งานนี้

**หลักการที่ต้องคงไว้ในทุกข้อ:** เกณฑ์ที่ผิดต้องนำไปสู่ "เก็บ" ไม่ใช่ "ลบ"
(ทุกกรณีที่อ่านข้อมูลไม่ได้ → ไม่ลบ) และทุกการลบต้องมีบันทึกที่ตรวจสอบย้อนหลังได้

---

## 5. สิ่งที่ผู้เขียนไม่รู้ (ระบุตรง ๆ)

- ไม่ได้รัน SQL ใด ๆ กับฐานจริง — ข้อ R1–R3 เป็นข้อเสนอจาการอ่าน source เท่านั้น
- ไม่ทราบว่ามี House-side scheduler/retention อยู่แล้วหรือไม่ (House-owned schema
  `wstera_platform_internal` อยู่นอกขอบเขตที่ผู้เขียนตรวจ)
- ไม่ทราบนโยบายอายุของ Owner (ยังไม่ตัดสิน) — ตัวเลขทุกตัวในคู่มือ/สคริปต์จึงต้องมาจาก Owner
