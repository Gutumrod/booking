# Product Catalog Module — Technical Brief

> **Status:** ⬜️ Planned · **Priority:** P1 · **Registry #:** 19
> **แนวคิดหลัก:** Core Module ต้องไม่รู้ว่า Data หรือ Image ถูกเก็บไว้ที่ Provider ไหน

สร้างโมดูลกลางสำหรับจัดการข้อมูลสินค้าแบบ Reusable — ไม่ผูกกับโปรเจกต์ใดโปรเจกต์หนึ่ง และต้องสามารถเลือกปลายทางเก็บ **ข้อมูลสินค้า** กับ **รูปสินค้า** แยกออกจากกันได้

โมดูลนี้ต้องนำไปใช้กับระบบร้านค้า, LIFF Commerce, SaaS, Affiliate Catalog, Backoffice หรือโปรเจกต์อื่นในอนาคตได้โดยไม่ต้องแก้ Core Logic ใหม่

```
Product Catalog Module
│
├─ Product Logic
├─ Data Storage Adapter
└─ Image Storage Adapter

Core Module ต้องไม่รู้ว่า Data หรือ Image ถูกเก็บไว้ที่ Provider ไหน
```

---

## 1. Scope

โมดูลต้องรองรับ:
- เพิ่มสินค้า · อ่านข้อมูลสินค้า · แก้ไขสินค้า · Archive / Delete สินค้า
- ค้นหา · Filter · Pagination
- Bulk Import · Bulk Export
- จัดการหมวดหมู่ · จัดการแบรนด์ · จัดการ Variant · Custom Attributes
- Upload รูป · ลบรูป · เปลี่ยนรูปหลัก · เรียงลำดับรูป
- เลือก Data Storage Provider · เลือก Image Storage Provider

**ไม่รวม** (ต้องเป็น Module แยกที่เรียกใช้ Product Catalog ผ่าน Contract กลาง):
Cart · Checkout · Order · Payment · Booking · Shipping · Promotion Engine · Recommendation Engine · AI Agent

---

## 2. Architecture

```
Application
    │
    ▼
Product Catalog Service
    │
    ├───────────────────────────┐
    │                           │
    ▼                           ▼
Product Repository         Media Storage
Interface                  Interface
    │                           │
    ▼                           ▼
Adapters                    Adapters
│                           │
├─ CSV                     ├─ Local
├─ Supabase                ├─ Cloudflare R2
├─ PostgreSQL              ├─ Supabase Storage
└─ Custom API              └─ S3-compatible
```

**Core Service ห้าม import SDK ของ Provider โดยตรง**

| ❌ ผิด | ✅ ถูก |
|--------|--------|
| `ProductService → supabase.from(...)` | `ProductService → ProductRepository.create(...)` (Adapter เป็นคนจัดการ Provider) |

---

## 3. Product Domain Model

Product ต้องมี Schema กลางขั้นต่ำ:

```
Product
id | sku | name | slug | description | short_description
status | brand_id | category_id
price | compare_at_price | cost_price | currency
stock_quantity | track_inventory
is_active | is_featured | primary_image
attributes | metadata
created_at | updated_at | archived_at
```

**Product Status (ขั้นต่ำ):** `draft` · `active` · `inactive` · `archived`

> 🚫 **ห้าม Hard Delete เป็น Default** — Default behavior ต้องเป็น Archive
> Hard Delete ให้มีเป็น Administrative Action แยก

---

## 4. Custom Attributes

ห้ามออกแบบ Product Schema ให้ผูกกับธุรกิจใดธุรกิจหนึ่ง

ตัวอย่าง Motorcycle:
```json
{ "vehicle_brand": "Honda", "vehicle_model": "ADV350", "year_from": 2022, "year_to": 2026, "material": "steel" }
```

ตัวอย่างเสื้อ:
```json
{ "material": "cotton", "gender": "unisex" }
```

Custom Attributes ต้องรองรับอย่างน้อย: `string` · `number` · `boolean` · `date` · `enum` · `multi_enum`

> Attribute ที่ต้อง Query/Filter หนักในอนาคต ต้องสามารถ Promote ออกเป็น Normalized Table ได้
> 🚫 **ห้ามออกแบบระบบให้ทุกอย่างพึ่ง JSON อย่างเดียว**

---

## 5. Product Variants

Product หนึ่งรายการสามารถมีหลาย Variant (และสามารถไม่มี Variant ได้ด้วย)

```
Variant Schema:
id | product_id | sku | name | price | compare_at_price
stock_quantity | attributes | is_active | created_at | updated_at
```

ตัวอย่าง: เสื้อ KMO → Black/M · Black/L · Yellow/M · Yellow/L

---

## 6. Brand

```
Schema: id | name | slug | description | logo_url | is_active | created_at | updated_at
```
Product สามารถไม่มี Brand ได้

---

## 7. Category

Category ต้องรองรับ **Hierarchy** (เช่น Motorcycle Accessories → Crash Bar / Rear Rack / Side Rack / Lighting)

```
Schema: id | parent_id | name | slug | description | image_url | sort_order | is_active | created_at | updated_at
```
⚠️ ต้องป้องกัน **Circular Parent Relationship**

---

## 8. Product Image Model

> 🚫 **ห้ามเก็บแค่ Array URL ใน Product Record อย่างเดียว** — ต้องมี Media Entity

```
ProductImage
id | product_id | storage_provider | storage_key | public_url
file_name | mime_type | file_size | width | height
alt_text | sort_order | is_primary | created_at
```

เหตุผล: เปลี่ยน Provider ได้ · ลบไฟล์ได้ถูกต้อง · Track Metadata · เรียงรูป · ตั้ง Primary Image · Migrate Storage ในอนาคต

---

## 9. Data Storage Interface (Contract กลาง)

```
ProductRepository
createProduct() · getProductById() · getProductBySku()
updateProduct() · archiveProduct() · restoreProduct() · deleteProduct()
listProducts() · searchProducts()
createVariant() · updateVariant() · deleteVariant()
createBrand() · updateBrand() · deleteBrand() · listBrands()
createCategory() · updateCategory() · deleteCategory() · listCategories()
bulkCreate() · bulkUpdate() · exportProducts()
```

🚫 Contract **ห้ามมีชื่อ Provider** เช่น `saveToSupabase()` / `writeCsv()`

---

## 10. Image Storage Interface (Contract กลาง)

```
MediaStorage
upload() · delete() · exists() · getPublicUrl() · getMetadata() · move() · copy()
```

**Input ขั้นต่ำ:** `file` · `file_name` · `content_type` · `path` · `metadata`
**Output กลาง:** `storage_provider` · `storage_key` · `public_url` · `file_size` · `content_type` · `metadata`

---

## 11. CSV Adapter

CSV ต้องเป็น **First-Class Storage Adapter** — ไม่ใช่แค่ Import/Export Utility — ใช้เป็น Data Store จริงสำหรับโปรเจกต์เล็กได้

```
/data
├─ products.csv
├─ variants.csv
├─ brands.csv
├─ categories.csv
└─ product_images.csv
```

รองรับ: Create · Read · Update · Archive · Search · Filter · Import · Export

**ข้อกำหนด:**
- Atomic write
- File locking / mechanism ป้องกัน write ชนกัน
- Backup ก่อน overwrite
- UTF-8 · รองรับภาษาไทย
- Header validation · Schema validation · Duplicate SKU validation
- Safe recovery เมื่อไฟล์เสีย

> ⚠️ CSV Adapter **ไม่เหมาะกับ High Concurrency** — ต้อง Document limitation ชัดเจน

---

## 12. Supabase Adapter

ใช้ Repository Contract เดียวกับ CSV รองรับ: PostgreSQL · RLS · Pagination · Search · Filter · Transaction · Indexing

> ห้าม Business Logic อยู่ใน Adapter มากเกินไป — Adapter มีหน้าที่แปลง Domain Model ↔ Storage Model

---

## 13. PostgreSQL Adapter

Interface รองรับ PostgreSQL ธรรมดา **โดยไม่พึ่ง Supabase SDK** — Implementation อาจใช้ Driver หรือ ORM ตาม Environment ของโปรเจกต์ปลายทาง
> 🚫 ห้ามทำให้ Supabase เป็น Dependency ของ Core

---

## 14. Custom API Adapter

ต่อเข้าระบบภายนอกผ่าน HTTP API (GET/POST /products, PATCH/DELETE /products/:id)

รองรับ: Authentication injection · Timeout · Retry (เฉพาะกรณี Safe) · Error mapping · Rate limit handling · Logging
> 🚫 ห้าม Hard-code Credentials

---

## 15. Local Image Storage

ใช้สำหรับ: Development · Testing · Small local deployment

ตัวอย่าง: `/uploads/products/{product_id}/{uuid}.jpg`

ต้อง: Sanitize filename · ป้องกัน path traversal · จำกัด file size · Validate MIME type · สร้าง unique filename

---

## 16. Cloudflare R2 Adapter

รองรับ: Upload · Delete · Public URL / Signed URL · Custom Domain · Metadata

ต้องแยก `bucket` · `endpoint` · `access_key` · `secret_key` · `public_base_url` ออกจาก Code — ใช้ Environment / Runtime Config เท่านั้น

---

## 17. Supabase Storage Adapter

รองรับ: Upload · Delete · Public bucket · Private bucket · Signed URL
> Provider-specific code ต้องอยู่ใน Adapter เท่านั้น

---

## 18. S3-Compatible Adapter

ออกแบบให้รองรับ S3-compatible API (AWS S3 · MinIO · Backblaze B2 · Cloudflare R2 · อื่นๆ) — R2 มี Adapter เฉพาะแยกได้หากต้องใช้ Feature เพิ่มเติม

---

## 19. Storage Profile

แต่ละโปรเจกต์กำหนด Storage Profile ได้ — **ห้ามให้ผู้ใช้ Module ต้องแก้ Source Code เพื่อเปลี่ยน Provider**

```yaml
product_catalog:
  data_storage:
    provider: csv
    options: { directory: ./data }
  image_storage:
    provider: cloudflare_r2
    options: { bucket: product-images }
```

---

## 20. Environment Configuration

Credential ต้องอยู่ใน Environment Variables / Secret Store เท่านั้น:

```
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
```

🚫 ห้าม: Commit secret · ใส่ secret ลง YAML ที่ commit · Log secret · Return secret ผ่าน API

---

## 21. Image Validation

ก่อน Upload ตรวจ: MIME Type · File Extension · Maximum File Size · Image Dimensions · Corrupted Image

MVP รองรับ: JPEG · PNG · WEBP (เพิ่ม AVIF ภายหลัง)
> 🚫 ห้ามเชื่อ MIME Type จาก Client อย่างเดียว

---

## 22. Image Processing

Architecture เผื่อ Image Processor แยก:
```
Original → Validate → Resize → Optimize → Thumbnail → Storage
```
MVP ไม่จำเป็นต้องทำ Processing ครบ แต่ Interface ต้องไม่ปิดทาง

---

## 23. Bulk Import

รองรับ CSV Import — **ห้าม Import ทันทีโดยไม่ Validate**:

```
Upload → Parse → Validate → Preview → Detect Errors → Confirm → Import → Result Report
```

Report ต้องบอก: `total_rows` · `success_rows` · `failed_rows` · `warnings` · `errors` (ระบุ Row ที่มีปัญหา)

---

## 24. Bulk Export

Export Catalog กลับเป็น CSV ได้ รองรับ: All · Filtered · Selected Products
Export ต้องมี Version / Schema Metadata เพื่อให้ Import กลับได้

---

## 25. SKU Rules

- Unique ต่อ Catalog / Tenant
- Trim whitespace · Case normalization กำหนดชัด
- Validate ก่อน Save
- 🚫 ห้ามสร้าง Duplicate SKU แบบ Silent
- ถ้าไม่กรอก SKU → SKU Generator เป็น **Optional Service** (Core ห้ามบังคับรูปแบบ SKU ตายตัว)

---

## 26. Slug

Unique ภายใน Catalog · รองรับ Auto Generate · Normalize · ป้องกัน Collision

> ชื่อสินค้าเปลี่ยนแล้ว **ไม่ควรบังคับเปลี่ยน Slug อัตโนมัติ** (อาจทำ URL เสีย)

---

## 27. Search

ค้นหาขั้นต่ำ: `name` · `sku` · `brand` · `category` · `description`

Adapter implement ต่างกันได้: CSV = in-memory · Supabase/Postgres = indexed / full-text (อนาคต)

Core ใช้ Query Object กลาง:
```
ProductQuery { search, category_id, brand_id, status, min_price, max_price, in_stock, attributes, sort, page, limit }
```

---

## 28. Pagination

ห้ามโหลดทั้ง Catalog ทุกครั้ง — Contract รองรับ Pagination ตั้งแต่ต้น

Output: `items` · `page` · `limit` · `total` · `has_next` (หรือ cursor-based ใน Adapter แล้ว map กลับเป็น Response กลาง)

---

## 29. Error Model

Error กลาง (ขั้นต่ำ): `PRODUCT_NOT_FOUND` · `DUPLICATE_SKU` · `INVALID_PRODUCT_DATA` · `INVALID_VARIANT` · `INVALID_CATEGORY` · `STORAGE_ERROR` · `MEDIA_UPLOAD_FAILED` · `MEDIA_DELETE_FAILED` · `CSV_LOCKED` · `CSV_CORRUPTED` · `PROVIDER_UNAVAILABLE` · `CONFIGURATION_ERROR`

> Provider Error ห้าม Leak ออกสู่ Application ตรงๆ — ต้อง Map เป็น Domain Error

---

## 30. Logging

Structured Logging อย่างน้อย: `timestamp` · `level` · `module` · `operation` · `product_id` · `provider` · `duration_ms` · `result` · `error_code`

🚫 ห้าม Log: Credential · Secret · Raw access token
Bulk Operation ต้องมี **Operation ID** สำหรับ Trace

---

## 31. Audit Log

Interface สำหรับ Audit Event เช่น: `product.created/updated/archived/restored/deleted` · `variant.created/updated` · `image.uploaded/deleted/primary_changed` · `bulk_import.started/completed/failed`

Actor: `user` · `system` · `api` · `import`
> Core ต้องไม่บังคับ Authentication Provider ไหน

---

## 32. Multi-Tenant Readiness

Core ไม่ผูก Multi-Tenant แต่ต้องเผื่อ `tenant_id` / `catalog_id`

Query/Repository Context ต้องรับ `CatalogContext { catalog_id, tenant_id, actor_id }`
> 🚫 ห้าม Query ข้าม Tenant โดยไม่ได้ตั้งใจ
> Adapter ที่รองรับ RLS ต้องออกแบบให้ใช้งานร่วมกับ RLS ได้

---

## 33. API Layer

Module ไม่บังคับ Framework — Service Layer พร้อม expose ผ่าน REST · RPC · Server Action · Edge Function · Internal Service
> 🚫 ห้ามผูก Domain Logic กับ HTTP Request/Response

---

## 34. Folder Structure

```
product-catalog/
├─ core/
│  ├─ entities/ ├─ services/ ├─ repositories/ ├─ errors/ ├─ validators/ └─ types/
├─ adapters/
│  ├─ data/   (csv/ supabase/ postgres/ custom-api/)
│  └─ media/  (local/ r2/ supabase-storage/ s3/)
├─ import-export/ (csv/ validators/ mappers/)
├─ config/
├─ tests/ (unit/ integration/ contract/)
├─ examples/
├─ README.md
└─ MODULE.md
```

ปรับตามภาษา/Runtime ได้ แต่ Separation นี้ต้องรักษาไว้

---

## 35. Adapter Contract Tests

ทุก Adapter ต้องผ่าน Test ชุดเดียวกัน:

```
ProductRepositoryContract
✓ create product ✓ get product ✓ update product ✓ archive product ✓ restore product
✓ duplicate SKU rejected ✓ pagination works ✓ filter works ✓ search works
```

ถ้า CSV = ผ่าน และ Supabase = ผ่าน → Application ต้องสลับ Provider ได้โดย Behavior หลักไม่เปลี่ยน (Media Adapter ใช้หลักเดียวกัน)

---

## 36. Testing

ขั้นต่ำ: Unit Test (product/SKU/attribute validation, query normalization, domain errors) · Contract Test (ทุก Storage Adapter) · Integration Test (CSV read/write, image upload/delete, Supabase ถ้ามี test env) · Failure Test (provider down, upload fail, CSV corrupted, duplicate SKU, invalid image, permission denied, timeout)

---

## 37. Migration

ออกแบบ Migration Path ระหว่าง Provider (CSV → Supabase, Local → R2)

Migration ต้อง: Preserve Product ID (ถ้าทำได้) · Preserve SKU · Preserve Media Mapping · Detect Duplicate · Generate Report · Support Dry Run

> ไม่จำเป็น Implement Migration Tool เต็มใน MVP แต่ Data Model + Adapter ต้องไม่ปิดทาง

---

## 38. MVP Implementation Priority

| Phase | ขอบเขต |
|-------|--------|
| **Phase 0 — Core** | Domain Models · Product Service · Repository Interfaces · Media Interface · Validators · Errors · Configuration (ยังไม่ต่อ Provider หลายตัว) |
| **Phase 1 — CSV + Local** | CSV Data Adapter · Local Image Adapter · Product CRUD · Brand · Category · Variant · Search · Filter · Pagination (ใช้งาน Local ได้ครบก่อน) |
| **Phase 2 — Import/Export** | CSV Import · Validation · Preview · Error Report · Export |
| **Phase 3 — Supabase** | Supabase Product Adapter · Schema · Index · RLS-ready Context · Integration Tests |
| **Phase 4 — Cloudflare R2** | R2 Media Adapter · Upload · Delete · Public URL · Metadata · Error handling |
| **Phase 5 — Advanced** | PostgreSQL · S3 · Supabase Storage · Custom API (เพิ่มตามความต้องการจริง) |

> 🚫 **ห้ามทำ Provider ทุกตัวพร้อมกันตั้งแต่ MVP** — ลำดับทำจริง: Phase 0 → CSV + Local ก่อน พิสูจน์ Adapter Contract ให้แน่น แล้วค่อยลาก Supabase/R2

---

## 39. MVP Definition of Done

ถือว่า MVP เสร็จเมื่อ:
- [ ] สร้าง/แก้ไข/Archive/Restore Product ได้
- [ ] Search และ Filter ได้
- [ ] มี Brand · Category · Variant
- [ ] Upload รูปได้ · ตั้ง Primary Image ได้
- [ ] CSV เป็น Data Store จริงได้ · Local Folder เป็น Image Storage ได้
- [ ] Import CSV ได้ · Export CSV ได้
- [ ] เปลี่ยน Data Adapter โดยไม่แก้ Product Core · เปลี่ยน Image Adapter โดยไม่แก้ Product Core
- [ ] Validation ครบ · Error Handling ครบ · Structured Logging มีจริง
- [ ] Contract Tests ผ่าน

---

## 40. Non-Functional Requirements

**ต้อง:** Production-ready · Modular · Provider-agnostic · Type-safe (ถ้าภาษารองรับ) · Error handling จริง · Logging จริง · ไม่มี Hard-coded Credentials · รองรับภาษาไทย/UTF-8 · Testable · Documented · ไม่ Duplicate Business Logic ระหว่าง Adapter

**ห้าม:** ผูก Core กับ Supabase/Cloudflare · ใช้ CSV เป็นแค่ Temporary Hack · เก็บรูปเป็น Base64 ใน Product Record · Hard Delete เป็น Default · Query ทั้ง Catalog โดยไม่มี Pagination · Swallow Error · Catch แล้วไม่ Log · เก็บ Secret ใน Source Code

---

## 41. ตัวอย่างการใช้งาน

| โปรเจกต์ | Data | Images | เหมาะกับ |
|----------|------|--------|----------|
| A — Local Catalog | CSV | Local Folder | Development / ระบบเล็ก |
| B — Small Production | Supabase | Cloudflare R2 | Web Store / LIFF Store |
| C — Supabase Only | Supabase Postgres | Supabase Storage | — |
| D — External Client | Custom API | S3-compatible | — |

Application ต้องเรียก Product Catalog Service **แบบเดียวกัน** ทุกกรณี

---

## 42. หลักการสำคัญที่สุด

Product Catalog Module ต้องเป็นเจ้าของเฉพาะ: **สินค้า · หมวดหมู่ · แบรนด์ · Variant · Attribute · รูปสินค้า · Catalog Query**

มันต้อง **ไม่รู้เรื่อง**: ใครซื้อ · ซื้อกี่ชิ้น · จ่ายเงินหรือยัง · นัดวันไหน · ส่งของยังไง — เหล่านั้นเป็นหน้าที่ของ Commerce, Booking, Payment, Fulfillment Module

> เป้าหมาย: Product Catalog เป็นโมดูลกลางที่เสียบเข้ากับโปรเจกต์ใดก็ได้ โดยเปลี่ยนเพียง Configuration และ Adapter ของ Storage
