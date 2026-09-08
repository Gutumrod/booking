import { ProductCatalogError } from '../errors.js';
import type { CreateProductInput, ProductStatus, UpdateProductInput } from '../types.js';
import { validateCustomAttributes } from './attribute.validator.js';

const STATUS_VALUES = new Set<ProductStatus>(['draft', 'active', 'inactive', 'archived']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function validateCreateProductInput(input: CreateProductInput): void {
  if (!input.sku || typeof input.sku !== 'string') {
    throw new ProductCatalogError('Product sku is required', 'INVALID_PRODUCT_DATA');
  }
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new ProductCatalogError('Product name is required', 'INVALID_PRODUCT_DATA');
  }
  validateProductPatch(input);
}

export function validateUpdateProductInput(input: UpdateProductInput): void {
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length === 0)) {
    throw new ProductCatalogError('Product name must not be empty', 'INVALID_PRODUCT_DATA');
  }
  validateProductPatch(input);
}

function validateProductPatch(input: Partial<CreateProductInput>): void {
  for (const [key, value] of Object.entries({
    price: input.price,
    compareAtPrice: input.compareAtPrice,
    costPrice: input.costPrice,
  })) {
    if (value !== undefined && (typeof value !== 'number' || value < 0 || !Number.isFinite(value))) {
      throw new ProductCatalogError(`${key} must be a non-negative finite number`, 'INVALID_PRODUCT_DATA');
    }
  }

  if (input.currency !== undefined && !CURRENCY_PATTERN.test(input.currency)) {
    throw new ProductCatalogError('Currency must be ISO 4217 uppercase code', 'INVALID_PRODUCT_DATA');
  }
  if (input.status !== undefined && !STATUS_VALUES.has(input.status)) {
    throw new ProductCatalogError('Invalid product status', 'INVALID_PRODUCT_DATA');
  }
  if (input.stockQuantity !== undefined && (!Number.isFinite(input.stockQuantity) || input.stockQuantity < 0)) {
    throw new ProductCatalogError('stockQuantity must be a non-negative number', 'INVALID_PRODUCT_DATA');
  }
  if (input.attributes !== undefined) {
    validateCustomAttributes(input.attributes);
  }
  if (input.metadata !== undefined && !isPlainRecord(input.metadata)) {
    throw new ProductCatalogError('metadata must be a plain object', 'INVALID_PRODUCT_DATA');
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
