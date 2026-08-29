# BRIEF — BK-A Continuation 01: Security + DB Static Review

**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `feature/bk-a-v1-contract-remediation`
**Starting checkpoint:** `e2420b8`
**Purpose:** ตรวจและแก้เฉพาะส่วน security / tenancy / migration ที่ Codex ทำค้างไว้ โดยไม่เริ่ม BK-A ใหม่

## Start rules
- ต้องอยู่บน branch และ SHA ข้างต้น หรือเป็นลูกหลานของ SHA นี้
- ห้าม reset / checkout / clean / stash งานเดิม
- `.claude/settings.local.json` local-only ห้าม add/commit
- ห้าม push / merge / deploy / apply migration ไป remote
- อ่าน `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md` ก่อน

## Scope เท่านั้น
ตรวจ BK-A1, A2, A7 engineering boundary และ A12:
- private deposit slip + signed/authorized reads
- auth-user → staff mapping + staff self-scope
- auto-slip fail-safe boundary; ห้ามเลือก provider/ราคาแทน owner
- owner/admin ticket scope + platform-admin audit
- migration/RLS/RPC/storage policies ที่เกี่ยวข้อง

## สิ่งที่ต้องตรวจ
- tenant/shop ID ทุก mutation/read ถูก verify ฝั่ง DB/server
- missing/foreign staff mapping ต้อง fail closed
- staff ห้าม shop-wide customer/ticket access
- slip object reference ปลอม/ข้ามร้านต้องใช้ไม่ได้
- privileged RPC/action ต้อง deny non-admin และมี audit
- SECURITY DEFINER ต้องตรวจ role/tenant ภายในและใช้ safe `search_path`
- grants/execute permissions ต้องไม่เปิดกว้างเกิน contract
- auto-slip timeout/unknown/error ห้าม auto-confirm

## Testing ในรอบนี้
รัน targeted tests ที่มีอยู่สำหรับ scope นี้ แล้วรัน:
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`

ถ้า local PostgreSQL/Supabase ไม่มีอยู่แล้ว:
- **ห้ามเสียเวลาติดตั้ง/เปิด Docker ในรอบนี้**
- อย่าพยายามทำ G2 ให้ PASS ปลอม ๆ
- ตรวจ SQL/RLS แบบ static ให้ละเอียด และบันทึก `BLOCKED_ENVIRONMENT` สำหรับ DB runtime tests

แก้ whitespace/new-blank-line ที่ `git diff --check` ฟ้องด้วย

## Evidence + stop
อัปเดต `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md` เพิ่มหัวข้อ `Continuation 01` พร้อมไฟล์ที่แก้, tests และสิ่งที่ยัง blocked

อนุญาต local commit หลัง tests ผ่าน โดยใช้ message เช่น:
`fix(booking): harden BK-A security boundaries`

จากนั้น STOP และรายงาน:
- final local SHA
- tests PASS/FAIL/BLOCKED
- P0/P1 ที่พบและแก้
- DB runtime gates ที่ยังไม่ได้พิสูจน์

ห้ามไปทำ scope ของ Continuation 02 เอง
