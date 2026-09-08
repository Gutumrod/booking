import { ProductCatalogError } from '../errors.js';
import { isValidSku, normalizeSku } from '../utils/sku.js';

export { normalizeSku };

export function validateSku(sku: string): string {
  const normalized = normalizeSku(sku);
  if (!isValidSku(normalized)) {
    throw new ProductCatalogError('SKU must match /^[A-Z0-9_-]{3,64}$/ after normalization', 'INVALID_PRODUCT_DATA', {
      sku: normalized,
    });
  }
  return normalized;
}
