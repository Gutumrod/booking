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
  override readonly cause?: unknown;

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
