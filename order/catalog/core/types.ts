import type { ProductCatalogErrorCode } from './errors.js';

export type CatalogContext = {
  tenantId: string;
  catalogId: string;
  actor?: {
    id: string;
    type: 'user' | 'system' | 'api' | 'import';
  };
};

export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived';

export type AttributeValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'enum'; value: string; options: string[] }
  | { type: 'multi_enum'; value: string[]; options: string[] };

export type CustomAttributeMap = Record<string, AttributeValue>;

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
  currency: string;
  stockQuantity: number;
  trackInventory: boolean;
  isActive: boolean;
  isFeatured: boolean;
  primaryImageId: string | null;
  attributes: CustomAttributeMap;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

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

export type ProductImage = {
  id: string;
  tenantId: string;
  catalogId: string;
  productId: string;
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
};

export type CreateProductInput = {
  sku: string;
  name: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  status?: ProductStatus;
  brandId?: string;
  categoryId?: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  currency?: string;
  stockQuantity?: number;
  trackInventory?: boolean;
  isActive?: boolean;
  isFeatured?: boolean;
  attributes?: CustomAttributeMap;
  metadata?: Record<string, unknown>;
};

export type UpdateProductInput = Partial<CreateProductInput> & {
  updateSlug?: boolean;
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

export type SortField = 'createdAt' | 'updatedAt' | 'price' | 'name' | 'stockQuantity';
export type SortOrder = 'asc' | 'desc';

export type ProductQuery = {
  search?: string;
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
  page?: number;
  limit?: number;
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

export type BrandQuery = {
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

export type CategoryQuery = {
  parentId?: string | null;
  search?: string;
  isActive?: boolean;
};

export interface ProductRepository {
  createProduct(ctx: CatalogContext, product: Product): Promise<Product>;
  getProductById(ctx: CatalogContext, id: string): Promise<Product | null>;
  getProductBySku(ctx: CatalogContext, sku: string): Promise<Product | null>;
  getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product | null>;
  updateProduct(ctx: CatalogContext, product: Product): Promise<Product>;
  deleteProduct(ctx: CatalogContext, id: string): Promise<void>;
  listProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;
  searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;
  createVariant(ctx: CatalogContext, variant: Variant): Promise<Variant>;
  getVariantById(ctx: CatalogContext, id: string): Promise<Variant | null>;
  getVariantBySku(ctx: CatalogContext, sku: string): Promise<Variant | null>;
  updateVariant(ctx: CatalogContext, variant: Variant): Promise<Variant>;
  deleteVariant(ctx: CatalogContext, id: string): Promise<void>;
  listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]>;
  createBrand(ctx: CatalogContext, brand: Brand): Promise<Brand>;
  getBrandById(ctx: CatalogContext, id: string): Promise<Brand | null>;
  getBrandBySlug(ctx: CatalogContext, slug: string): Promise<Brand | null>;
  updateBrand(ctx: CatalogContext, brand: Brand): Promise<Brand>;
  deleteBrand(ctx: CatalogContext, id: string): Promise<void>;
  listBrands(ctx: CatalogContext, query?: BrandQuery): Promise<PaginatedResult<Brand>>;
  createCategory(ctx: CatalogContext, category: Category): Promise<Category>;
  getCategoryById(ctx: CatalogContext, id: string): Promise<Category | null>;
  getCategoryBySlug(ctx: CatalogContext, slug: string): Promise<Category | null>;
  updateCategory(ctx: CatalogContext, category: Category): Promise<Category>;
  deleteCategory(ctx: CatalogContext, id: string): Promise<void>;
  listCategories(ctx: CatalogContext, query?: CategoryQuery): Promise<Category[]>;
  createProductImage(ctx: CatalogContext, image: ProductImage): Promise<ProductImage>;
  getProductImageById(ctx: CatalogContext, id: string): Promise<ProductImage | null>;
  updateProductImage(ctx: CatalogContext, image: ProductImage): Promise<ProductImage>;
  deleteProductImage(ctx: CatalogContext, id: string): Promise<void>;
  listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]>;
}

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

export type ProductCatalogConfig = {
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
  operationId?: string;
};

export interface StructuredLogger {
  log(entry: LogEntry): void;
}

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
