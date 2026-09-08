export { createProductCatalogService } from './core/service.js';
export { ProductCatalogError } from './core/errors.js';
export { createCsvProductRepository } from './adapters/data/csv/csv-product.repository.js';
export { createLocalMediaStorage } from './adapters/media/local/local-media.storage.js';
export type { ProductCatalogErrorCode } from './core/errors.js';
export type { ProductCatalogService } from './core/service.js';
export type {
  AuditEvent,
  AuditEventType,
  AuditSink,
  AttributeValue,
  Brand,
  BrandQuery,
  CatalogContext,
  Category,
  CategoryQuery,
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  CreateVariantInput,
  CustomAttributeMap,
  LogEntry,
  LogLevel,
  MediaMetadata,
  MediaStorage,
  MediaStorageOutput,
  PaginatedResult,
  Product,
  ProductCatalogConfig,
  ProductImage,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  SortField,
  SortOrder,
  StructuredLogger,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateVariantInput,
  UploadMediaInput,
  UploadProductImageInput,
  Variant,
} from './core/types.js';
export type { CsvProductRepositoryOptions } from './adapters/data/csv/csv-product.repository.js';
export type { LocalMediaStorageOptions } from './adapters/media/local/local-media.storage.js';
