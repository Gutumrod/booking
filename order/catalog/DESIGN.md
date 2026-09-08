# Product Catalog Module — DESIGN.md

**Version:** 0.1.0
**Status:** ✅ Completed
**Documentation Authority:** Current version/status follow `../REGISTRY.md`; this document describes the module contract/design for that registered version.

**Language / runtime:** TypeScript, ES2022, strict mode, `moduleResolution: Bundler`. Runs on Node.js, Bun, Cloudflare Workers, and Edge Runtimes (zero runtime env assumptions in core).

---

## 1. Purpose & Architectural Boundary

The **Product Catalog Module** is a standalone, reusable, provider-agnostic domain engine for managing products, variants, brands, categories, custom attributes, and product media assets across the Module Hub monorepo.

### 1.1 Layered Architecture

The system enforces a strict unidirectional dependency graph. High-level domain logic in `ProductCatalogService` depends exclusively on abstract interfaces (`ProductRepository` and `MediaStorage`), never on concrete storage implementations.

```
+-------------------------------------------------------------------+
|                        Host Application                           |
|       (Next.js, Express, Fastify, Cloudflare Worker, CLI)         |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
|                     ProductCatalogService                         |
|  (Domain validation, SKU/Slug normalization, Hierarchy, Audit)    |
+-------------------------------------------------------------------+
               |                                      |
               v                                      v
+------------------------------+      +------------------------------+
|     ProductRepository        |      |        MediaStorage          |
|         Interface            |      |          Interface           |
+------------------------------+      +------------------------------+
               |                                      |
               v                                      v
+------------------------------+      +------------------------------+
|  CsvProductRepository        |      |  LocalMediaStorage           |
|  (Phase 1 - Atomic CSV)      |      |  (Phase 1 - Local Directory) |
+------------------------------+      +------------------------------+
| [Future: Supabase/Postgres]  |      | [Future: Cloudflare R2/S3]   |
+------------------------------+      +------------------------------+
```

### 1.2 Architectural Boundary & Non-Responsibilities

> **CRITICAL BOUNDARY:** The Product Catalog module is strictly responsible for managing catalog master data: **Products, Variants, Brands, Categories, Custom Attributes, Product Media, and Catalog Searching/Filtering**.

| Module Scope (INCLUDED) | Out of Scope (EXCLUDED) |
|---|---|
| Product CRUD & Archival | Shopping Cart & Cart Items |
| Category Hierarchy & Circular Guard | Checkout Process & Order Fulfillment |
| Brand Management | Payment Processing & Gateways |
| Variant SKU & Price Management | Table/Room Booking & Reservations |
| Typed Custom Attributes | Promotion Engine, Coupons, & Discounts |
| Product Image Metadata & Sorting | Recommendation Systems & Personalization |
| CSV Data Storage Adapter | Customer Auth, Users, & Permission Systems |
| Local Media Storage Adapter | AI Chatbots / Customer Support Agents |

### 1.3 Host Responsibilities vs. Module Responsibilities

| Host Application Responsibilities | Module Core Responsibilities |
|---|---|
| Reads environment variables (`process.env`, `env`) | Receives configuration strictly via `ProductCatalogConfig` injection |
| Authenticates actors and constructs `CatalogContext` | Enforces tenant/catalog scoping using injected `CatalogContext` |
| Provides physical storage directories / buckets | Handles file-level operations, locking, atomic commits, sanitization |
| Injects optional `LoggingSink` and `AuditSink` | Emits structured log entries and audit events without enforcing auth |
| Mounts HTTP / Server Action / gRPC controllers | Exposes pure async TypeScript service methods with zero web framework coupling |

---

## 2. Public API (exact signatures)

All public types, interfaces, errors, and factory functions are exported from the module entry point (`index.ts` or `core/index.ts`).

```ts
// Factory functions
export function createProductCatalogService(config: ProductCatalogConfig): ProductCatalogService;
export function createCsvProductRepository(options: CsvProductRepositoryOptions): ProductRepository;
export function createLocalMediaStorage(options: LocalMediaStorageOptions): MediaStorage;

// Service Interface
export interface ProductCatalogService {
  // Product Domain
  createProduct(ctx: CatalogContext, input: CreateProductInput): Promise<Product>;
  getProductById(ctx: CatalogContext, id: string): Promise<Product>;
  getProductBySku(ctx: CatalogContext, sku: string): Promise<Product>;
  getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product>;
  updateProduct(ctx: CatalogContext, id: string, input: UpdateProductInput): Promise<Product>;
  archiveProduct(ctx: CatalogContext, id: string): Promise<Product>;
  restoreProduct(ctx: CatalogContext, id: string): Promise<Product>;
  deleteProduct(ctx: CatalogContext, id: string): Promise<void>; // Administrative Hard Delete
  listProducts(ctx: CatalogContext, query?: ProductQuery): Promise<PaginatedResult<Product>>;
  searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;

  // Variant Domain
  createVariant(ctx: CatalogContext, input: CreateVariantInput): Promise<Variant>;
  getVariantById(ctx: CatalogContext, id: string): Promise<Variant>;
  updateVariant(ctx: CatalogContext, id: string, input: UpdateVariantInput): Promise<Variant>;
  deleteVariant(ctx: CatalogContext, id: string): Promise<void>;
  listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]>;

  // Brand Domain
  createBrand(ctx: CatalogContext, input: CreateBrandInput): Promise<Brand>;
  getBrandById(ctx: CatalogContext, id: string): Promise<Brand>;
  updateBrand(ctx: CatalogContext, id: string, input: UpdateBrandInput): Promise<Brand>;
  deleteBrand(ctx: CatalogContext, id: string): Promise<void>;
  listBrands(ctx: CatalogContext, query?: BrandQuery): Promise<PaginatedResult<Brand>>;

  // Category Domain
  createCategory(ctx: CatalogContext, input: CreateCategoryInput): Promise<Category>;
  getCategoryById(ctx: CatalogContext, id: string): Promise<Category>;
  updateCategory(ctx: CatalogContext, id: string, input: UpdateCategoryInput): Promise<Category>;
  deleteCategory(ctx: CatalogContext, id: string): Promise<void>;
  listCategories(ctx: CatalogContext, query?: CategoryQuery): Promise<Category[]>;

  // Product Image Domain
  uploadProductImage(ctx: CatalogContext, input: UploadProductImageInput): Promise<ProductImage>;
  deleteProductImage(ctx: CatalogContext, imageId: string): Promise<void>;
  setPrimaryProductImage(ctx: CatalogContext, productId: string, imageId: string): Promise<ProductImage>;
  reorderProductImages(ctx: CatalogContext, productId: string, imageIdsInOrder: string[]): Promise<ProductImage[]>;
  listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]>;
}
```

---

## 3. Exact Core Types & Domain Models

```ts
/**
 * Catalog Scoping & Actor Context
 */
export type CatalogContext = {
  tenantId: string;
  catalogId: string;
  actor?: {
    id: string;
    type: 'user' | 'system' | 'api' | 'import';
  };
};

/**
 * Product Lifecycle Status
 */
export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived';

/**
 * Typed Custom Attribute Definition
 */
export type AttributeValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string } // ISO8601 string
  | { type: 'enum'; value: string; options: string[] }
  | { type: 'multi_enum'; value: string[]; options: string[] };

export type CustomAttributeMap = Record<string, AttributeValue>;

/**
 * Product Entity Model
 */
export type Product = {
  id: string;
  tenantId: string;
  catalogId: string;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  status: ProductStatus;
  brandId: string | null;
  categoryId: string | null;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  currency: string; // ISO 4217, e.g. "THB", "USD"
  stockQuantity: number;
  trackInventory: boolean;
  isActive: boolean;
  isFeatured: boolean;
  primaryImageId: string | null;
  attributes: CustomAttributeMap;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO8601 timestamp
  updatedAt: string; // ISO8601 timestamp
  archivedAt: string | null; // ISO8601 timestamp
};

/**
 * Variant Entity Model
 */
export type Variant = {
  id: string;
  tenantId: string;
  catalogId: string;
  productId: string;
  sku: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  attributes: CustomAttributeMap;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Brand Entity Model
 */
export type Brand = {
  id: string;
  tenantId: string;
  catalogId: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Category Entity Model
 */
export type Category = {
  id: string;
  tenantId: string;
  catalogId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Product Image Entity Model (Media Entity)
 */
export type ProductImage = {
  id: string;
  tenantId: string;
  catalogId: string;
  productId: string;
  storageProvider: string; // e.g., 'local', 'r2', 's3'
  storageKey: string;     // e.g., 'uploads/products/prod_123/uuid.jpg'
  publicUrl: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSize: number;       // In bytes
  width: number | null;
  height: number | null;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
};

/**
 * Input DTOs
 */
export type CreateProductInput = {
  sku: string;
  name: string;
  slug?: string; // Auto-generated if omitted
  description?: string;
  shortDescription?: string;
  status?: ProductStatus; // Default: 'draft'
  brandId?: string;
  categoryId?: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  currency?: string; // Default: 'THB'
  stockQuantity?: number; // Default: 0
  trackInventory?: boolean; // Default: true
  isActive?: boolean; // Default: true
  isFeatured?: boolean; // Default: false
  attributes?: CustomAttributeMap;
  metadata?: Record<string, unknown>;
};

export type UpdateProductInput = Partial<CreateProductInput> & {
  updateSlug?: boolean; // Explicit opt-in to regenerate slug from name
};

export type CreateVariantInput = {
  productId: string;
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  stockQuantity?: number;
  attributes?: CustomAttributeMap;
  isActive?: boolean;
};

export type UpdateVariantInput = Partial<Omit<CreateVariantInput, 'productId'>>;

export type CreateBrandInput = {
  name: string;
  slug?: string;
  description?: string;
  logoUrl?: string;
  isActive?: boolean;
};

export type UpdateBrandInput = Partial<CreateBrandInput>;

export type CreateCategoryInput = {
  name: string;
  parentId?: string | null;
  slug?: string;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export type UploadProductImageInput = {
  productId: string;
  fileName: string;
  mimeType: string;
  fileBuffer: Uint8Array | ArrayBuffer;
  altText?: string;
  isPrimary?: boolean;
};
```

---

## 4. Repository & Media Storage Interfaces

### 4.1 `ProductRepository` Interface

The `ProductRepository` defines the contract for master catalog data storage. It MUST NOT contain any provider-specific concepts.

```ts
export interface ProductRepository {
  // Products
  createProduct(ctx: CatalogContext, product: Product): Promise<Product>;
  getProductById(ctx: CatalogContext, id: string): Promise<Product | null>;
  getProductBySku(ctx: CatalogContext, sku: string): Promise<Product | null>;
  getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product | null>;
  updateProduct(ctx: CatalogContext, product: Product): Promise<Product>;
  deleteProduct(ctx: CatalogContext, id: string): Promise<void>; // Hard delete
  listProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;
  searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;

  // Variants
  createVariant(ctx: CatalogContext, variant: Variant): Promise<Variant>;
  getVariantById(ctx: CatalogContext, id: string): Promise<Variant | null>;
  getVariantBySku(ctx: CatalogContext, sku: string): Promise<Variant | null>;
  updateVariant(ctx: CatalogContext, variant: Variant): Promise<Variant>;
  deleteVariant(ctx: CatalogContext, id: string): Promise<void>;
  listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]>;

  // Brands
  createBrand(ctx: CatalogContext, brand: Brand): Promise<Brand>;
  getBrandById(ctx: CatalogContext, id: string): Promise<Brand | null>;
  getBrandBySlug(ctx: CatalogContext, slug: string): Promise<Brand | null>;
  updateBrand(ctx: CatalogContext, brand: Brand): Promise<Brand>;
  deleteBrand(ctx: CatalogContext, id: string): Promise<void>;
  listBrands(ctx: CatalogContext, query?: BrandQuery): Promise<PaginatedResult<Brand>>;

  // Categories
  createCategory(ctx: CatalogContext, category: Category): Promise<Category>;
  getCategoryById(ctx: CatalogContext, id: string): Promise<Category | null>;
  getCategoryBySlug(ctx: CatalogContext, slug: string): Promise<Category | null>;
  updateCategory(ctx: CatalogContext, category: Category): Promise<Category>;
  deleteCategory(ctx: CatalogContext, id: string): Promise<void>;
  listCategories(ctx: CatalogContext, query?: CategoryQuery): Promise<Category[]>;

  // Product Images Metadata
  createProductImage(ctx: CatalogContext, image: ProductImage): Promise<ProductImage>;
  getProductImageById(ctx: CatalogContext, id: string): Promise<ProductImage | null>;
  updateProductImage(ctx: CatalogContext, image: ProductImage): Promise<ProductImage>;
  deleteProductImage(ctx: CatalogContext, id: string): Promise<void>;
  listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]>;
}
```

### 4.2 `MediaStorage` Interface

The `MediaStorage` interface abstracts binary file storage operations for product media assets.

```ts
export type UploadMediaInput = {
  tenantId: string;
  catalogId: string;
  productId: string;
  fileName: string;
  mimeType: string;
  content: Uint8Array | ArrayBuffer;
  metadata?: Record<string, string>;
};

export type MediaStorageOutput = {
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
  fileSize: number;
  mimeType: string;
  metadata?: Record<string, string>;
};

export type MediaMetadata = {
  storageKey: string;
  fileSize: number;
  mimeType: string;
  lastModified: string;
  metadata?: Record<string, string>;
};

export interface MediaStorage {
  upload(input: UploadMediaInput): Promise<MediaStorageOutput>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getPublicUrl(storageKey: string): string;
  getMetadata(storageKey: string): Promise<MediaMetadata>;
  move(sourceKey: string, targetKey: string): Promise<MediaStorageOutput>;
  copy(sourceKey: string, targetKey: string): Promise<MediaStorageOutput>;
}
```

---

## 5. Custom Attributes System

The Product Catalog supports strongly typed custom attributes for flexible vertical schemas (e.g. Motorcycle specs, Apparel sizes, Electronics specs) without storing unvalidated, unstructured raw JSON.

### 5.1 Validation & Normalization Rules

1. **Type Checking:** Every attribute value must conform strictly to its declared `type`:
   - `string`: Must be non-null string. Whitespace is trimmed.
   - `number`: Must be finite number (`!isNaN(val) && isFinite(val)`).
   - `boolean`: Must be boolean primitive (`true` | `false`).
   - `date`: Must be valid ISO8601 string (e.g. `"2026-08-12T00:00:00.000Z"`).
   - `enum`: Value must exist within the declared `options` array.
   - `multi_enum`: All items in `value` array must exist within `options`.
2. **Schema Enforcement:** Invalid attribute structures throw `INVALID_PRODUCT_DATA` with explicit detail of the failing key.

```ts
// Validator implementation blueprint
export function validateCustomAttributes(attributes: CustomAttributeMap): void {
  for (const [key, attr] of Object.entries(attributes)) {
    if (!attr || typeof attr !== 'object' || !('type' in attr)) {
      throw new ProductCatalogError(
        `Attribute '${key}' must specify a valid 'type'`,
        'INVALID_PRODUCT_DATA',
        { attributeKey: key }
      );
    }
    switch (attr.type) {
      case 'string':
        if (typeof attr.value !== 'string') {
          throw new ProductCatalogError(`Attribute '${key}' value must be a string`, 'INVALID_PRODUCT_DATA');
        }
        break;
      case 'number':
        if (typeof attr.value !== 'number' || isNaN(attr.value)) {
          throw new ProductCatalogError(`Attribute '${key}' value must be a valid number`, 'INVALID_PRODUCT_DATA');
        }
        break;
      case 'boolean':
        if (typeof attr.value !== 'boolean') {
          throw new ProductCatalogError(`Attribute '${key}' value must be a boolean`, 'INVALID_PRODUCT_DATA');
        }
        break;
      case 'date':
        if (typeof attr.value !== 'string' || isNaN(Date.parse(attr.value))) {
          throw new ProductCatalogError(`Attribute '${key}' value must be an ISO8601 date string`, 'INVALID_PRODUCT_DATA');
        }
        break;
      case 'enum':
        if (!Array.isArray(attr.options) || !attr.options.includes(attr.value)) {
          throw new ProductCatalogError(`Attribute '${key}' value '${attr.value}' is not in allowed enum options`, 'INVALID_PRODUCT_DATA');
        }
        break;
      case 'multi_enum':
        if (!Array.isArray(attr.options) || !Array.isArray(attr.value) || !attr.value.every((v) => attr.options.includes(v))) {
          throw new ProductCatalogError(`Attribute '${key}' multi_enum values are invalid or not in allowed options`, 'INVALID_PRODUCT_DATA');
        }
        break;
      default:
        throw new ProductCatalogError(`Attribute '${key}' has unknown type '${(attr as any).type}'`, 'INVALID_PRODUCT_DATA');
    }
  }
}
```

---

## 6. Category Hierarchy & Circular Parent Protection

Categories support multi-level parent-child trees (e.g. `Motorcycle Accessories` -> `Protection` -> `Crash Bars`).

### 6.1 Circular Parent Relationship Guard

To prevent infinite recursion during tree traversals or category updates, the `ProductCatalogService` evaluates the ancestor hierarchy before committing any parent assignment.

```ts
/**
 * Verifies that setting candidateParentId as parent of targetCategoryId will not introduce a cycle.
 */
export async function assertNoCircularCategory(
  ctx: CatalogContext,
  repo: ProductRepository,
  targetCategoryId: string,
  candidateParentId: string | null
): Promise<void> {
  if (!candidateParentId) return;

  // Direct self-parenting check
  if (targetCategoryId === candidateParentId) {
    throw new ProductCatalogError(
      `Category '${targetCategoryId}' cannot be its own parent`,
      'INVALID_CATEGORY'
    );
  }

  // Walk up ancestor tree from candidateParentId
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>([targetCategoryId]);

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new ProductCatalogError(
        `Circular category relationship detected: '${currentId}' is an ancestor of category '${targetCategoryId}'`,
        'INVALID_CATEGORY'
      );
    }
    visited.add(currentId);

    const parentCategory = await repo.getCategoryById(ctx, currentId);
    if (!parentCategory) {
      throw new ProductCatalogError(
        `Parent category '${currentId}' does not exist`,
        'INVALID_CATEGORY'
      );
    }
    currentId = parentCategory.parentId;
  }
}
```

---

## 7. SKU & Slug Rules

### 7.1 SKU Rules
- **Uniqueness:** Unique per catalog (`catalogId` + `tenantId` scope). Duplicate SKU creation or update throws `DUPLICATE_SKU`.
- **Normalization:** Uppercase, whitespace-trimmed, non-alphanumeric characters replaced/cleaned.
- **Validation:** Must be 3 to 64 characters matching `/^[A-Z0-9_-]{3,64}$/`.
- **No Silent Duplicates:** If a duplicate SKU exists, the service throws `DUPLICATE_SKU` immediately; it NEVER modifies or appends silently.

### 7.2 Slug Rules
- **Uniqueness:** Unique per catalog.
- **Auto-Generation:** Generated from `name` if omitted. Thai & international text is slugified safely (e.g. `"หมวกกันน็อค ADV"` -> `"หมวกกันน็อค-adv"` or ASCII-transliterated slug).
- **Collision Protection:** If `"adv350-crash-bar"` exists, auto-generation generates `"adv350-crash-bar-1"`, `"adv350-crash-bar-2"`.
- **Immutability on Name Change:** Updating product `name` DOES NOT change `slug` automatically (prevents SEO link rot). Requires `updateSlug: true` in `UpdateProductInput` to force regeneration.

---

## 8. Search, Filter & Pagination Design

### 8.1 `ProductQuery` Definition

```ts
export type SortField = 'createdAt' | 'updatedAt' | 'price' | 'name' | 'stockQuantity';
export type SortOrder = 'asc' | 'desc';

export type ProductQuery = {
  search?: string; // Query matching against name, sku, brand name, category name, description
  categoryId?: string;
  brandId?: string;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  isFeatured?: boolean;
  attributes?: Record<string, string | number | boolean>;
  sort?: {
    field: SortField;
    order: SortOrder;
  };
  page?: number;  // 1-indexed, default: 1
  limit?: number; // default: 20, max: 100
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};
```

---

## 9. CSV Data Storage Adapter Design (Phase 1 Data Store)

The CSV Adapter is a **first-class data store** for local deployments, prototypes, and lightweight applications.

### 9.1 File Layout Architecture

The adapter manages 5 distinct CSV files inside a host-configured directory:

```
/data/catalog/
├── products.csv
├── variants.csv
├── brands.csv
├── categories.csv
└── product_images.csv
```

### 9.2 CSV Schemas & Header Signatures

- `products.csv`: `id,tenant_id,catalog_id,sku,name,slug,description,short_description,status,brand_id,category_id,price,compare_at_price,cost_price,currency,stock_quantity,track_inventory,is_active,is_featured,primary_image_id,attributes_json,metadata_json,created_at,updated_at,archived_at`
- `variants.csv`: `id,tenant_id,catalog_id,product_id,sku,name,price,compare_at_price,stock_quantity,attributes_json,is_active,created_at,updated_at`
- `brands.csv`: `id,tenant_id,catalog_id,name,slug,description,logo_url,is_active,created_at,updated_at`
- `categories.csv`: `id,tenant_id,catalog_id,parent_id,name,slug,description,image_url,sort_order,is_active,created_at,updated_at`
- `product_images.csv`: `id,tenant_id,catalog_id,product_id,storage_provider,storage_key,public_url,file_name,mime_type,file_size,width,height,alt_text,sort_order,is_primary,created_at`

### 9.3 Atomic Write, Locking, Backup & Thai/UTF-8 Rules

1. **File Locking (`CSV_LOCKED`):**
   - Before writing, acquire an advisory lock file (`products.csv.lock`).
   - If locked by another process, retry up to `lockTimeoutMs` (default: 3000ms). If timeout expires, throw `CSV_LOCKED`.
2. **Backup Snapshot (`.bak`):**
   - Before modifying any CSV file, create a backup copy (`products.csv.bak`).
3. **Atomic Commit (`.tmp` -> rename):**
   - Write new content to a temporary file (`products.csv.tmp.${uuid}`).
   - Flush file descriptor to disk (`fs.fsyncSync`).
   - Atomically rename temporary file over target file (`fs.renameSync`).
4. **UTF-8 & Thai Character Encoding:**
   - Files are encoded in standard UTF-8.
   - Text fields with commas, newlines, or quotes are enclosed in double quotes with double-quote escaping (`""`).
5. **Safe Recovery (`CSV_CORRUPTED`):**
   - If CSV header validation fails or record parsing encounters malformed syntax, throw `CSV_CORRUPTED`.
   - Provide fallback restore utility from `.bak` snapshot.

---

## 10. Local Image Storage Adapter Design (Phase 1 Media Store)

The `LocalMediaStorage` adapter handles physical binary files on local disk for local development and self-hosted deployments.

### 10.1 Storage Path Layout

Files are organized deterministically under the host-configured root directory:

```
{baseUploadDir}/uploads/products/{product_id}/{uuid}.{ext}
```

### 10.2 Security Controls

1. **Path Traversal Protection:**
   - Resolve absolute path using `path.resolve`.
   - Verify resolved path starts strictly with `path.resolve(baseUploadDir)`.
   - Violation throws `STORAGE_ERROR` ("Path traversal detected").
2. **Filename Sanitization:**
   - Strip unsafe characters (`..`, `/`, `\`, null bytes, control chars).
   - Generate cryptographically secure UUID for target filename: `${crypto.randomUUID()}.${ext}`.
3. **File Size Enforcement:**
   - Limit upload size to `maxFileSizeByte` (default: 5MB / 5,242,880 bytes).
   - Exceeding size throws `INVALID_PRODUCT_DATA` ("File size exceeds limit").
4. **Magic-Byte MIME Validation:**
   - Inspect binary signature (first 12 bytes of file content), NOT relying solely on file extension or client header:
     - **JPEG:** `FF D8 FF`
     - **PNG:** `89 50 4E 47 0D 0A 1A 0A`
     - **WEBP:** `52 49 46 46 ... 57 45 42 50`
   - Invalid magic bytes throw `MEDIA_UPLOAD_FAILED` ("Unsupported or corrupted image file").

---

## 11. Structured Error Model & Provider Error Mapping

### 11.1 All 12 Standard Error Codes

All domain errors thrown by the module extend `ProductCatalogError`.

```ts
export type ProductCatalogErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'DUPLICATE_SKU'
  | 'INVALID_PRODUCT_DATA'
  | 'INVALID_VARIANT'
  | 'INVALID_CATEGORY'
  | 'STORAGE_ERROR'
  | 'MEDIA_UPLOAD_FAILED'
  | 'MEDIA_DELETE_FAILED'
  | 'CSV_LOCKED'
  | 'CSV_CORRUPTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR';

export class ProductCatalogError extends Error {
  readonly code: ProductCatalogErrorCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ProductCatalogErrorCode,
    details?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(message);
    this.name = 'ProductCatalogError';
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}
```

### 11.2 Provider Error Mapping Rules

Raw storage exceptions MUST NEVER leak out of adapters to the Application layer.

| Internal / Storage Exception | Mapped Domain Error Code | Description |
|---|---|---|
| Node `ENOENT` / File not found on update | `STORAGE_ERROR` or `PRODUCT_NOT_FOUND` | Storage file or record missing |
| CSV lock acquisition timeout | `CSV_LOCKED` | Lock file busy beyond threshold |
| CSV header missing / parse failure | `CSV_CORRUPTED` | Malformed CSV file structure |
| Storage disk write failure / EACCES / ENOSPC | `STORAGE_ERROR` | Storage permission or disk full error |
| Image magic bytes check failure | `MEDIA_UPLOAD_FAILED` | File binary signature does not match allowed image format |
| Unlink error on media deletion | `MEDIA_DELETE_FAILED` | Failed to delete physical image asset |
| Network disconnect to external store | `PROVIDER_UNAVAILABLE` | Database / Storage endpoint unavailable |
| Invalid module instantiation options | `CONFIGURATION_ERROR` | Host provided invalid configuration |

---

## 12. Host Configuration Contract

The Core Service NEVER accesses `process.env` or global runtime configuration directly.

```ts
export type ProductCatalogConfig = {
  dataRepository: ProductRepository;
  mediaStorage: MediaStorage;
  logger?: StructuredLogger;
  auditSink?: AuditSink;
  defaults?: {
    currency?: string; // Default: 'THB'
    pageSize?: number; // Default: 20
    maxPageSize?: number; // Default: 100
  };
};
```

---

## 13. Audit & Structured Logging Architecture

### 13.1 Structured Logging

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  module: 'product-catalog';
  operation: string;
  tenantId?: string;
  catalogId?: string;
  productId?: string;
  provider?: string;
  durationMs?: number;
  result: 'success' | 'failure';
  errorCode?: ProductCatalogErrorCode;
  operationId?: string; // Tracing ID for bulk actions
};

export interface StructuredLogger {
  log(entry: LogEntry): void;
}
```

> **SECURITY MANDATE:** Logger implementations MUST NEVER log credentials, storage access keys, raw secret tokens, or sensitive user data.

### 13.2 Audit Event System

```ts
export type AuditEventType =
  | 'product.created'
  | 'product.updated'
  | 'product.archived'
  | 'product.restored'
  | 'product.deleted'
  | 'variant.created'
  | 'variant.updated'
  | 'variant.deleted'
  | 'category.created'
  | 'category.updated'
  | 'category.deleted'
  | 'image.uploaded'
  | 'image.deleted'
  | 'image.primary_changed';

export type AuditEvent = {
  id: string;
  timestamp: string;
  tenantId: string;
  catalogId: string;
  actor: {
    id: string;
    type: 'user' | 'system' | 'api' | 'import';
  };
  eventType: AuditEventType;
  entityType: 'product' | 'variant' | 'brand' | 'category' | 'image';
  entityId: string;
  changes?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
  metadata?: Record<string, unknown>;
};

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
```

---

## 14. Multi-Tenant Readiness & CatalogContext Design

Every service and repository method accepts `CatalogContext` as its first argument.

1. **Isolation Enforcement:** Repository adapters must append `WHERE tenant_id = ctx.tenantId AND catalog_id = ctx.catalogId` (or filter memory/CSV records accordingly) on EVERY query and mutation.
2. **Zero Cross-Tenant Leakage:** Requesting an ID that exists under `tenant_A` using a `CatalogContext` for `tenant_B` MUST return `PRODUCT_NOT_FOUND` (or null in repository layer).

---

## 15. File Structure

The project directory layout follows the Module Hub monorepo standard adapted for TypeScript:

```
modules/product-catalog/
├── BRIEF.md
├── DESIGN.md
├── MODULE.md
├── package.json
├── tsconfig.json
├── index.ts
├── core/
│   ├── index.ts
│   ├── service.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── validators/
│   │   ├── product.validator.ts
│   │   ├── attribute.validator.ts
│   │   ├── category.validator.ts
│   │   └── sku.validator.ts
│   └── utils/
│       ├── slug.ts
│       ├── sku.ts
│       └── sanitize.ts
├── repositories/
│   └── product.repository.ts
├── storage/
│   └── media.storage.ts
├── adapters/
│   ├── data/
│   │   ├── csv/
│   │   │   ├── csv-product.repository.ts
│   │   │   ├── file-lock.ts
│   │   │   └── csv-parser.ts
│   │   └── index.ts
│   └── media/
│       ├── local/
│       │   └── local-media.storage.ts
│       └── index.ts
├── audit/
│   ├── audit.interface.ts
│   └── logger.interface.ts
├── tests/
│   ├── unit/
│   │   ├── service.test.ts
│   │   ├── validators.test.ts
│   │   ├── sku-slug.test.ts
│   │   └── attributes.test.ts
│   ├── contract/
│   │   ├── product-repository.contract.ts
│   │   └── media-storage.contract.ts
│   └── adapters/
│       ├── csv-repository.test.ts
│       └── local-media.test.ts
└── examples/
    └── integration.example.ts
```

---

## 16. Adapter Contract Test Plan (for Stage 3 Tester)

All data storage adapters (CSV in Phase 1, Supabase/Postgres in future phases) MUST pass the shared `ProductRepositoryContract` suite to guarantee strict compliance and seamless provider swapping.

### 16.1 `ProductRepositoryContract` Test Suite

| Test ID | Test Name | Target Behavior / Expected Outcome |
|---|---|---|
| `REP-001` | `createProduct & getProductById` | Creates product, retrieves by ID, asserts all fields match context scoping. |
| `REP-002` | `getProductBySku` | Normalizes SKU, retrieves exact matching product record. |
| `REP-003` | `getProductBySlug` | Retrieves exact product matching slug. |
| `REP-004` | `updateProduct` | Updates price, name, attributes; asserts `updatedAt` is refreshed. |
| `REP-005` | `archiveProduct & restoreProduct` | Archiving sets status `'archived'` & `archivedAt` timestamp; restore clears `archivedAt`. |
| `REP-006` | `deleteProduct` | Hard deletes product record; subsequent lookup returns `null`. |
| `REP-007` | `Duplicate SKU Enforcement` | Creating 2 products with same SKU under same catalog returns null/error in repo layer. |
| `REP-008` | `Multi-Tenant Isolation` | Lookup with different `tenantId` yields `null` even if product ID exists in storage. |
| `REP-009` | `Pagination & Limits` | `listProducts` honors `page` and `limit`, returning correct `items`, `total`, `totalPages`. |
| `REP-010` | `Search & Filtering` | Filters by `categoryId`, `brandId`, `minPrice`, `maxPrice`, and `status`. |

### 16.2 `MediaStorageContract` Test Suite

| Test ID | Test Name | Target Behavior / Expected Outcome |
|---|---|---|
| `MED-001` | `upload & getPublicUrl` | Uploads binary buffer, receives storage key & public URL; `exists` returns `true`. |
| `MED-002` | `getMetadata` | Returns correct `fileSize` and `mimeType`. |
| `MED-003` | `delete` | Deletes file by key; `exists` returns `false`. |
| `MED-004` | `Path Traversal Rejection` | Key containing `../` throws path traversal security error. |

---

## 17. `integration.example.ts` Reference Shape

```ts
import path from 'node:path';
import {
  createProductCatalogService,
  createCsvProductRepository,
  createLocalMediaStorage,
  CatalogContext,
  ProductCatalogError,
} from '../index.js';

async function runIntegrationExample() {
  // 1. Setup Host Adapters
  const dataDir = path.resolve(process.cwd(), './data/catalog');
  const uploadDir = path.resolve(process.cwd(), './public/uploads');

  const csvRepo = createCsvProductRepository({
    dataDirectory: dataDir,
    lockTimeoutMs: 3000,
  });

  const localMedia = createLocalMediaStorage({
    baseUploadDir: uploadDir,
    publicBaseUrl: 'http://localhost:3000/uploads',
    maxFileSizeByte: 5 * 1024 * 1024,
  });

  // 2. Instantiate Service
  const catalogService = createProductCatalogService({
    dataRepository: csvRepo,
    mediaStorage: localMedia,
    logger: {
      log: (entry) => console.log(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.operation}: ${entry.result}`),
    },
  });

  // 3. Define Context
  const ctx: CatalogContext = {
    tenantId: 'tenant_demo',
    catalogId: 'cat_default',
    actor: { id: 'usr_admin', type: 'user' },
  };

  try {
    // 4. Create Category
    const category = await catalogService.createCategory(ctx, {
      name: 'Motorcycle Helmets',
      slug: 'motorcycle-helmets',
    });
    console.log('Created Category:', category.id);

    // 5. Create Product with Custom Attributes
    const product = await catalogService.createProduct(ctx, {
      sku: 'HELMET-ADV-001',
      name: 'Full Face Adventure Helmet',
      price: 4500,
      currency: 'THB',
      categoryId: category.id,
      attributes: {
        material: { type: 'string', value: 'Carbon Fiber' },
        certified: { type: 'boolean', value: true },
        size_options: {
          type: 'multi_enum',
          value: ['M', 'L'],
          options: ['S', 'M', 'L', 'XL'],
        },
      },
    });
    console.log('Created Product:', product.id, product.sku);

    // 6. Search Products
    const searchResult = await catalogService.searchProducts(ctx, {
      search: 'Adventure',
      minPrice: 1000,
      maxPrice: 5000,
      page: 1,
      limit: 10,
    });
    console.log(`Found ${searchResult.total} products.`);

    // 7. Archive Product (Soft Delete)
    const archived = await catalogService.archiveProduct(ctx, product.id);
    console.log('Archived Product at:', archived.archivedAt);

  } catch (error) {
    if (error instanceof ProductCatalogError) {
      console.error('Catalog Domain Error:', error.code, error.message, error.details);
    } else {
      console.error('Unexpected Failure:', error);
    }
  }
}

runIntegrationExample();
```

---

## 18. `package.json` and `tsconfig.json`

### `package.json`
```json
{
  "name": "@module-hub/product-catalog",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "exports": {
    ".": "./index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:contract": "vitest run tests/contract",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.2"
  }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["**/*.ts"]
}
```

---

## 19. Explicit Non-Goals & Future Phases Roadmap

### Explicit Non-Goals for MVP (Phase 0 + Phase 1)
- **Supabase / PostgreSQL Integration:** Deferred to Phase 3 & 5. Core interfaces must support them without architectural changes.
- **Cloudflare R2 / AWS S3 Media Storage:** Deferred to Phase 4 & 5.
- **Bulk CSV Import / Export Utilities:** Deferred to Phase 2.
- **Direct HTTP / REST Controller Routes:** Monorepo apps map controllers; core service remains pure TS.
- **Shopping Cart, Checkout, or Inventory Reservation Locks:** Handled by separate downstream monorepo modules.

### Monorepo Phase Roadmap

```
+-------------------------------------------------------------------+
| Phase 0: Core Domain Models, ProductService, Repository Interfaces|
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| Phase 1 (CURRENT MVP): CSV Data Adapter + Local Image Adapter     |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| Phase 2: Bulk CSV Import/Export, Validation, Preview & Error Report|
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| Phase 3 & 4: Supabase Data Adapter + Cloudflare R2 Media Adapter  |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| Phase 5: PostgreSQL Native Adapter, S3 Compatible & Custom API    |
+-------------------------------------------------------------------+
```

---

## 20. Acceptance Criteria (for Stage 4 Reviewer)

A Stage 4 Reviewer MUST verify all of the following criteria before approving the design:

1. [ ] **File Location:** Deliverable exists at `D:\AI-Workspace\projects\modules-hub\modules\product-catalog\DESIGN.md`.
2. [ ] **Provider Agnosticism:** `core/` contains zero SDK imports (`@supabase/supabase-js`, `@aws-sdk/client-s3`, etc.).
3. [ ] **Default Archival:** Archival (`status = 'archived'`) is default soft-delete; hard delete is separate admin action.
4. [ ] **Media Entity Structure:** Images are represented via `ProductImage` entity records with `storage_key`, NOT base64 array strings in product record.
5. [ ] **Custom Attributes Safety:** Custom attributes are strongly typed (`string`, `number`, `boolean`, `date`, `enum`, `multi_enum`) with runtime validation.
6. [ ] **Category Hierarchy Guard:** Category updates feature an explicit circular-parent checking algorithm.
7. [ ] **SKU & Slug Integrity:** SKU is normalized & unique per catalog with explicit error (`DUPLICATE_SKU`). Slug auto-generates with collision fallback (`-1`, `-2`) and preserves on name update unless forced.
8. [ ] **CSV Data Adapter Rigor:** CSV adapter specifies file lock (`CSV_LOCKED`), atomic writes (`.tmp` -> rename), backup (`.bak`), and UTF-8/Thai quote escaping.
9. [ ] **Local Media Adapter Rigor:** Local media storage specifies filename sanitization, path traversal protection, size limits, and magic-byte MIME validation.
10. [ ] **Error Model Complete:** All 12 required error codes (`PRODUCT_NOT_FOUND`, `DUPLICATE_SKU`, `INVALID_PRODUCT_DATA`, `INVALID_VARIANT`, `INVALID_CATEGORY`, `STORAGE_ERROR`, `MEDIA_UPLOAD_FAILED`, `MEDIA_DELETE_FAILED`, `CSV_LOCKED`, `CSV_CORRUPTED`, `PROVIDER_UNAVAILABLE`, `CONFIGURATION_ERROR`) are defined with clear mapping rules.
11. [ ] **Tenant Scoping:** `CatalogContext` is passed to all service/repository signatures.
12. [ ] **Contract Test Suite:** Shared `ProductRepositoryContract` and `MediaStorageContract` test specifications are clearly outlined.
