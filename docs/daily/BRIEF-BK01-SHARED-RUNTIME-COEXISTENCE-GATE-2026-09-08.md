# BRIEF — BK01 Shared-Runtime Coexistence Gate

## MODE

**BK01 / WSTERA LAB SHARED-RUNTIME COEXISTENCE — ASSESS + PROVE ONLY**

แชทใหม่นี้รับช่วงต่อจาก assessment:

`docs/audit/BK01-SHARED-RUNTIME-SCHEMA-ALIGNMENT-ASSESSMENT-2026-09-08.md`

Current BK01 branch:

`feature/bk-a-v1-contract-remediation`

Current checkpoint at handoff:

`f6bacce` — `docs(booking): assess shared runtime schema alignment`

Git state at handoff: **clean / origin 0/0**

WSTERA LAB project:

`ykxlqnshaaxmzzocpjlj`

## OWNER DIRECTION

WSTERA LAB ไม่ได้มีไว้พิสูจน์ว่า product เดี่ยวรันได้เท่านั้น แต่ต้องพิสูจน์ว่า product หลายตัวอยู่ใน Supabase project เดียวกันได้โดยไม่ทำลายกัน
ดังนั้นเกณฑ์ใหม่คือ:

> **BK01 จะถือว่า SHARED-RUNTIME PASS ก็ต่อเมื่อ BK01 ทำงานถูกต้อง และพิสูจน์ได้ว่าไม่สร้าง collateral damage ต่อ PS01 หรือ product อื่นที่เข้ามาใน WSTERA LAB**

ถ้า BK01 ต้องให้ product อื่นหลบ, เปลี่ยนชื่อ resource, เปลี่ยน global config, หรือระวัง side effect จาก BK01 เป็นพิเศษโดยไม่มี governance ที่ชัดเจน ให้ถือว่า shared-runtime design ยังไม่ผ่าน

## CURRENT FINDING FROM PREVIOUS ASSESSMENT

Live `local_service` inventory ใน WSTERA LAB ณ assessment ล่าสุด:

- 21 tables
- 1 view
- 61 functions/RPCs
- 10 application triggers
- 26 RLS policies
- 61 indexes
- 35 foreign keys
- 0 sequences
- migration ledger กลางมี 30 BK01 migration versions อยู่ใน `supabase_migrations.schema_migrations`

Schema alignment verdict เดิม:

`PARTIAL ALIGNMENT RECOMMENDED`

แต่ verdict นี้ **ไม่ใช่ SHARED-RUNTIME PASS** จนกว่า coexistence gate รอบนี้จะผ่าน
## HARD BOUNDARY

รอบนี้ **ห้าม migrate BK01 schema จริง** และห้ามแก้ PS01

อนุญาตเฉพาะ:

- read-only inventory / checksum / grants / policy / dependency inspection
- design/proof scripts ที่ไม่ mutate shared runtime
- isolated test fixture เฉพาะเมื่อจำเป็นและต้อง namespaced ชัดเจน
- documentation / evidence / gate definition

ห้าม:

- `ALTER ... SET SCHEMA`
- rename live schema/table/function
- delete/modify PS01 object
- modify production
-เปลี่ยน billing/LINE architecture
- เปิด Council
- feature/refactor นอก shared-runtime coexistence

## SHARED-RUNTIME HARD GATE

BK01 ต้องผ่านทั้งสองมิติพร้อมกัน:

### A. Product Integrity

Booking, Admin/Staff, Customer, LINE, Billing, RLS, Recovery และ rollback ของ BK01 ต้องยังผ่านตาม evidence ปัจจุบัน

### B. Coexistence Integrity

BK01 ต้องไม่สร้าง collateral mutation หรือ privilege leakage ต่อ product อื่นใน WSTERA LAB
ต้องพิสูจน์อย่างน้อย:

- PS01 object count/checksum ไม่เปลี่ยนจากการทำงานของ BK01
- PS01 grants / RLS / functions / internal schema ไม่เปลี่ยน
- BK01 ไม่มีสิทธิ์เข้าถึง `ps01` / `ps01_internal` เกินความจำเป็น
- PS01 ไม่มีสิทธิ์เข้าถึง `local_service` โดยพลการ
- shared `public` / `auth` / `storage` / `cron` / extensions ไม่ถูก BK01 mutate โดยไม่ได้รับอนุมัติ
- Data API exposed-schema config ไม่ถูก product repo ใดผูกขาดหรือแก้ลบของ product อื่น
- migration ledger ไม่เกิด version/ownership collision เมื่อมีหลาย repo
- storage bucket/policy ไม่เกิดชื่อชนหรือ cross-product policy bleed
- BK01 migration/rollback ในอนาคตต้องไม่ทำให้ PS01 runtime เสีย

ถ้าข้อใดข้อหนึ่ง fail ให้สถานะเป็น:

`BK01 SHARED-RUNTIME = FAIL / NOT READY`

แม้ BK01 product flow ของตัวเองจะยังทำงานได้

## KNOWN GLOBAL-RUNTIME RISKS TO ASSESS FIRST

1. `supabase_migrations.schema_migrations` เป็น project-global ledger และมีหลาย product repo ใช้งาน project เดียวกัน
2. BK01 storage bucket `deposit-slips` เป็นชื่อ global/non-namespaced และ storage policy อ้าง `local_service.bookings` + `local_service.has_shop_role()` โดยตรง
3. Supabase Data API exposed schemas เป็น project-level configuration
4. `auth.users` เป็น shared identity surface
5. `cron`, extensions, `net`, storage config และ project-global roles/grants เป็น shared surfaces
## REQUIRED WORK

### Phase 1 — Cross-Product Baseline Snapshot

เก็บ read-only baseline ของอย่างน้อย:

- `local_service`
- `ps01`
- `ps01_internal`
- relevant `public`
- relevant `auth` dependency shape
- storage buckets + policies
- cron jobs
- exposed schemas
- extensions / network-related shared objects ที่เกี่ยวข้อง
- migration ledger

ต้องมี object count + deterministic checksum/signature ที่ใช้เทียบก่อน/หลังได้

ห้ามอ่าน/แก้ data ของ PS01 เกิน metadata ที่จำเป็นต่อ coexistence proof

### Phase 2 — Ownership Matrix

จัด shared/global resources ทุกตัวเป็นอย่างน้อย:

- BK01-owned
- PS01-owned
- shared platform-owned
- external provider-owned
- UNCERTAIN

ทุก global resource ต้องมี owner และ mutation authority ชัดเจน
### Phase 3 — Migration-Ledger Coexistence

ตอบให้ได้ว่า multi-repo migration workflow จะไม่ชนกันอย่างไร

อย่างน้อยต้องตรวจ:

- version collision risk
- ordering/cutover risk
- repo A เห็น migration ของ repo B แล้ว CLI/automation ตีความอย่างไร
- rollback ownership
- migration naming/version policy ที่ควรเป็น platform standard

รอบนี้ออกแบบ policy/proof เท่านั้น ห้าม rewrite migration history

### Phase 4 — Global Resource Collision Review

ตรวจ BK01 โดยเฉพาะ:

- `deposit-slips`
- storage policies
- exposed schema requirement
- shared auth dependencies
- cron/scheduler ownership
- global extensions/network surfaces

ระบุว่าอะไร grandfather ได้ และอะไรต้อง namespaced ใน product ใหม่/อนาคต

### Phase 5 — Add-Product Simulation Design

ออกแบบ test fixture product เช่น `TEST03` เพื่อพิสูจน์ในอนาคตว่า install/upgrade/remove product ใหม่แล้ว BK01 + PS01 ไม่เปลี่ยน
Simulation contract ต้องครอบคลุม:

```text
baseline BK01 + PS01
→ install TEST03
→ verify BK01 unchanged
→ verify PS01 unchanged
→ upgrade TEST03
→ verify BK01/PS01 unchanged
→ remove TEST03
→ verify BK01/PS01 unchanged
```

ห้าม execute destructive simulation บน WSTERA LAB ในรอบนี้จนกว่า Owner จะอนุมัติ execution brief แยก

### Phase 6 — Schema-Alignment Decision Reconciliation

เอาผล coexistence gate ไป reconcile กับ assessment เดิม

ต้องตอบใหม่ว่า:

- `PARTIAL ALIGNMENT RECOMMENDED` ยังพอหรือไม่
- first-wave internal candidates เดิมยังปลอดภัยหรือไม่
- มี global-resource issue ใดบังคับให้แก้ก่อน schema split หรือไม่
- BK01 สามารถถูกประกาศ shared-runtime ready ได้หรือยัง

ห้าม migrate จริงใน phase นี้

## PASS / FAIL RULE

ห้ามใช้คำว่า `PASS` จากการที่ BK01 runtime ตัวเองเขียวอย่างเดียว
Shared-runtime PASS ต้องมี evidence ว่า:

```text
BK01 works
AND
PS01 unchanged
AND
shared surfaces unchanged except explicitly authorized changes
AND
future-product path has no namespace/ownership collision
```

ถ้า evidence ยังไม่พอให้ mark `NOT PROVEN` ห้ามเดา PASS

## REQUIRED OUTPUT

จัดทำเอกสาร:

`docs/audit/BK01-SHARED-RUNTIME-COEXISTENCE-ASSESSMENT-2026-09-08.md`

ต้องมีอย่างน้อย:

1. Shared-runtime baseline
2. Cross-product object/checksum snapshot
3. Global resource ownership matrix
4. Migration-ledger collision analysis
5. Storage/Data API/Auth/Cron exposure findings
6. Add-product simulation design
7. BK01 ↔ PS01 collateral-risk matrix
8. Remediation required before PASS
9. Recommendation: `PASS`, `PASS WITH REQUIRED REMEDIATION`, หรือ `FAIL / NOT READY`
10. Owner decisions required before any mutation
## EXISTING EVIDENCE TO REUSE — DO NOT RESTART

- Schema alignment assessment: `docs/audit/BK01-SHARED-RUNTIME-SCHEMA-ALIGNMENT-ASSESSMENT-2026-09-08.md`
- BK01 current schema: `local_service`
- Proposed internal schema name: `local_service_internal` — NOT LOCKED
- Existing recommendation: `PARTIAL ALIGNMENT RECOMMENDED`
- WSTERA LAB is approved non-production shared proving ground
- BK01 LINE staging matrix + reminder acceptance: PASS
- Cloudflare staging rollback/redeploy proof: PASS
- Migration history at assessment: 30 BK01 versions visible in shared project ledger
- BK01 storage dependency: private `deposit-slips` bucket with policy tied to `local_service`

Preserve all prior evidence. Do not repeat expensive testing unless new coexistence evidence requires it.

## STOP GATE

เมื่อ coexistence assessment + remediation design เสร็จ:

**STOP AND REPORT OWNER**

ห้าม:

- execute schema split
- alter global Supabase config
- rename bucket
- rewrite migration ledger
- create/remove TEST03 on live WSTERA LAB
- mutate PS01

จนกว่าจะมี Owner explicit execution approval

## SUCCESS CONDITION

ต้องตอบได้ด้วยหลักฐานว่า BK01 สามารถอยู่ใน Supabase project เดียวกับ PS01 และ future products โดยไม่ทำให้ product อื่นต้องรับความเสี่ยงจาก BK01 และต้องรู้ชัดว่ามี remediation อะไรที่ต้องทำก่อนประกาศ `BK01 SHARED-RUNTIME PASS`.
