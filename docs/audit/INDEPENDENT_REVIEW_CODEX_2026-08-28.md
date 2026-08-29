# BK01 Independent Review — Round 1

**Status:** HISTORICAL REVIEW RESULT — BLOCKED; findings subsequently remediated and require fresh independent re-review.

## P0

ไม่พบ P0 จากการรีวิวเอกสารรอบนี้ และไม่ได้ทำ fresh penetration test หรือ production verification.

## P1

1. **Competitive gate ไม่ครบตาม brief จึงยังใช้ lock packaging/positioning ไม่ได้**

   Brief บังคับ competitive matrix จำนวนมาก เช่น quota definition, branches, LINE mode, app requirement, reschedule/cancel, waitlist, calendar sync, analytics, API/webhooks, export, support, fees, branding และ privacy claims ที่ [BK-0 brief](D:/AI-Workspace/projects/saas-product-hub/products/booking/BRIEF-BK0-PRODUCT-DOCUMENTATION-AND-MARKET-LOCK-2026-08-28.md:105) แต่ matrix จริงมีเพียงราคา, trial, capacity, staff/branch, LINE และ deposit ที่ [COMPETITIVE_LANDSCAPE_2026.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/market/COMPETITIVE_LANDSCAPE_2026.md:12)

   Source ledger ก็ยังไม่บันทึก cadence, VAT/fees และ quota definition อย่างเป็นระบบตาม research standard ใน brief lines 69–77; ดูรายการจริงที่ [MARKET_SOURCE_LEDGER.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/MARKET_SOURCE_LEDGER.md:8) และ global set ที่ [line 24](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/MARKET_SOURCE_LEDGER.md:24)

   นี่ไม่ใช่แค่รายละเอียดตกหล่น เพราะ brief กำหนดให้ market gate เสร็จก่อน pricing, packaging, positioning และ V1 boundary ถูก lock. BK-A consequence: ยังเริ่มจาก contract ที่อ้างว่าผ่าน market lock ไม่ได้.

2. **Staff authorization contract ยังไม่ครอบคลุม ticket/support capability ที่ baseline เปิดให้ staff**

   Target role contract บอก staff เห็นเฉพาะ schedule/bookings ของ provider ที่ map และทำได้เฉพาะ own-work actions ที่ [03_DATA_SECURITY_TENANCY.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/03_DATA_SECURITY_TENANCY.md:12) ขณะที่ staff UX ก็พูดเฉพาะ own schedule/assigned bookings ที่ [06_UX_USER_FLOWS.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/06_UX_USER_FLOWS.md:25)

   แต่ baseline migration ให้ staff:

   - อ่าน tickets/timelines ทั้งร้านผ่าน membership ที่ [20260818000000_local_service_tickets.sql](D:/AI-Workspace/projects/saas-product-hub/products/booking/supabase/migrations/20260818000000_local_service_tickets.sql:71)
   - สร้าง ticket ที่ [line 121](D:/AI-Workspace/projects/saas-product-hub/products/booking/supabase/migrations/20260818000000_local_service_tickets.sql:121)
   - เปลี่ยน status ที่ [line 265](D:/AI-Workspace/projects/saas-product-hub/products/booking/supabase/migrations/20260818000000_local_service_tickets.sql:265)
   - แก้ priority/assignee/resolution ที่ [line 493](D:/AI-Workspace/projects/saas-product-hub/products/booking/supabase/migrations/20260818000000_local_service_tickets.sql:493)

   Traceability ระบุเพียง “Merchant/support” ไม่ตัดสินว่า owner/admin/staff คนใดทำอะไรได้ ที่ [FEATURE_REQUIREMENT_TRACEABILITY.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md:44) จึงยังไม่ผ่านเงื่อนไข “ทุก role มี explicit authorization และ UX contract”. BK-A consequence ต้องยึด disposition ที่แก้แล้วว่าจะ preserve หรือ narrow staff ticket access.

3. **Traceability matrix เสียรูปและไม่ได้ให้หนึ่งแถวต่อ capability ตามข้อบังคับ**

   “Shop closures/time-off” กับ “Public booking page” ถูกต่อเป็นแถวเดียวที่ [FEATURE_REQUIREMENT_TRACEABILITY.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md:19) และ “Customer history” กับ “LINE binding/receipt” ถูกต่อเป็นแถวเดียวที่ [line 34](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md:34)

   จึงไม่เป็นไปตาม “exactly one disposition” และ schema หนึ่งแถวต่อ feature ที่ brief กำหนดไว้ แม้ข้อความของทั้งสี่ capability จะยังมองเห็นได้.

4. **Backup/recovery pack ยังไม่ส่งสิ่งที่ brief บังคับ**

   Brief ต้องการ backup owner/frequency/retention, restore rehearsal และ “RTO/RPO proposal requiring explicit approval” ที่ [BK-0 brief](D:/AI-Workspace/projects/saas-product-hub/products/booking/BRIEF-BK0-PRODUCT-DOCUMENTATION-AND-MARKET-LOCK-2026-08-28.md:257)

   Runbook ปัจจุบันยังไม่มี named owner, proposed frequency, proposed retention, rehearsal cadence หรือ proposed RTO/RPO; มีเพียงรายการว่าจะ finalize ภายหลังที่ [BACKUP_RESTORE_RUNBOOK.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/operations/BACKUP_RESTORE_RUNBOOK.md:8) ดังนั้นมันยังเป็น placeholder checklist มากกว่า locked procedure.

5. **Support runbook ไม่มี response expectations**

   Brief ระบุชัดว่าต้องกำหนด response expectations ที่ [BK-0 brief](D:/AI-Workspace/projects/saas-product-hub/products/booking/BRIEF-BK0-PRODUCT-DOCUMENTATION-AND-MARKET-LOCK-2026-08-28.md:259) แต่ [SUPPORT_RUNBOOK.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/operations/SUPPORT_RUNBOOK.md:8) มี intake, allowed/prohibited actions และ escalation โดยไม่มี acknowledgement/response/escalation expectation แม้แต่แบบ provisional.

## P2

1. **Market-document statuses ค้างจากก่อน owner decision**

   [MARKET_AND_SEGMENTATION_2026.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/market/MARKET_AND_SEGMENTATION_2026.md:3) ยังบอก `OWNER LOCK REQUIRED` และห้าม lock ICP จน owner approval ที่ [line 81](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/market/MARKET_AND_SEGMENTATION_2026.md:81) ส่วน [ICP_JTBD.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/market/ICP_JTBD.md:3) ยังเป็น `WORKING ICP — OWNER + PILOT VALIDATION REQUIRED`

   แต่ PD-001 ถูกบันทึกว่า owner-approved แล้วที่ [PRODUCT_DECISIONS.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/PRODUCT_DECISIONS.md:13) ต้องแยก “owner-approved working product ICP” ออกจาก “pilot-validated ICP” ให้ชัด.

2. **Incident playbooks ไม่แยก Cloudflare deployment failure และ DB degradation ตามรายการบังคับ**

   Brief ระบุสองเหตุการณ์นี้โดยตรงที่ [BK-0 brief](D:/AI-Workspace/projects/saas-product-hub/products/booking/BRIEF-BK0-PRODUCT-DOCUMENTATION-AND-MARKET-LOCK-2026-08-28.md:254) แต่ [INCIDENT_RUNBOOK.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/operations/INCIDENT_RUNBOOK.md:14) รวมบางส่วนไว้ใน public-outage/auth-Supabase prose โดยไม่มี deployment-error playbook หรือ DB degradation/recovery checks ที่ชัดเจน.

3. **Self-audit สรุป blockers ไม่ครบ**

   [DOCUMENTATION_AUDIT.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/audit/DOCUMENTATION_AUDIT.md:26) ระบุ final price, auto-slip economics, RTO/RPO/retention และ legal review แต่ไม่กล่าวถึง `past_due` grace duration ที่ยัง pending ใน [04_PRICING_ENTITLEMENTS.md](D:/AI-Workspace/projects/saas-product-hub/products/booking/docs/04_PRICING_ENTITLEMENTS.md:48)

## Pending-value judgment

BK-0 สามารถผ่านได้ในหลักการแม้ final public price, exact auto-slip allowance, final RTO/RPO, retention durations และ qualified legal review ยัง pending หากทุกเอกสารเรียกสถานะเหล่านั้นเหมือนกันและ block pilot/public sale ตามระดับความเสี่ยงอย่างชัดเจน การ invent ตัวเลขเพื่อให้ดู complete จะยิ่งผิดกว่าเดิม.

แต่ repository ชุดนี้ยังผ่านไม่ได้ เพราะ market gate และ operations deliverables ยังไม่ครบ และ staff/ticket authorization กับ traceability ยังไม่เป็น contract ที่ชัดเจน ปัญหาเหล่านี้เป็น documentation defects ไม่ใช่เพียง BK-A implementation gaps.

BLOCKED
