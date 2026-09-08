import { ProductCatalogError } from '../errors.js';
import type { CustomAttributeMap } from '../types.js';

export function validateCustomAttributes(attributes: CustomAttributeMap): void {
  for (const [key, attr] of Object.entries(attributes)) {
    if (!attr || typeof attr !== 'object' || !('type' in attr)) {
      throw new ProductCatalogError(`Attribute '${key}' must specify a valid 'type'`, 'INVALID_PRODUCT_DATA', {
        attributeKey: key,
      });
    }

    switch (attr.type) {
      case 'string':
        if (typeof attr.value !== 'string') {
          throw new ProductCatalogError(`Attribute '${key}' value must be a string`, 'INVALID_PRODUCT_DATA', {
            attributeKey: key,
          });
        }
        break;
      case 'number':
        if (typeof attr.value !== 'number' || Number.isNaN(attr.value) || !Number.isFinite(attr.value)) {
          throw new ProductCatalogError(`Attribute '${key}' value must be a valid number`, 'INVALID_PRODUCT_DATA', {
            attributeKey: key,
          });
        }
        break;
      case 'boolean':
        if (typeof attr.value !== 'boolean') {
          throw new ProductCatalogError(`Attribute '${key}' value must be a boolean`, 'INVALID_PRODUCT_DATA', {
            attributeKey: key,
          });
        }
        break;
      case 'date':
        if (typeof attr.value !== 'string' || Number.isNaN(Date.parse(attr.value))) {
          throw new ProductCatalogError(
            `Attribute '${key}' value must be an ISO8601 date string`,
            'INVALID_PRODUCT_DATA',
            { attributeKey: key }
          );
        }
        break;
      case 'enum':
        if (!Array.isArray(attr.options) || !attr.options.includes(attr.value)) {
          throw new ProductCatalogError(
            `Attribute '${key}' value '${attr.value}' is not in allowed enum options`,
            'INVALID_PRODUCT_DATA',
            { attributeKey: key }
          );
        }
        break;
      case 'multi_enum':
        if (
          !Array.isArray(attr.options) ||
          !Array.isArray(attr.value) ||
          !attr.value.every((value) => attr.options.includes(value))
        ) {
          throw new ProductCatalogError(
            `Attribute '${key}' multi_enum values are invalid or not in allowed options`,
            'INVALID_PRODUCT_DATA',
            { attributeKey: key }
          );
        }
        break;
      default:
        throw new ProductCatalogError(`Attribute '${key}' has unknown type`, 'INVALID_PRODUCT_DATA', {
          attributeKey: key,
        });
    }
  }
}
