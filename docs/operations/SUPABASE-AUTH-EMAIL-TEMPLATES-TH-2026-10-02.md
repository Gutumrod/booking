# เทมเพลตอีเมลระบบ Supabase Auth (ภาษาไทย) — WSTERA

**Status:** พร้อมให้เจ้าของคัดลอกวาง (ยังไม่ได้ทดสอบส่งจริง)
**วันที่:** 2026-10-02
**ขอบเขต:** เอกสารอย่างเดียว — ไม่มี SQL ไม่มีโค้ดแอป ไม่แตะ LAB/production
**ใช้กับ:** Supabase Dashboard → Authentication → Emails → Templates

---

## 0. อ่านก่อน

- อีเมลกลุ่มนี้คืออีเมล **ระบบยืนยันตัวตน** (สมัคร / ยืนยันอีเมล / เข้าใช้งาน / เปลี่ยนอีเมล / ตั้งรหัสผ่านใหม่ / ยืนยันซ้ำ)
- ใน BK01 **ผู้จองไม่ต้องมีบัญชี** (`docs/05_BOOKING_DOMAIN_RULES.md`: การจองสาธารณะไม่ต้องมี customer account) → เทมเพลตชุดนี้ใช้กับ **เจ้าของร้าน / พนักงานร้าน** เท่านั้น
- อย่างไรก็ตาม โปรเจกต์ Supabase LAB เป็น **โปรเจกต์เดียวที่ใช้ร่วมกันกับผลิตภัณฑ์อื่นของ WSTERA** เทมเพลตจึงเป็นแบบ **ทั้งโปรเจกต์** ไม่ใช่ของ BK01 โดยเฉพาะ → ข้อความทั้งหมดจึงเป็นกลางตามแบรนด์ WSTERA **ไม่ผูกกับการจองคิว** และไม่มีคำว่า "การจอง" ในเนื้อหา
- ถ้าวันหนึ่งมีผลิตภัณฑ์อื่นเพิ่มลูกค้าที่ต้องสมัครบัญชี ข้อความชุดนี้ยังใช้ได้ทันทีโดยไม่ต้องแก้

**ห้าม**
- ห้ามใส่รูปภาพจากภายนอก (โลโก้ต้องเป็นข้อความ WSTERA เท่านั้น)
- ห้ามใส่ tracking pixel / ลิงก์ติดตาม / UTM
- ห้ามใช้คำที่ตัวกรองขยะไม่ชอบ: ฟรี, ด่วน, คลิกเลย, 100%, ตัวพิมพ์ใหญ่ทั้งบรรทัด, เครื่องหมายอัศเจรีย์
- ห้ามคิดตัวแปรเทมเพลตขึ้นเอง — ใช้เฉพาะตัวแปรที่ Supabase รองรับ (ดูข้อ 4 และ `docs/08_EXTERNAL_DEPENDENCIES.md`)

---

## 1. วางที่ไหน (ทีละขั้น)

1. เข้า Supabase Dashboard → เลือกโปรเจกต์ **LAB** (`wstera-lab`)
2. เมนูซ้าย → **Authentication** → แท็บ **Emails**
3. ตรวจครึ่งบนของหน้า **SMTP Settings** (ตั้งไว้แล้ว ไม่ต้องแก้):
   - Sender email: `notifications@mail.wstera.com` (ส่งผ่าน Resend, `smtp.resend.com:465`)
   - Sender name: ใส่ `WSTERA` ถ้ายังว่าง
4. เลื่อนลงมาที่ **Templates** → จะมีรายการเทมเพลตให้เลือกทีละตัว (ดูชื่อในข้อ 2)
5. เลือกเทมเพลต 1 ตัว → **ช่อง Subject** วาง "Subject" ของตัวนั้น → **ช่อง Message body** สลับไปมุมมอง **Source / HTML** แล้ววางบล็อก HTML ของตัวนั้นทั้งบล็อก
6. กด **Save** → ทำซ้ำตั้งแต่ข้อ 5 จนครบทุกตัว
7. เปิด `Supabase/config.toml` ดูบรรทัด `otp_length = 6` (รหัสยืนยันยาว 6 หลัก) และ `otp_expiry = 3600` (หมดอายุ 1 ชั่วโมง) — ถ้าแก้ค่านี้ในอนาคต ต้องแก้ข้อความในเทมเพลตที่บอกเรื่องรหัส/อายุด้วย

> หมายเหตุ: เทมเพลตแก้ผ่าน Dashboard ได้เฉพาะโปรเจกต์ hosted (LAB) เท่านั้น ส่วน local dev/self-hosted ต้องแก้ผ่าน `supabase/config.toml`

---

## 2. ชื่อเทมเพลต: ที่เจ้าของเห็นใน Dashboard ↔ ที่ใช้ในเอกสารนี้

| ชื่อใน Supabase Dashboard | ใช้เมื่อไร | กลุ่มผู้ใช้ |
|---|---|---|
| Confirm signup | สมัครบัญชีใหม่ ต้องยืนยันอีเมล | เจ้าของร้าน |
| Invite user | เจ้าของ/แอดมินเชิญผู้ใช้เข้าระบบ | เจ้าของร้าน / พนักงาน |
| Magic link | เข้าใช้งานด้วยลิงก์ทางอีเมล (ไม่ใช้รหัสผ่าน) | เจ้าของร้าน / พนักงาน |
| Change email address | ขอเปลี่ยนอีเมลของบัญชี | เจ้าของร้าน / พนักงาน |
| Reset password | ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ | เจ้าของร้าน / พนักงาน |
| Reauthentication | ยืนยันซ้ำก่อนทำรายการสำคัญ (ได้รหัส ไม่ใช่ลิงก์) | เจ้าของร้าน / พนักงาน |
| Password changed *(แจ้งเตือนความปลอดภัย)* | แจ้งว่ารหัสผ่านเพิ่งถูกเปลี่ยน | เจ้าของร้าน / พนักงาน |
| Email address changed *(แจ้งเตือนความปลอดภัย)* | แจ้งว่าอีเมลของบัญชีเพิ่งถูกเปลี่ยน | เจ้าของร้าน / พนักงาน |

> เทมเพลต "แจ้งเตือนความปลอดภัย" 2 ตัวท้าย **ต้องเปิดใช้งานระดับโปรเจกต์ก่อน** จึงจะส่งออก (ใน Dashboard/Management API คือกลุ่ม `mailer_notifications_*_enabled`) ถ้าไม่เปิด ระบบจะไม่ส่งอีเมลแจ้งเตือนความปลอดภัยเลย

---

## 3. เทมเพลตทั้ง 8 ตัว (คัดลอกวางได้ทั้งบล็อก)

ทุกบล็อกใช้ HTML เรียบง่าย + inline style เท่านั้น (ไม่มี CSS ภายนอก ไม่มีรูป) และมีสองบรรทัดนี้เหมือนกันทุกตัว:

- `ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ`
- `ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร`

### 3.1 Confirm signup — ยืนยันอีเมลสมัคร

**Subject**
```
ยืนยันอีเมลสำหรับ WSTERA
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีคำขอสร้างบัญชี WSTERA ด้วยอีเมลนี้: {{ .Email }}</p>
  <p style="margin:0 0 22px">กดปุ่มด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานบัญชี</p>

  <p style="margin:0 0 24px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 20px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">ยืนยันอีเมล</a>
  </p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">ถ้าปุ่มด้านบนใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>
  <p style="margin:0 0 20px;font-size:13px;color:#3e4c59;word-break:break-all">{{ .ConfirmationURL }}</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

---

### 3.2 Invite user — เชิญผู้ใช้เข้าระบบ

**Subject**
```
คำเชิญเข้าใช้งาน WSTERA
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีผู้เชิญอีเมลนี้: {{ .Email }} ให้เข้าใช้งานระบบ WSTERA</p>
  <p style="margin:0 0 22px">กดปุ่มด้านล่างเพื่อตอบรับคำเชิญและตั้งค่าบัญชีของคุณ</p>

  <p style="margin:0 0 24px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 20px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">ตอบรับคำเชิญ</a>
  </p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">ถ้าปุ่มด้านบนใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>
  <p style="margin:0 0 20px;font-size:13px;color:#3e4c59;word-break:break-all">{{ .ConfirmationURL }}</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

---

### 3.3 Magic link — เข้าใช้งานด้วยลิงก์ทางอีเมล

**Subject**
```
ลิงก์เข้าใช้งาน WSTERA
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีคำขอเข้าใช้งาน WSTERA ด้วยอีเมลนี้: {{ .Email }}</p>
  <p style="margin:0 0 22px">กดปุ่มด้านล่างเพื่อเข้าใช้งาน ระบบจะพาคุณไปที่หน้าเว็บของ WSTERA</p>

  <p style="margin:0 0 24px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 20px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">เข้าใช้งาน</a>
  </p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">ถ้าปุ่มด้านบนใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>
  <p style="margin:0 0 20px;font-size:13px;color:#3e4c59;word-break:break-all">{{ .ConfirmationURL }}</p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">หรือกรอกรหัสยืนยันนี้ในหน้าเว็บ</p>
  <p style="margin:0 0 20px;font-size:20px;letter-spacing:.16em;color:#1f2933">{{ .Token }}</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

---

### 3.4 Change email address — ยืนยันอีเมลใหม่

**Subject**
```
ยืนยันอีเมลใหม่ของ WSTERA
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีคำขอเปลี่ยนอีเมลของบัญชี WSTERA จาก {{ .Email }} เป็นอีเมลใหม่นี้: {{ .NewEmail }}</p>
  <p style="margin:0 0 22px">กดปุ่มด้านล่างเพื่อยืนยันอีเมลใหม่</p>

  <p style="margin:0 0 24px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 20px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">ยืนยันอีเมลใหม่</a>
  </p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">ถ้าปุ่มด้านบนใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>
  <p style="margin:0 0 20px;font-size:13px;color:#3e4c59;word-break:break-all">{{ .ConfirmationURL }}</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

> หมายเหตุ: `{{ .NewEmail }}` ใช้ได้เฉพาะเทมเพลตนี้เท่านั้น

---

### 3.5 Reset password — ตั้งรหัสผ่านใหม่

**Subject**
```
ตั้งรหัสผ่านใหม่สำหรับ WSTERA
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี WSTERA ที่ใช้อีเมลนี้: {{ .Email }}</p>
  <p style="margin:0 0 22px">กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่</p>

  <p style="margin:0 0 24px">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 20px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">ตั้งรหัสผ่านใหม่</a>
  </p>

  <p style="margin:0 0 8px;font-size:13px;color:#52606d">ถ้าปุ่มด้านบนใช้ไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์</p>
  <p style="margin:0 0 20px;font-size:13px;color:#3e4c59;word-break:break-all">{{ .ConfirmationURL }}</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

---

### 3.6 Reauthentication — ยืนยันซ้ำด้วยรหัส

เทมเพลตนี้ **ไม่มีลิงก์** ใช้รหัสเท่านั้น

**Subject**
```
รหัสยืนยัน WSTERA: {{ .Token }}
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">มีคำขอยืนยันตัวตนซ้ำสำหรับบัญชี WSTERA ที่ใช้อีเมลนี้: {{ .Email }}</p>
  <p style="margin:0 0 10px">กรอกรหัสด้านล่างในหน้าที่เปิดค้างไว้</p>

  <p style="margin:0 0 18px;font-size:26px;letter-spacing:.18em;color:#1f2933">{{ .Token }}</p>

  <p style="margin:0 0 20px;font-size:13px;color:#52606d">รหัสนี้มีอายุ 1 ชั่วโมง และใช้ได้ครั้งเดียว</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated message from WSTERA. If you did not request it, no action is needed.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

> "อายุ 1 ชั่วโมง" ตรงกับ `otp_expiry = 3600` ใน `supabase/config.toml` — ถ้าแก้ค่านั้น ต้องแก้ข้อความนี้ด้วย

---

### 3.7 Password changed — แจ้งเตือนความปลอดภัย (แนะนำให้ตั้ง)

เทมเพลตนี้ **ไม่มีลิงก์ยืนยัน** และไม่มีตัวแปรเฉพาะ

**Subject**
```
รหัสผ่าน WSTERA ถูกเปลี่ยน
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">รหัสผ่านของบัญชี WSTERA ที่ผูกกับอีเมล {{ .Email }} เพิ่งถูกเปลี่ยน</p>
  <p style="margin:0 0 20px">ถ้าเป็นคุณเอง ไม่ต้องทำอะไร</p>
  <p style="margin:0 0 22px">ถ้าไม่ใช่คุณ ให้ตั้งรหัสผ่านใหม่ที่หน้าเว็บ WSTERA และแจ้งผู้ดูแลระบบทันที</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated security notice from WSTERA.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

---

### 3.8 Email address changed — แจ้งเตือนความปลอดภัย (แนะนำให้ตั้ง)

**Subject**
```
อีเมลของบัญชี WSTERA ถูกเปลี่ยน
```

**Message (HTML)**
```html
<div style="font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.7;color:#1f2933;max-width:560px">
  <p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;color:#52606d">WSTERA</p>

  <p style="margin:0 0 14px">สวัสดีครับ/ค่ะ</p>
  <p style="margin:0 0 14px">อีเมลของบัญชี WSTERA เพิ่งถูกเปลี่ยนจาก {{ .OldEmail }} เป็น {{ .Email }}</p>
  <p style="margin:0 0 20px">ถ้าเป็นคุณเอง ไม่ต้องทำอะไร</p>
  <p style="margin:0 0 22px">ถ้าไม่ใช่คุณ ให้แจ้งผู้ดูแลระบบทันที เพราะอีเมลนี้ใช้สำหรับกู้คืนบัญชี</p>

  <p style="margin:0 0 20px">ถ้าไม่เห็นอีเมลนี้ในกล่องหลัก ลองดูในจดหมายขยะ และกดไม่ใช่ขยะ</p>

  <p style="margin:0 0 22px;font-size:13px;color:#52606d">ถ้าคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร</p>

  <hr style="border:0;border-top:1px solid #e4e7eb;margin:0 0 14px">

  <p style="margin:0 0 4px;font-size:12px;color:#7b8794">This is an automated security notice from WSTERA.</p>
  <p style="margin:0;font-size:12px;color:#7b8794">{{ .SiteURL }}</p>
</div>
```

> หมายเหตุ: `{{ .OldEmail }}` ใช้ได้เฉพาะเทมเพลตนี้เท่านั้น (อีเมลเดิมจะไม่ถูกส่งแยกไปหาที่อยู่อีเมลเดิม)

---

## 4. ตัวแปรที่ใช้ (สรุป — ห้ามใช้ตัวแปรนอกตารางนี้)

ตัวแปรที่ Supabase เปิดให้ใช้ **ทุกเทมเพลต**: `{{ .ConfirmationURL }}` · `{{ .Token }}` · `{{ .TokenHash }}` · `{{ .SiteURL }}` · `{{ .RedirectTo }}` · `{{ .Data }}` · `{{ .Email }}`

ตัวแปรที่ **ใช้ได้เฉพาะเทมเพลตเดียว**:

| ตัวแปร | ใช้ได้เฉพาะ |
|---|---|
| `{{ .NewEmail }}` | Change email address |
| `{{ .OldEmail }}` | Email address changed |
| `{{ .Phone }}` · `{{ .OldPhone }}` | Phone number changed |
| `{{ .Provider }}` | Sign-in method linked / removed |
| `{{ .FactorType }}` | Verification method added / removed |

**ตัวแปรที่เอกสารนี้ใช้จริง**

| เทมเพลต | ตัวแปรที่ใช้ |
|---|---|
| Confirm signup | `{{ .ConfirmationURL }}` · `{{ .Email }}` · `{{ .SiteURL }}` |
| Invite user | `{{ .ConfirmationURL }}` · `{{ .Email }}` · `{{ .SiteURL }}` |
| Magic link | `{{ .ConfirmationURL }}` · `{{ .Token }}` · `{{ .Email }}` · `{{ .SiteURL }}` |
| Change email address | `{{ .ConfirmationURL }}` · `{{ .Email }}` · `{{ .NewEmail }}` · `{{ .SiteURL }}` |
| Reset password | `{{ .ConfirmationURL }}` · `{{ .Email }}` · `{{ .SiteURL }}` |
| Reauthentication | `{{ .Token }}` · `{{ .Email }}` · `{{ .SiteURL }}` (ไม่มีลิงก์) |
| Password changed | `{{ .Email }}` · `{{ .SiteURL }}` (ไม่มีลิงก์) |
| Email address changed | `{{ .OldEmail }}` · `{{ .Email }}` · `{{ .SiteURL }}` (ไม่มีลิงก์) |

> `{{ .Token }}` เป็นรหัสตัวเลขสั้นที่ Supabase สร้างให้ ถ้าโปรเจกต์ปิดการยืนยันด้วยรหัสไว้ บรรทัดรหัสอาจว่างเปล่า — ในกรณีนั้นให้ลบบรรทัดรหัสออกจากเทมเพลต Magic link ได้ (Confirm signup ไม่ได้ใส่รหัสไว้แล้ว จึงไม่มีปัญหานี้)

---

## 5. ทดสอบอย่างไร (ทำใน LAB เท่านั้น)

1. Dashboard → **Authentication** → **Users** → ปุ่ม **Add user** → เลือก **Send invitation**
2. ใส่อีเมลทดสอบของตัวเอง (แนะนำ Gmail หรือ Outlook) → ส่ง
3. เปิดกล่องอีเมล → ดู **กล่องหลักก่อน** แล้วเปิด **จดหมายขยะ**
4. กดลิงก์ในอีเมล → ต้องกลับเข้าเว็บ WSTERA ได้ และไม่มีคำเตือนความปลอดภัยของเบราว์เซอร์
5. ถ้าตกจดหมายขยะ → กด **ไม่ใช่จดหมายขยะ / Report not spam** เพื่อสอนตัวกรอง แล้วส่งซ้ำอีก 1 ครั้งเพื่อดูว่ากลับเข้ากล่องหลักหรือยัง
6. ทดสอบตัวอื่น: Reset password (ใช้ผู้ใช้ทดสอบเดิม กด *Send recovery*), Change email (เปลี่ยนอีเมลผู้ใช้ทดสอบ), Reauthentication / Magic link (ตามที่หน้าเว็บเรียกใช้)
7. ตรวจว่าเทมเพลตที่ตั้งเป็นภาษาไทยจริง: เปิดอีเมลที่ได้ → Subject ต้องมีคำว่า WSTERA → เนื้อหาต้องเป็นไทย และบรรทัด EN อยู่ท้ายสุด
8. **ทำความสะอาด:** กลับไปที่ **Users** → ลบผู้ใช้ทดสอบออก (Delete user) เพื่อไม่ให้เหลือบัญชีค้างใน LAB
9. เก็บหลักฐาน: วันที่ทดสอบ + อีเมลผู้รับ + ผลว่าเข้ากล่องหลักหรือจดหมายขยะ (แนบให้ผู้คุมได้)

---

## 6. คำเตือนความปลอดภัย (สำคัญ)

- **อย่าส่งต่อไฟล์อีเมลหรือข้อความที่มีลิงก์ยืนยันให้ใคร** — ทั้งไฟล์ `.eml`, ข้อความที่ forward, ภาพหน้าจอที่มีลิงก์ หรือวางลิงก์ลงแชต ลิงก์ยืนยันใช้แทนตัวตนได้ ใครได้ลิงก์ถือว่าเข้าใช้งานบัญชีนั้นได้
- การคัดลอกเทมเพลตไปวางเป็นข้อความธรรมดาก็ปลอดภัย เพราะเป็น HTML เปล่า ไม่มีลิงก์ของจริง (ลิงก์จริงเกิดตอนระบบส่ง)
- อย่าแปะค่า SMTP password / API key ของ Resend ลงในเอกสาร ภาพหน้าจอ หรือแชต
- ถ้าสงสัยว่าลิงก์ยืนยันรั่ว → แจ้งผู้คุมทันที และตั้งรหัสผ่านใหม่ให้บัญชีนั้น

---

## 7. ลดการตก "จดหมายขยะ" (สาเหตุรอบแรก + สิ่งที่แก้)

สาเหตุที่เมลรอบแรกลงขยะ: โดเมนใหม่ยังไม่มีชื่อเสียง + เทมเพลตเริ่มต้นเป็นอังกฤษล้วนไม่มีแบรนด์ + ลิงก์ชี้ไปที่ `supabase.co`

สิ่งที่เทมเพลตชุดนี้แก้: ภาษาไทย + มีชื่อ WSTERA ชัดในหัวข้อและเนื้อหา + ไม่มีรูปภายนอก + ไม่มี tracking + ไม่มีคำที่ตัวกรองขยะจับ

สิ่งที่ต้องทำฝั่งโดเมน (นอกเอกสารนี้ ทำที่ผู้ให้บริการ DNS/Resend):

- [ ] ตั้ง SPF, DKIM และ DMARC ครบสำหรับโดเมน `mail.wstera.com` ให้ Resend
- [ ] ชื่อผู้ส่ง (Sender name) = `WSTERA` ให้ตรงกันทุกฉบับ
- [ ] อย่าเพิ่งส่งปริมาณมากจากโดเมนใหม่ ให้ค่อย ๆ เพิ่ม
- [ ] ขอให้ผู้รับกด "ไม่ใช่จดหมายขยะ" ทุกครั้งที่ตกขยะ
- [ ] อย่าเปลี่ยนหัวข้อ/เนื้อหาบ่อย ๆ ในช่วงแรก

> SPF/DKIM/DMARC เป็นงานฝั่งผู้ดูแลระบบ ไม่ใช่การแก้เทมเพลต ต้องยืนยันจากคอนโซลจริงก่อนสรุปว่าหายจากจดหมายขยะ

---

## 8. สถานะที่ยังไม่ได้ยืนยัน (UNMEASURED)

- เอกสารนี้ยัง **ไม่ได้ทดสอบส่งอีเมลจริง** — ไม่ได้แตะ LAB ไม่ได้ตั้งค่าใน Dashboard ตามคำสั่งงาน
- ยังไม่ยืนยันว่า `{{ .Token }}` แสดงในเมล Magic link ของโปรเจกต์นี้จริงหรือไม่ (ถ้าว่างให้ลบบรรทัดรหัสตามหมายเหตุข้อ 4)
- ยังไม่ยืนยันค่า SPF/DKIM/DMARC จริงของ `mail.wstera.com`
- ยังไม่ยืนยันว่ามีการส่งอีเมลแจ้งเตือนความปลอดภัยจากระบบจริงหรือไม่ (ต้องเปิด `mailer_notifications_*_enabled` ก่อน)
- ข้อความทั้งหมดเป็น **ร่างให้เจ้าของอนุมัติ** ไม่ใช่ข้อความที่ผ่านการตรวจทางกฎหมาย

---

**แปะให้: Claude ผู้คุม** — เอกสารนี้เป็น docs-only รอเจ้าของวางใน Dashboard และทดสอบจริงก่อนสรุปผล
