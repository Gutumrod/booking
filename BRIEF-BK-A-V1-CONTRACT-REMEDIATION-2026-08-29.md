# BRIEF — BK-A V1 Contract Remediation

**Product:** BK01 — booking
**Repository:** `Gutumrod/booking`
**Working path:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Starting branch:** `main`
**Starting HEAD:** `bd1b0a9`
**Date:** 2026-08-29
**Status:** READY FOR IMPLEMENTATION

## เป้าหมาย
ปิดช่องว่างทั้งหมดระหว่างระบบปัจจุบันกับ V1 ที่ล็อกไว้ใน BK-0 เพื่อให้ Booking พร้อมเข้าสู่ช่วง Pilot Readiness ต่อไป

งานนี้อนุญาตให้แก้ application code, tests, schema/migrations, RLS/RPC และ configuration template ที่จำเป็นต่อ BK-A ได้ แต่ต้องทำตามเอกสารที่ล็อกไว้แล้วเท่านั้น

## ก่อนเริ่ม
1. ตรวจว่า repo อยู่ที่ `main @ bd1b0a9` และ remote ตรงกัน
2. `.claude/settings.local.json` เป็นไฟล์ local เท่านั้น ห้ามแก้ ห้าม add ห้าม commit
3. ถ้ามี dirty work อื่นที่ไม่ใช่ไฟล์ดังกล่าว ให้ STOP และรายงานก่อน
4. สร้าง local branch `feature/bk-a-v1-contract-remediation`
5. ห้าม deploy production
6. ห้าม push หรือ merge จนกว่าจะมี owner authorization
7. ห้ามเปลี่ยน product decisions ที่ล็อกไว้เอง

## เอกสารอ้างอิงที่ต้องอ่านก่อนแก้
ถือไฟล์เหล่านี้เป็นกติกาหลัก:
- `docs/01_PRD.md`
- `docs/02_SYSTEM_ARCHITECTURE.md`
- `docs/03_DATA_SECURITY_TENANCY.md`
- `docs/04_PRICING_ENTITLEMENTS.md`
- `docs/05_BOOKING_DOMAIN_RULES.md`
- `docs/06_UX_USER_FLOWS.md`
- `docs/08_EXTERNAL_DEPENDENCIES.md`
- `docs/09_TEST_RELEASE_GATES.md`
- `docs/10_DEVELOPMENT_ROADMAP.md`
- `docs/PRODUCT_DECISIONS.md`
- `docs/MASTER_CHECKLIST.md`
- `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md`
- `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`

ถ้า code ปัจจุบันขัดกับเอกสารชุดนี้ ให้เอกสารชุดนี้เป็นเป้าหมาย V1 แต่ต้องรักษาพฤติกรรมเดิมที่ยังถูกต้องและมี test ครอบคลุม

## กติกาการทำงาน
- ทำทีละหัวข้อด้านล่างตามลำดับ เพื่อลดการชนกันของ schema/security/UI
- ทุกหัวข้อต้องมี implementation + test + negative path ตามที่เกี่ยวข้อง
- ทุก migration ต้อง replay ได้จากฐานสะอาด
- ห้ามใช้ client-side check แทน RLS/RPC/server authorization
- ห้าม hardcode secret หรือใส่ secret ลงฐานข้อมูลที่ client อ่านได้

## BK-A1 — ทำสลิปให้เป็นไฟล์ส่วนตัว
เป้าหมาย: ปิด public access ของ `deposit-slips`
- เปลี่ยน storage policy/bucket ให้ private ตาม PD-007
- เลิกใช้ permanent public URL / `getPublicUrl`
- เก็บ reference ที่ไม่เปิดเผยไฟล์ตรง ๆ
- merchant ที่มีสิทธิ์เท่านั้นจึงเปิดดูผ่าน signed/authorized read ได้
- customer upload ต้องผูกกับ booking ที่ถูกต้องและผ่าน MIME/size validation
- foreign/forged object reference ต้องอ่านไม่ได้
- เพิ่ม test สำหรับ unauthorized, cross-shop และ expired/invalid access

## BK-A2 — ผูก user กับพนักงานจริง
เป้าหมาย: staff เห็นเฉพาะงานตัวเองตาม PD-006
- เพิ่ม explicit auth-user → staff mapping
- owner/admin เห็นระดับร้านตาม contract
- staff เห็นเฉพาะ booking/schedule ของ staff identity ที่ map กับตัวเอง
- staff ห้ามเห็น shop-wide customer/history/ticket/support data
- missing/foreign mapping ต้อง fail closed
- ปรับ RLS/RPC/server query/UI ที่เกี่ยวข้องให้ใช้ contract เดียวกัน
- เพิ่ม cross-role และ cross-tenant negative tests

## BK-A3 — ลบ annual billing ของ V1
เป้าหมาย: V1 ขายรายเดือนเท่านั้น
- ลบ annual selector, annual ฿4,900/฿9,900 และ copy ที่สื่อว่าซื้อรายปีได้
- Stripe Checkout ต้องเปิดเฉพาะ monthly Basic/Pro
- ห้ามสร้าง annual price ใหม่ใน BK-A
- เพิ่ม test ยืนยันว่า V1 ไม่มี annual path

## BK-A4 — เลิกใช้ 100/500 booking เป็นกำแพงแพ็กเกจ
เป้าหมาย: paid plan ไม่ถูกจำกัดด้วย quota เก่า
- Trial ยังคง evaluation quota ตามเอกสาร
- Basic/Pro ต้องไม่ block ร้านปกติด้วย legacy 100/500 booking wall
- ถ้ามี fair-use/abuse guard เดิม ให้แยกออกจาก marketing/value wall ชัดเจน
- แก้ entitlement logic, UI, copy และ tests ที่ยังอ้าง 100/500
- ไม่ต้องล็อก final public price ใน BK-A

## BK-A5 — แยก LINE OA ของร้านกับ OA กลาง
เป้าหมาย: paid production ใช้ merchant-owned LINE OA ตาม PD-005
- central WSTERA OA ใช้เฉพาะ trial/onboarding mode
- merchant LINE channel secret/access token ต้องอยู่ server-side secret boundary
- ห้ามเก็บ raw token ใน shop row, browser storage หรือ client-readable env
- config missing/invalid ต้อง fail safely และมี operator evidence
- webhook signature/authenticity ต้องยัง fail closed
- แยก config resolution ให้รู้ชัดว่า booking นี้ส่งผ่าน central หรือ merchant OA
- เพิ่ม test central-vs-merchant, invalid secret/signature และ send failure

## BK-A6 — confirmation + reminder
เป้าหมาย: ทุก booking ที่เข้าเงื่อนไขมี confirmation และอย่างน้อย 1 pre-appointment reminder
- notification failure ห้ามเปลี่ยน booking state
- มี sent/failed evidence และ retry/idempotency ที่ตรวจย้อนหลังได้
- scheduler/delivery mechanism ต้องไม่ยิงซ้ำแบบไม่ควบคุม
- ต้องรองรับ provider failure และ retry อย่างปลอดภัย
- เพิ่ม tests สำหรับ success, failure, retry, duplicate และ booking ที่ถูกยกเลิกก่อน reminder

## BK-A7 — Auto-slip สำหรับ Pro
เป้าหมาย: Pro ต้องตรวจสลิปอัตโนมัติได้จริงก่อนขาย public Pro
- เลือก/เชื่อม provider ผ่าน server-side integration boundary
- ห้าม auto-confirm เมื่อ timeout, unknown, ambiguous หรือ provider error
- duplicate transaction/reference ต้องไม่ยืนยันเงินซ้ำ
- ผลตรวจทุกครั้งต้อง audit ได้
- ถ้า provider ไม่พร้อมหรือผลไม่ชัด ให้ค้าง manual review ได้
- allowance/usage ต้องวัดได้ตาม FR-BILL-004 แต่ห้ามเดา final allowance/top-up price
- ถ้าการเลือก provider ต้องใช้ owner decision ใหม่ ให้ STOP เฉพาะหัวข้อนี้และรายงาน blocker โดยทำหัวข้ออื่นต่อได้ถ้าไม่พึ่ง provider นั้น

## BK-A8 — สร้าง PromptPay QR ภายใต้ BK01
เป้าหมาย: เลิก runtime dependency `promptpay.io`
- ใช้ controlled library/service boundary ที่เหมาะกับ repo
- สร้าง payload/QR แบบ deterministic จาก recipient + amount ที่ผ่าน validation
- ห้ามส่งข้อมูลลูกค้า/ร้านไป public image generator โดยไม่จำเป็น
- invalid recipient/amount ต้อง fail safely
- เพิ่ม deterministic tests และ regression test ยืนยันว่าไม่มี runtime call ไป `promptpay.io`

## BK-A9 — ลูกค้าเลื่อน/ยกเลิกคิวเอง
เป้าหมาย: self-service cancel/reschedule ตาม PD-009
- ใช้ recovery/booking authorization ที่ไม่เปิดข้อมูลคนอื่น
- policy window ต้อง enforce ฝั่ง server/DB ไม่ใช่ UI อย่างเดียว
- reschedule ต้อง atomic: ถ้าคิวใหม่ชน/ไม่ผ่าน validation ให้คิวเดิมอยู่เหมือนเดิม
- ใช้ booking collision constraint เป็น authority
- ทุก cancel/reschedule ต้องมี reason/audit/history ตาม contract
- ส่ง notification ตามผลจริง และ notification failure ห้าม rollback booking truth
- เพิ่ม tests สำหรับ expired/invalid token, policy failure, collision, rollback และ cross-booking access

## BK-A10 — completed / no-show + analytics
เป้าหมาย: owner/admin ปิดผลนัดได้จริง
- เพิ่ม explicit action สำหรับ `completed` และ `no_show`
- จำกัดสิทธิ์ owner/admin ตาม contract
- transition จาก state ที่ไม่ถูกต้องต้อง reject
- เก็บ actor/time/history และ canonical analytics events
- ห้ามเดา no-show จากเวลาที่ผ่านไปเอง
- เพิ่ม role/state/metric tests

## BK-A11 — CSV export + ขอปิดบัญชี/ลบข้อมูล
เป้าหมาย: owner เอาข้อมูลหลักออกได้และมีช่องทางขอปิดบัญชี
- CSV export ต้อง tenant-scoped และ owner-only
- export เฉพาะ core business data ที่เอกสารกำหนด ไม่ export secret/internal platform data
- non-owner/cross-tenant ต้องถูกปฏิเสธ
- เพิ่ม deletion/account-closure request workflow พร้อม audit trail
- อย่าลบข้อมูลที่อาจต้องเก็บตามกฎหมายโดยอัตโนมัติ; route ผ่าน support/privacy process ตามเอกสาร
- เพิ่ม tests สำหรับ authorization, scope และ request lifecycle

## BK-A12 — ticket/support + platform admin audit
เป้าหมาย: ticket ของร้านใช้ได้เฉพาะ owner/admin และ privileged action ตรวจย้อนหลังได้
- staff ห้าม read/mutate shop-wide ticket/support workflow
- owner/admin ทำ ticket operations ตาม V1 contract
- platform-admin RPC/action ต้อง deny non-admin
- privileged action ต้องมี actor, tenant, target, action, timestamp และผลลัพธ์ที่พอตรวจสอบได้
- ห้ามสร้าง hidden impersonation path
- เพิ่ม role/RLS/RPC negative tests

## BK-A13 — ลบข้อความโฆษณาที่รับรองเกินจริง
เป้าหมาย: UI ปัจจุบันต้องไม่พูดเกินสิ่งที่ระบบพิสูจน์ได้
- ลบหรือเขียนใหม่ `ปลอดภัย 100%`
- ตรวจคำว่า `100%`, guarantee, secure/safe absolute และ claim ที่ไม่มี `SHIPPED-VERIFIED` evidence
- ข้อความเรื่องเงินมัดจำต้องอธิบาย flow ตามจริง ไม่รับรองผลแบบ absolute
- อย่าเพิ่ม claim ใหม่เพื่อทดแทนถ้ายังไม่มี evidence
- เพิ่ม copy regression test หรือ static assertion ในจุดสำคัญถ้าเหมาะสม

## BK-A14 — ทำหน้าแพ็กเกจ/ราคาให้ตรงกับความจริง
เป้าหมาย: commercial UI ต้องตรงกับ PD-002/PD-003/PD-008
- ไม่มี annual offer
- ไม่มี legacy paid 100/500 booking wall เป็นจุดขาย
- ฿490/฿990 ถ้ายังแสดงได้ต้องระบุเป็น pilot/reference/provisional อย่างชัดเจน หรือไม่แสดงเป็น final public price
- ห้ามตั้ง final Basic/Pro price เอง
- ห้ามตั้ง final auto-slip allowance/top-up หรือ managed LINE cost เอง
- ตรวจ register/pricing/checkout/dashboard/marketing surfaces ที่มี copy เก่า

## เรื่องที่ห้ามตัดสินใจแทนเจ้าของ
- final Basic/Pro public price
- final Basic/Pro public price
- final Pro auto-slip provider ถ้ายังต้องเลือกจากหลายเจ้าที่มีผลต่อธุรกิจ/ข้อมูล/ต้นทุน
- final auto-slip allowance/top-up economics
- WSTERA-managed LINE allowance/cost model
- final `past_due` grace duration
- final RPO/RTO และ retention durations
- legal/privacy interpretation ใหม่

ถ้าหัวข้อใดติดเรื่องเหล่านี้ ให้ทำส่วน engineering ที่ไม่ขึ้นกับ decision ให้ครบ แล้วบันทึก `OWNER DECISION BLOCKER` โดยไม่เดาคำตอบ

## Test gates ที่ต้องผ่านก่อนจบ BK-A
รันและเก็บผลตาม `docs/09_TEST_RELEASE_GATES.md` อย่างน้อย:
- G1 static/build: typecheck, lint, unit/integration, production build ทั้ง consumer/admin
- G2 database: clean migration replay/reset, DB lint/advisors, function grants/search_path, RLS
- G3 tenancy/security: cross-tenant denied, staff self-scope, private slip denied when unauthorized
- G4 booking integrity: hold/expiry/schedule/closure/Any Staff/concurrency overlap
- G5 deposit/money: manual + auto-slip positive/negative/unknown/duplicate/private storage
- G6 lifecycle: cancel/reschedule rollback/completed/no-show
- G7 LINE: signature/config/confirmation/reminder/retry/failure
- G8 billing: monthly lifecycle, duplicate/out-of-order webhook, no annual path
- G9 data/support: CSV, closure request, ticket roles, platform-admin audit

G10 deployment ให้เตรียม/ตรวจ config และ build evidence ได้ แต่ **ห้าม production deploy** ในบรีฟนี้

## Mandatory negative tests
ต้องมี evidence อย่างน้อยสำหรับทุกข้อที่เกี่ยวข้อง:
- anonymous direct write ถูกปฏิเสธ
- cross-shop ID substitution ถูกปฏิเสธ
- staff พยายามดู shop-wide booking/customer/ticket ถูกปฏิเสธ
- expired/blocked subscription สร้าง booking ไม่ได้ตาม policy
- missing schedule ไม่กลายเป็น available
- concurrent overlap provider เดียวกันถูก reject
- expired hold ส่งสลิปไม่ได้
- forged/foreign slip object reference ใช้ไม่ได้
- invalid Stripe/LINE signature ถูกปฏิเสธ
- duplicate/out-of-order webhook ไม่ทำ state ย้อนผิด
- auto-slip timeout/ambiguous result ไม่ auto-confirm
- platform-admin RPC ถูก non-admin เรียกไม่ได้

## สิ่งที่ต้องอัปเดตในเอกสารหลัง implementation
หลัง code/tests ผ่าน ให้ปรับเฉพาะสถานะ/evidence ไม่เปลี่ยน product decision:
- `docs/MASTER_CHECKLIST.md` — ติ๊กเฉพาะ BK-A item ที่พิสูจน์ผ่านจริง
- `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md` — baseline gap ที่ปิดแล้วให้ชี้ evidence ใหม่
- `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md` — เติม release evidence/authority path ให้ตรงของจริงถ้าจำเป็น
- `docs/10_DEVELOPMENT_ROADMAP.md` — บันทึก BK-A completion status โดยไม่เปิด BK-B ก่อน gate ผ่าน
- สร้าง `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`

Evidence report ต้องบอก:
- starting SHA และ final local SHA ถ้ามี commit
- migration ที่เพิ่ม/แก้
- code areas ที่แก้
- commands/tests ที่รันและผลจริง
- failed tests และ remediation ถ้ามี
- owner-decision blockers ที่ยังเหลือ
- สิ่งที่ยังไม่ทดสอบกับ provider จริง

## Independent implementation review
เมื่อ implementation + tests + evidence เสร็จ ให้เปิด fresh read-only reviewer process/subagent แยกจากผู้ลงมือทำ

Reviewer ต้องตรวจอย่างน้อย:
1. ทุก BK-A1–BK-A14 เทียบกับ PRD/decisions/traceability
2. migration/RLS/RPC security โดยเฉพาะ tenant, staff, storage และ privileged access
3. booking concurrency และ reschedule atomicity
4. money/deposit/auto-slip fail-safe paths
5. LINE/Stripe signature, retry, duplicate/out-of-order behavior
6. annual/quota/provisional-price/unsupported-copy ถูกเอาออกจาก current V1 surfaces จริง
7. tests ไม่ใช่แค่ happy path และไม่มี test ที่ bypass authority จริง
8. ไม่มี secret/config value หลุดเข้ repo/log/client bundle

บันทึก review ที่:
`docs/audit/INDEPENDENT_REVIEW_CODEX_BK-A_2026-08-29.md`

ถ้า reviewer เจอ P0/P1 ที่แก้ได้ตาม locked decision ให้แก้ → rerun tests ที่เกี่ยวข้อง → review ใหม่จนไม่มี P0/P1
P2 ให้แก้ใน BK-A ถ้าความเสี่ยงต่ำและไม่เพิ่ม scope; ถ้าต้องใช้ decision ใหม่ให้บันทึก blocker ชัดเจน

## Git / Stop rule
- อนุญาต local commits บน `feature/bk-a-v1-contract-remediation` เพื่อเก็บงานเป็นช่วง ๆ
- ห้าม commit `.claude/settings.local.json`, secrets, generated credentials หรือ local-only env
- ก่อนจบต้อง `git diff --check` ผ่าน
- ตรวจว่าไม่มี secret หลุดและ working tree เหลือเฉพาะ local-only file ที่ตั้งใจไว้
- **ห้าม push**
- **ห้าม merge main**
- **ห้าม deploy**
- STOP หลังส่ง final summary + evidence path + reviewer verdict + final local commit SHA

## Definition of Done
BK-A ถือว่าเสร็จเมื่อ BK-A1–BK-A14 ที่ไม่ติด owner/provider decision มี implementation และ evidence ครบ, test gates ที่เกี่ยวข้องผ่าน, ไม่มี unresolved P0/P1 จาก independent review, และ blocker ที่ยังต้องใช้ owner decision ถูกแยกออกอย่างตรงไปตรงมา

หลังจากนั้นรอ owner อนุมัติ commit/push/ขั้นต่อไปก่อนเข้าสู่ BK-B Pilot Readiness
