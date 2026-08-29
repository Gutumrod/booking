# BRIEF — BK-A Continuation 04: Database Runtime Gates

**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `feature/bk-a-v1-contract-remediation`
**Start from:** latest local commit produced by Continuation 03
**Run this brief only when local/test PostgreSQL + Supabase environment is already available.**

## Fast pre-check
ก่อนทำอะไร ให้ตรวจว่า local Supabase/PostgreSQL พร้อมใช้งานจริง

ถ้าไม่พร้อม:
- STOP ทันที
- รายงาน `BLOCKED_ENVIRONMENT: local Supabase/PostgreSQL unavailable`
- ห้ามติดตั้ง Docker, ห้ามเปิด production DB, ห้ามใช้ remote production project
- อย่าเสีย token ตรวจโค้ดซ้ำจาก Continuation 01–03

## Scope เมื่อ environment พร้อม
พิสูจน์ DB-backed gates ที่ค้างเท่านั้น:
- clean migration replay/reset
- DB lint/advisors ถ้ามีใน toolchain
- pgTAP / `supabase/tests/bk_a_contract.sql`
- grants, SECURITY DEFINER, `search_path`, RLS
- cross-tenant denial
- missing/foreign staff mapping denial
- private slip unauthorized/cross-shop denial
- booking collision/concurrency
- reschedule rollback/atomicity
- lifecycle/ticket/platform-admin authorization

## Commands/evidence
ใช้คำสั่งตาม repo/toolchain ปัจจุบัน เช่น `npx supabase test db` และ `npx supabase db lint --local` เมื่อ environment รองรับ
เก็บ command + exit code + expected/actual results ลง evidence

ห้ามแก้ product decision เพื่อให้ test ผ่าน
หาก migration/test มี defect ให้แก้เฉพาะ defect แล้ว rerun จนผลชัดเจน

## Completion rule
เมื่อ DB gates ผ่าน:
- อัปเดต `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`
- อัปเดต `docs/MASTER_CHECKLIST.md` เฉพาะรายการที่มี runtime evidence จริง
- ถ้า Continuation 03 reviewer เคยค้างเพราะ DB evidence ให้เปิด fresh read-only re-review เฉพาะ findings/gates ที่ค้าง
- บันทึก verdict ใหม่หรือ addendum อย่างชัดเจน

รันท้ายสุด:
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`

อนุญาต local commit เท่านั้น

STOP พร้อมรายงาน:
- final local SHA
- DB tests PASS/FAIL
- gates G2–G9 ที่พิสูจน์เพิ่มได้
- unresolved P0/P1/P2
- owner/provider blockers ที่ยังไม่ใช่ engineering defect

ห้าม push / merge / production deploy / remote migration apply
