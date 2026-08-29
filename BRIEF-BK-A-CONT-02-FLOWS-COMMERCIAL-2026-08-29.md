# BRIEF — BK-A Continuation 02: Flows + LINE + Commercial Truth

**Repo:** `D:\AI-Workspace\projects\saas-product-hub\products\booking`
**Branch:** `feature/bk-a-v1-contract-remediation`
**Start from:** latest local commit produced by Continuation 01
**Purpose:** ตรวจและแก้ flow ผู้ใช้/integration/copy ที่ Codex ทำไว้แล้ว โดยไม่รื้อ security scope ที่ปิดจากรอบก่อน

## Start rules
- ต้องต่อจาก Continuation 01; ห้ามย้อนกลับ `main`
- ห้าม reset/clean งานเดิม
- `.claude/settings.local.json` ห้าม add/commit
- ห้าม push / merge / deploy
- อ่าน evidence ล่าสุดก่อนแก้

## Scope เท่านั้น
ตรวจ BK-A3, A4, A5, A6, A8, A9, A10, A11, A13, A14:
- monthly-only billing + ไม่มี annual path
- เลิก legacy paid 100/500 booking wall
- central trial LINE vs merchant-owned paid LINE
- confirmation + reminder + retry/failure evidence
- controlled PromptPay QR; ไม่มี `promptpay.io`
- customer cancel/reschedule
- completed/no-show + audit/events
- owner CSV export + closure request
- ลบ claim เกินจริง
- provisional pricing surfaces ต้องไม่สื่อว่าเป็น final price

## Focus checks
- invalid LINE signature ต้อง reject; send failure ห้ามเปลี่ยน booking state
- notification retry ต้อง idempotent และ cancelled booking ไม่ควรถูก reminder ต่อ
- PromptPay recipient/amount invalid ต้อง fail safely
- reschedule collision/policy failure ต้องรักษาคิวเดิม
- cancel/reschedule authorization ต้องไม่เปิด booking คนอื่น
- completed/no-show ต้อง owner/admin only และ transition ผิดต้อง reject
- CSV ต้อง owner-only + tenant-scoped + ไม่มี secret/internal platform data
- checkout ต้อง monthly Basic/Pro เท่านั้น
- UI/copy ต้องไม่มี annual ฿4,900/฿9,900, legacy 100/500 value wall หรือ `ปลอดภัย 100%`

## Owner blockers ห้ามเดา
- final Basic/Pro public price
- final auto-slip provider/allowance/top-up
- managed LINE cost model
- final `past_due` grace
- legal/privacy interpretation ใหม่

ถ้าจุดไหนต้องใช้ owner decision ให้คง engineering boundary ที่ปลอดภัยและบันทึก blocker อย่าแต่งค่าเอง

## Testing ในรอบนี้
รัน targeted tests ของ scope แล้วรัน:
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`

เพิ่ม/แก้ test เฉพาะที่จำเป็นต่อ negative path ของ scope นี้ อย่าขยายไป architecture ใหม่

## Evidence + stop
อัปเดต evidence เพิ่มหัวข้อ `Continuation 02` โดยบอก requirement ที่พิสูจน์ได้จริงและจุดที่ยัง DB/provider-blocked

อนุญาต local commit หลังผ่าน non-DB tests เช่น:
`fix(booking): complete BK-A customer and commercial flows`

จากนั้น STOP และรายงาน final SHA + tests + blockers
ห้ามเริ่ม independent review ในรอบนี้
