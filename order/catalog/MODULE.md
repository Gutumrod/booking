# Product Catalog Module

**Version:** 0.1.0
**Status:** ✅ Completed
**Documentation Authority:** Current version/status follow `../REGISTRY.md`; this document describes the module contract/design for that registered version.

## Architecture

This module is a **reusable embedded module** — not a standalone service or framework. A Host project that needs a multi-tenant product catalog embeds this module into its own codebase and wires it up by injecting a data repository adapter, a media storage adapter, and optional logging/audit sinks.

The module has one job: accept a `ProductCatalogConfig` that the Host constructs → validate inputs → generate slugs and IDs → delegate persistence through the injected `ProductRepository` → delegate media operations through the injected `MediaStorage` → emit structured `LogEntry` and `AuditEvent` objects → return typed domain objects or throw a structured `ProductCatalogError`.

```
Host
  ↓  (injects ProductCatalogConfig: dataRepository + mediaStorage + logger? + auditSink?)
ProductCatalogService   (core — domain validation, slug generation, audit events, pagination)
      ↓                                         ↓
ProductRepository interface           MediaStorage interface
      ↓                                         ↓
CsvProductRepository              LocalMediaStorage
(CSV file adapter, Phase 0–1)     (local-disk adapter, Phase 0–1)
```

Every operation is scoped by a `CatalogContext` (`tenantId` + `catalogId` + optional `actor`). The module enforces this boundary — cross-tenant lookups return `null` or throw `PRODUCT_NOT_FOUND`; cross-tenant mutations are impossible.

### Architectural boundary

> **SCOPE:** The Product Catalog module handles catalog domain logic only — product/variant/brand/category CRUD, image management, attribute storage, and audit. It does NOT handle authentication, order management, pricing engines, search index synchronisation, or data import/export pipelines. Those belong to host-side or separate modules.

The module **never** reads env (`process.env` / `env` / `globalThis`). The Host reads its own env/secrets and injects everything via `ProductCatalogConfig`.

### Storage profiles (Phase 0–1)

The Host maps a storage profile (from its own config or env) onto adapter construction. In MVP Phase 0–1, the only supported providers are:

| Profile key | Provider | Adapter factory |
|---|---|---|
| `data_storage.provider = "csv"` | Local CSV files | `createCsvProductRepository(options)` |
| `image_storage.provider = "local"` | Local filesystem | `createLocalMediaStorage(options)` |

Future phases will add Supabase/Postgres and Cloudflare R2 adapters. Because core code depends only on the `ProductRepository` and `MediaStorage` interfaces, the Host can swap adapters without touching core.

### Host vs. module responsibilities

| Host must do | Module does |
|---|---|
| Read env / secrets (directories, base URLs, API keys) | Never touches env — receives all config via `ProductCatalogConfig` |
| Construct adapters from Host-owned config; inject via `ProductCatalogConfig` | Validates that `dataRepository` and `mediaStorage` are present at construction; throws `CONFIGURATION_ERROR` if missing |
| Provide a `CatalogContext` per operation with `tenantId`, `catalogId`, and optional `actor` | Scopes every read and write by `tenantId` + `catalogId`; cross-tenant access returns `null` / `PRODUCT_NOT_FOUND` |
| Implement `StructuredLogger` (log sink) and inject as `logger` | Emits structured `LogEntry` objects — never logs credentials, keys, or secrets |
| Implement `AuditSink` and inject as `auditSink` | Records a typed `AuditEvent` for every mutating operation |
| Catch `ProductCatalogError` and map `error.code` to an appropriate host-side response status | Throws `ProductCatalogError` with a machine-readable `code` on every failure |

## Public API

All exports come from the module entry point `index.ts`. Do not import from sub-files directly.

```ts
import {
  createProductCatalogService,
  createCsvProductRepository,
  createLocalMediaStorage,
  ProductCatalogError,
} from './index.js';

import type {
  // Config
  ProductCatalogConfig,
  // Context
  CatalogContext,
  // Domain types
  Product,
  Variant,
  Brand,
  Category,
  ProductImage,
  ProductStatus,
  AttributeValue,
  CustomAttributeMap,
  // Input types
  CreateProductInput,
  UpdateProductInput,
  CreateVariantInput,
  UpdateVariantInput,
  CreateBrandInput,
  UpdateBrandInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  UploadProductImageInput,
  // Query types
  ProductQuery,
  BrandQuery,
  CategoryQuery,
  SortField,
  SortOrder,
  PaginatedResult,
  // Adapter interfaces
  ProductRepository,
  MediaStorage,
  // Adapter option types
  CsvProductRepositoryOptions,
  LocalMediaStorageOptions,
  // Logging / audit
  StructuredLogger,
  LogEntry,
  LogLevel,
  AuditSink,
  AuditEvent,
  AuditEventType,
  // Media storage I/O types
  UploadMediaInput,
  MediaStorageOutput,
  MediaMetadata,
  // Error
  ProductCatalogErrorCode,
} from './index.js';
```

### `createProductCatalogService(config: ProductCatalogConfig): ProductCatalogService`

Returns a `ProductCatalogService` bound to the given adapters, logger, and audit sink. Throws `ProductCatalogError` with code `CONFIGURATION_ERROR` immediately if `config.dataRepository` or `config.mediaStorage` is missing.

### `createCsvProductRepository(options: CsvProductRepositoryOptions): ProductRepository`

Returns a `ProductRepository` backed by local CSV files. Creates `options.dataDirectory` recursively and initialises the five CSV files on first use.

### `createLocalMediaStorage(options: LocalMediaStorageOptions): MediaStorage`

Returns a `MediaStorage` backed by the local filesystem. Creates `options.baseUploadDir` recursively.

### `ProductCatalogError`

Thrown by the service on every failure. Never returns error objects — every failure path throws.

```ts
class ProductCatalogError extends Error {
  readonly code: ProductCatalogErrorCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ProductCatalogErrorCode,
    details?: Record<string, unknown>,
    cause?: unknown,
  );
}
```

### `ProductCatalogService` interface

All methods take a `CatalogContext` as the first argument. The service never exposes repository-level primitives — callers work exclusively through this interface.

**Product operations**

```ts
interface ProductCatalogService {
  createProduct(ctx: CatalogContext, input: CreateProductInput): Promise<Product>;
  getProductById(ctx: CatalogContext, id: string): Promise<Product>;
  getProductBySku(ctx: CatalogContext, sku: string): Promise<Product>;
  getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product>;
  updateProduct(ctx: CatalogContext, id: string, input: UpdateProductInput): Promise<Product>;
  archiveProduct(ctx: CatalogContext, id: string): Promise<Product>;   // sets status='archived', archivedAt=now
  restoreProduct(ctx: CatalogContext, id: string): Promise<Product>;   // clears archivedAt, resets status
  deleteProduct(ctx: CatalogContext, id: string): Promise<void>;       // hard delete (admin action)
  listProducts(ctx: CatalogContext, query?: ProductQuery): Promise<PaginatedResult<Product>>;
  searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;
```

**Variant operations**

```ts
  createVariant(ctx: CatalogContext, input: CreateVariantInput): Promise<Variant>;
  getVariantById(ctx: CatalogContext, id: string): Promise<Variant>;
  updateVariant(ctx: CatalogContext, id: string, input: UpdateVariantInput): Promise<Variant>;
  deleteVariant(ctx: CatalogContext, id: string): Promise<void>;
  listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]>;
```

**Brand operations**

```ts
  createBrand(ctx: CatalogContext, input: CreateBrandInput): Promise<Brand>;
  getBrandById(ctx: CatalogContext, id: string): Promise<Brand>;
  updateBrand(ctx: CatalogContext, id: string, input: UpdateBrandInput): Promise<Brand>;
  deleteBrand(ctx: CatalogContext, id: string): Promise<void>;
  listBrands(ctx: CatalogContext, query?: BrandQuery): Promise<PaginatedResult<Brand>>;
```

**Category operations**

```ts
  createCategory(ctx: CatalogContext, input: CreateCategoryInput): Promise<Category>;
  getCategoryById(ctx: CatalogContext, id: string): Promise<Category>;
  updateCategory(ctx: CatalogContext, id: string, input: UpdateCategoryInput): Promise<Category>;
  deleteCategory(ctx: CatalogContext, id: string): Promise<void>;
  listCategories(ctx: CatalogContext, query?: CategoryQuery): Promise<Category[]>;
```

**Image operations**

```ts
  uploadProductImage(ctx: CatalogContext, input: UploadProductImageInput): Promise<ProductImage>;
  deleteProductImage(ctx: CatalogContext, imageId: string): Promise<void>;
  setPrimaryProductImage(ctx: CatalogContext, productId: string, imageId: string): Promise<ProductImage>;
  reorderProductImages(ctx: CatalogContext, productId: string, imageIdsInOrder: string[]): Promise<ProductImage[]>;
  listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]>;
}
```

## Key types

### `CatalogContext`

```ts
type CatalogContext = {
  tenantId: string;
  catalogId: string;
  actor?: {
    id: string;
    type: 'user' | 'system' | 'api' | 'import';
  };
};
```

Every service method takes a `CatalogContext`. The Host constructs it from its auth session or request context and injects it per call. Tenant isolation is enforced by the module on every read and write.

### `ProductStatus`

`'draft' | 'active' | 'inactive' | 'archived'`

`archiveProduct` sets status to `'archived'` and records `archivedAt`. `restoreProduct` clears `archivedAt` and returns to `'inactive'` (or the previous non-archived status).

### `AttributeValue`

A typed discriminated union for product and variant custom attributes:

```ts
type AttributeValue =
  | { type: 'string';     value: string }
  | { type: 'number';     value: number }
  | { type: 'boolean';    value: boolean }
  | { type: 'date';       value: string }          // ISO 8601 date string
  | { type: 'enum';       value: string;  options: string[] }
  | { type: 'multi_enum'; value: string[]; options: string[] };

type CustomAttributeMap = Record<string, AttributeValue>;
```

### `PaginatedResult<T>`

```ts
type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};
```

Returned by `listProducts`, `searchProducts`, and `listBrands`. `listCategories` returns `Category[]` directly (no pagination).

## Config contract

### `ProductCatalogConfig`

```ts
type ProductCatalogConfig = {
  dataRepository: ProductRepository;
  mediaStorage: MediaStorage;
  logger?: StructuredLogger;
  auditSink?: AuditSink;
  defaults?: {
    currency?: string;
    pageSize?: number;
    maxPageSize?: number;
  };
};
```

| Field | Required | Default | Description |
|---|---|---|---|
| `dataRepository` | **Yes** | — | `ProductRepository` implementation. Construct with `createCsvProductRepository()` for Phase 0–1. |
| `mediaStorage` | **Yes** | — | `MediaStorage` implementation. Construct with `createLocalMediaStorage()` for Phase 0–1. |
| `logger` | No | `undefined` | Host-provided `StructuredLogger`. If omitted, no log entries are emitted. |
| `auditSink` | No | `undefined` | Host-provided `AuditSink`. If omitted, no audit events are recorded. |
| `defaults.currency` | No | `'THB'` | Default ISO 4217 currency code applied to new products when `currency` is not provided in `CreateProductInput`. |
| `defaults.pageSize` | No | `20` | Default page size for list operations when `limit` is not specified. |
| `defaults.maxPageSize` | No | `100` | Hard upper bound on `limit` for all list operations. Query `limit` values above this are silently clamped down. Page numbers below 1 are clamped to 1. |

Missing `dataRepository` or `mediaStorage` throws `CONFIGURATION_ERROR` at construction — the service cannot be used.

### `CsvProductRepositoryOptions`

```ts
type CsvProductRepositoryOptions = {
  dataDirectory: string;    // REQUIRED — absolute path to the CSV data directory
  lockTimeoutMs?: number;   // default 3000
};
```

| Field | Default | Description |
|---|---|---|
| `dataDirectory` | — | Directory to store the five CSV files. Created recursively on first use. |
| `lockTimeoutMs` | `3000` | How long (ms) to wait to acquire a file lock before throwing `CSV_LOCKED`. |

### `LocalMediaStorageOptions`

```ts
type LocalMediaStorageOptions = {
  baseUploadDir: string;       // REQUIRED — absolute path to media storage root
  publicBaseUrl: string;       // REQUIRED — base URL prepended to storage keys
  maxFileSizeByte?: number;    // default 5 * 1024 * 1024 (5 MiB)
};
```

| Field | Default | Description |
|---|---|---|
| `baseUploadDir` | — | Root directory for uploaded files. Created recursively on first use. |
| `publicBaseUrl` | — | Prepended to storage keys to form `publicUrl` (e.g. `https://static.example.com`). |
| `maxFileSizeByte` | `5242880` (5 MiB) | Maximum accepted file size in bytes. Files larger than this throw `INVALID_PRODUCT_DATA`. |

## CSV adapter behavior

The CSV adapter implements `ProductRepository` using five local CSV files:

| File | Contents |
|---|---|
| `products.csv` | All product rows |
| `variants.csv` | All variant rows |
| `brands.csv` | All brand rows |
| `categories.csv` | All category rows |
| `product_images.csv` | All product image rows |

Each file is created with a header row on first use. Reads load the entire file into memory; writes use atomic rename (`write → tmp → fsync → rename → .bak`).

**Locking:** Each file is guarded by a `<file>.lock` created with the `'wx'` flag. The adapter polls every 50 ms up to `lockTimeoutMs`; if the lock is not acquired it throws `CSV_LOCKED`. Only one process can hold a file lock at a time.

**Encoding:** UTF-8, RFC 4180-style quoting. Values that contain commas, newlines, or double-quotes are quoted; embedded double-quotes are escaped as `""`. Thai characters and Unicode are supported.

**Validation:** On every read, the adapter validates the header row, column counts, and field types. Corruption in any of these throws `CSV_CORRUPTED`.

**Tenant isolation:** Every query and mutation is filtered by `tenantId` + `catalogId` from the provided `CatalogContext`. A lookup for a record that belongs to a different tenant returns `null` — which the service then surfaces as `PRODUCT_NOT_FOUND`.

**Cascade delete:** `deleteProduct` cascades to all variants and product images that share the same `productId`, `tenantId`, and `catalogId`.

**`searchProducts`:** Equivalent to `listProducts` with additional full-text filtering. The search term matches `name`, `sku`, `description`, brand name, and category name — all case-insensitive. Default sort is `createdAt` descending (newest first).

**Slug generation:** `createProduct`, `createBrand`, and `createCategory` auto-generate a URL-safe slug from the `name` if `slug` is not provided. On `updateProduct`, the slug is preserved unless `UpdateProductInput.updateSlug: true` is set or a new `slug` is explicitly provided.

**Duplicate SKU:** Creating or updating a product or variant with an SKU that already exists in the same catalog throws `DUPLICATE_SKU`.

---

> ⚠️ **KNOWN LIMITATION — NOT for high-concurrency or multi-process use:**
>
> The CSV adapter serialises writes through a single-process file lock and reads the entire table into memory on every query. It **must not** be used in:
> - Horizontally scaled / multi-instance deployments (multiple processes sharing a file path)
> - High write-throughput workloads (every mutate holds an exclusive lock)
> - Very large catalogs (entire table loaded per query)
>
> For those workloads, use a real database adapter (Supabase/Postgres — future phases). The CSV adapter is suitable for: small-to-medium catalogs, local development, single-process applications, and prototype/staging environments.

---

## Local image adapter behavior

The local image adapter implements `MediaStorage` using the host filesystem under `baseUploadDir`.

**Storage key layout:** `uploads/products/{productId}/{uuid}.{ext}` — generated internally; the original `fileName` is sanitized and stored only as metadata.

**Upload pipeline:**
1. Reject files exceeding `maxFileSizeByte` → `INVALID_PRODUCT_DATA`.
2. Perform magic-byte MIME detection from the raw buffer:
   - JPEG: first 3 bytes `0xFF 0xD8 0xFF`
   - PNG: 8-byte PNG signature `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
   - WEBP: bytes `[0–3]` = `RIFF` and `[8–11]` = `WEBP`
3. Reject if detected MIME does not match declared `mimeType` → `MEDIA_UPLOAD_FAILED`.
4. Reject any MIME not in the allowlist (`image/jpeg`, `image/png`, `image/webp`) → `INVALID_PRODUCT_DATA`.
5. Generate a UUID filename, write to disk, fsync.

**Path traversal protection:** All storage keys are normalized (backslashes → forward slashes, leading slashes stripped, NUL bytes rejected). `assertSafePath` verifies the resolved absolute path stays within `baseUploadDir`. Any violation throws `STORAGE_ERROR: 'Path traversal detected'`.

**Filename sanitization:** `sanitizeFileName` strips control characters, path separators, and `..` sequences from the original filename before storing it as metadata.

**Delete:** Idempotent `unlink` — does not throw if the file is already absent.

**Other methods:** `exists`, `getPublicUrl` (`publicBaseUrl + '/' + storageKey`), `getMetadata` (stat + magic-byte MIME re-detection), `move`, `copy`.

## Adapter interfaces

These interfaces are the contract between core and adapters. Implement either to swap the underlying storage provider without changing core code.

### `ProductRepository`

```ts
interface ProductRepository {
  // Products
  createProduct / getProductById / getProductBySku / getProductBySlug
  updateProduct / deleteProduct / listProducts / searchProducts
  // Variants
  createVariant / getVariantById / getVariantBySku / updateVariant / deleteVariant / listVariantsByProductId
  // Brands
  createBrand / getBrandById / getBrandBySlug / updateBrand / deleteBrand / listBrands
  // Categories
  createCategory / getCategoryById / getCategoryBySlug / updateCategory / deleteCategory / listCategories
  // Images
  createProductImage / getProductImageById / updateProductImage / deleteProductImage / listProductImages
}
```

Repository `get*` methods return `T | null` (not throw) when a record is not found. The service layer converts `null` to `ProductCatalogError(PRODUCT_NOT_FOUND)`.

### `MediaStorage`

```ts
interface MediaStorage {
  upload(input: UploadMediaInput): Promise<MediaStorageOutput>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  getPublicUrl(storageKey: string): string;
  getMetadata(storageKey: string): Promise<MediaMetadata>;
  move(sourceKey: string, targetKey: string): Promise<MediaStorageOutput>;
  copy(sourceKey: string, targetKey: string): Promise<MediaStorageOutput>;
}
```

## Error model

All failures throw `ProductCatalogError`. The module never returns error objects for service-level failures — every failure path throws.

| Code | Trigger |
|---|---|
| `PRODUCT_NOT_FOUND` | `getProductById` / `getProductBySku` / `getProductBySlug` for a missing product; `setPrimaryProductImage` / `deleteProductImage` referencing a missing image |
| `DUPLICATE_SKU` | Creating or updating a product or variant whose SKU already exists in the same catalog |
| `INVALID_PRODUCT_DATA` | Missing or empty `name`/`sku`; negative or non-finite `price`; invalid `currency`, `status`, or `stockQuantity`; invalid custom attribute; bad `metadata`; non-existent `brandId` or `categoryId`; file over size limit; unsupported MIME type; reorder list mismatch |
| `INVALID_VARIANT` | Variant not found; missing `name`; negative price; invalid attribute on variant |
| `INVALID_CATEGORY` | Category not found; invalid category input; self-referencing `parentId`; cycle detected in category hierarchy; non-existent `parentId` |
| `STORAGE_ERROR` | Low-level filesystem failure; file lock acquire error fallback; path traversal detected |
| `MEDIA_UPLOAD_FAILED` | Media upload failed — includes magic-byte MIME mismatch, corrupted buffer, unsupported file |
| `MEDIA_DELETE_FAILED` | Media delete failed at the storage layer |
| `CSV_LOCKED` | File lock not acquired within `lockTimeoutMs` |
| `CSV_CORRUPTED` | CSV header missing or wrong; schema mismatch; column count mismatch; malformed or unclosed quotes; corrupted numeric or boolean field |
| `PROVIDER_UNAVAILABLE` | Any non-`ProductCatalogError` thrown inside a service operation (unexpected adapter failure, network error on future adapters) |
| `CONFIGURATION_ERROR` | `dataRepository` or `mediaStorage` missing from config at construction time; adapter missing a required option |

## Security

1. **No secret logging.** `LogEntry` never carries credentials, keys, or secrets. The module design mandates that `StructuredLogger` implementations must not log sensitive fields. The log schema includes only operation metadata (`tenantId`, `catalogId`, `productId`, `provider`, `durationMs`, `result`, `errorCode`).

2. **No env access.** The module never reads `process.env`, `env`, or `globalThis.process`. All configuration is supplied explicitly by the Host via `ProductCatalogConfig`. Adapters receive their options at construction time from the Host.

3. **Path traversal protection.** `LocalMediaStorage` normalises all storage keys (backslashes → forward slashes, leading slashes stripped, NUL bytes rejected). `assertSafePath` verifies the fully-resolved absolute path stays within `baseUploadDir`. Any violation throws `STORAGE_ERROR: 'Path traversal detected'` before any file I/O occurs. Original filenames are sanitized via `sanitizeFileName` (strips control characters, path separators, `..`) and stored only as metadata — they never influence the storage path.

4. **MIME validation.** Magic-byte detection runs server-side on the raw buffer. The module never trusts the client-declared `mimeType` alone: the detected MIME must match the declared MIME, and both must be in the allowlist (`image/jpeg`, `image/png`, `image/webp`). File size is also checked against `maxFileSizeByte` before writing.

5. **Tenant scoping.** Every read and write operation is scoped by `tenantId` + `catalogId` from the caller-supplied `CatalogContext`. A lookup for a row that exists but belongs to a different tenant returns `null` — which the service surfaces as `PRODUCT_NOT_FOUND`. There is no code path that returns or mutates cross-tenant data.

## How to integrate

### Steps

1. Copy the module folder (`modules/product-catalog/`) into your repo.
2. Read `dataDirectory` and `baseUploadDir` (and any other secrets) from your own env or config — the module never touches env.
3. Construct adapters:
   ```ts
   const dataRepository = createCsvProductRepository({ dataDirectory: '/data/catalog' });
   const mediaStorage = createLocalMediaStorage({
     baseUploadDir: '/data/media',
     publicBaseUrl: 'https://static.example.com',
   });
   ```
4. Implement `StructuredLogger` and `AuditSink` in your Host (or pass `undefined` to disable):
   ```ts
   const logger: StructuredLogger = { log: (entry) => yourLogSystem.write(entry) };
   const auditSink: AuditSink = { record: async (event) => yourDb.insertAuditEvent(event) };
   ```
5. Build a `ProductCatalogConfig` and call `createProductCatalogService(config)`.
6. Construct a `CatalogContext` from your auth session per request/operation.
7. Call service methods. Catch `ProductCatalogError` and map `error.code` to your host-side response.

### Quick reference

```ts
import {
  createProductCatalogService,
  createCsvProductRepository,
  createLocalMediaStorage,
  ProductCatalogError,
} from './index.js';
import type { CatalogContext } from './index.js';

const service = createProductCatalogService({
  dataRepository: createCsvProductRepository({ dataDirectory: '/data/catalog' }),
  mediaStorage: createLocalMediaStorage({
    baseUploadDir: '/data/media',
    publicBaseUrl: 'https://static.example.com',
  }),
  defaults: { currency: 'THB', pageSize: 20 },
});

const ctx: CatalogContext = {
  tenantId: 'my-tenant',
  catalogId: 'main',
  actor: { id: 'user-123', type: 'user' },
};

// Create
const product = await service.createProduct(ctx, {
  sku: 'SKU-001',
  name: 'My Product',
  price: 1999,
});

// Read
const found = await service.getProductById(ctx, product.id);

// List with pagination
const page = await service.listProducts(ctx, { page: 1, limit: 20, status: 'active' });

// Search
const results = await service.searchProducts(ctx, {
  search: 'keyword',
  sort: { field: 'price', order: 'asc' },
});

// Upload image
const image = await service.uploadProductImage(ctx, {
  productId: product.id,
  fileName: 'hero.png',
  mimeType: 'image/png',
  fileBuffer: pngBytes,
  isPrimary: true,
});

// Error handling
try {
  await service.getProductById(ctx, 'nonexistent');
} catch (err) {
  if (err instanceof ProductCatalogError) {
    switch (err.code) {
      case 'PRODUCT_NOT_FOUND':
        // return 404
        break;
      case 'DUPLICATE_SKU':
        // return 409
        break;
      case 'INVALID_PRODUCT_DATA':
        // return 400
        break;
      default:
        // return 500
    }
  }
}
```

See `examples/integration.example.ts` for the full wiring example with brand, category, variant, image upload, pagination, archive/restore, and error handling.

### Integration checklist

- [ ] Copy the module folder into the target repo
- [ ] Read all paths and URLs from your own env — never pass `process.env` references into the module itself
- [ ] Pass `dataDirectory` as an absolute path; ensure the process has write permission to that directory
- [ ] Pass `baseUploadDir` as an absolute path and `publicBaseUrl` as the public-facing URL prefix for images
- [ ] Set `maxFileSizeByte` if your product images exceed the 5 MiB default
- [ ] Implement and inject `StructuredLogger` — do not skip in production; `undefined` means silent failures
- [ ] Implement and inject `AuditSink` if you need a change log for the catalog
- [ ] Set `defaults.currency` to your catalog's ISO 4217 currency code
- [ ] Catch `ProductCatalogError` in every handler and map `error.code` to the appropriate host-side response status
- [ ] Do NOT use the CSV adapter in multi-process or horizontally scaled deployments (see Known Limitation above)
- [ ] Run `npx tsc --noEmit` before deploy

## Versioning

Standard semver — bump the version in `VERSION` on every change. No CHANGELOG or migration guide until the module has been embedded in ≥ 2 real projects and the contract has stabilized.

## Promote to shared package when

The module has been embedded in ≥ 2–3 projects without changes to the `core/` contract (only adapter or config changes on the Host side) — then extract to an npm package.
