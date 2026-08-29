# BRIEF — BK-A Continuation 03: Integrated Gates + Independent Review

**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `feature/bk-a-v1-contract-remediation`
**Start from:** latest local commit produced by Continuation 02
**Purpose:** รวมผล BK-A ที่ทำเสร็จแล้ว ตรวจ regression และเปิด independent review โดยไม่พยายามแก้ environment blocker ด้วยการติดตั้งระบบใหม่

## Start rules
- อ่าน `docs/09_TEST_RELEASE_GATES.md`
- อ่าน `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`
- อ่านผล/commit จาก Continuation 01–02
- ห้าม reset / clean / push / merge / deploy
- `.claude/settings.local.json` ห้าม add/commit

## Integrated verification
รันอย่างน้อย:
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- static search ยืนยันว่าไม่มี `promptpay.io` runtime, annual offer, legacy 100/500 paid claim และ unsupported absolute claim บน current V1 surfaces
- ตรวจ changed files ว่าไม่มี secret จริง

ตรวจ traceability/evidence ให้สถานะตรงกับของจริง:
- implementation แล้ว + test ผ่าน = ระบุ evidence ได้
- implementation แล้วแต่ DB/provider runtime ยังไม่พิสูจน์ = ระบุ `IMPLEMENTED / RUNTIME EVIDENCE PENDING`
- ห้ามติ๊ก PASS ให้ gate ที่ยังไม่ได้รันจริง

## Database environment rule
ถ้า local PostgreSQL/Supabase ยังไม่พร้อม ให้บันทึก G2 และ DB-backed portions ของ G3–G9 เป็น `BLOCKED_ENVIRONMENT`
**ห้ามติดตั้งหรือเปิด Docker ในบรีฟนี้** และห้ามใช้ production/remote DB เพื่อชดเชย

## Independent review
เปิด fresh read-only reviewer แยกจากผู้ลงมือทำ ตรวจเฉพาะ implementation ปัจจุบันเทียบ locked BK-0 docs

Reviewer ต้องแยก 2 เรื่องออกจากกัน:
1. code/design defect = ให้ severity P0/P1/P2 ตามจริง
2. environment evidence missing = ระบุ BLOCKED_ENVIRONMENT ไม่ใช่แต่งเป็น code defect

ตรวจอย่างน้อย:
- tenant/staff/storage/privileged authorization
- reschedule atomicity/concurrency design
- deposit/auto-slip fail-safe
- LINE/Stripe signature + idempotency
- monthly-only/no legacy quota/public copy truth
- secret leakage
- tests ไม่ bypass authority

บันทึก review ที่:
`docs/audit/INDEPENDENT_REVIEW_CODEX_BK-A_2026-08-29.md`

ถ้าพบ P0/P1 ที่แก้ได้ตาม locked decisions ให้แก้เฉพาะจุด + rerun tests + review ซ้ำในรอบนี้
ถ้าต้องใช้ owner decision ให้บันทึก blocker ไม่เดา

## Finish
อัปเดต evidence summary และ `MASTER_CHECKLIST` เฉพาะสิ่งที่พิสูจน์ผ่านจริง
อนุญาต local commit สำหรับ review/evidence/fixes

STOP พร้อมรายงาน:
- latest local SHA
- independent review verdict
- P0/P1/P2 ที่เหลือ
- non-DB gates ที่ผ่าน
- DB/provider gates ที่ยัง pending
- exact next step ว่าต้องใช้ Continuation 04 หรือไม่

ห้าม push / merge / deploy
