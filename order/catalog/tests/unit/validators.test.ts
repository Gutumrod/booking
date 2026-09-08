import { describe, expect, it } from 'vitest';
import {
  ProductCatalogError,
  validateCreateProductInput,
  validateCustomAttributes,
  validateUpdateProductInput,
  normalizeSku,
  validateSku,
  isValidSku,
} from '../../core/index.js';

describe('normalizeSku', () => {
  it('trims, uppercases, and replaces invalid chars with dashes', () => {
    expect(normalizeSku(' helmet adv 001 ')).toBe('HELMET-ADV-001');
  });

  it('collapses consecutive dashes', () => {
    expect(normalizeSku('HELMET---ADV---001')).toBe('HELMET-ADV-001');
  });

  it('trims leading and trailing dashes', () => {
    expect(normalizeSku('---HELMET-ADV-001---')).toBe('HELMET-ADV-001');
  });

  it('uppercases lowercase letters', () => {
    expect(normalizeSku('helmet-adv-001')).toBe('HELMET-ADV-001');
  });

  it('leaves a valid SKU unchanged', () => {
    expect(normalizeSku('HELMET-ADV-001')).toBe('HELMET-ADV-001');
  });

  it('replaces spaces and special chars with dashes', () => {
    expect(normalizeSku('sku with spaces!@#')).toBe('SKU-WITH-SPACES');
  });
});

describe('isValidSku', () => {
  it('returns true for a valid SKU', () => {
    expect(isValidSku('HELMET-ADV-001')).toBe(true);
  });

  it('returns true for minimum length 3', () => {
    expect(isValidSku('ABC')).toBe(true);
  });

  it('returns false for too-short SKU (<3 chars)', () => {
    expect(isValidSku('AB')).toBe(false);
  });

  it('returns true for maximum length 64', () => {
    expect(isValidSku('A'.repeat(64))).toBe(true);
  });

  it('returns false for too-long SKU (>64 chars)', () => {
    expect(isValidSku('A'.repeat(65))).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidSku('')).toBe(false);
  });

  it('returns false for lowercase letters', () => {
    expect(isValidSku('abc')).toBe(false);
  });

  it('returns false for special characters not in A-Z0-9_-', () => {
    expect(isValidSku('ABC!DEF')).toBe(false);
  });
});

describe('validateSku', () => {
  it('returns normalized valid SKU', () => {
    expect(validateSku(' helmet adv 001 ')).toBe('HELMET-ADV-001');
  });

  it('throws INVALID_PRODUCT_DATA for empty string', () => {
    expect(() => validateSku('')).toThrow(ProductCatalogError);
    expect(() => validateSku('')).toThrow(/SKU/);
    try {
      validateSku('');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductCatalogError);
      expect((error as ProductCatalogError).code).toBe('INVALID_PRODUCT_DATA');
    }
  });

  it('throws INVALID_PRODUCT_DATA for too-short SKU', () => {
    expect(() => validateSku('AB')).toThrow(ProductCatalogError);
    try {
      validateSku('AB');
    } catch (error) {
      expect((error as ProductCatalogError).code).toBe('INVALID_PRODUCT_DATA');
    }
  });

  it('throws INVALID_PRODUCT_DATA for too-long SKU', () => {
    expect(() => validateSku('A'.repeat(65))).toThrow(ProductCatalogError);
  });

  it('includes normalized sku in details', () => {
    try {
      validateSku('  ');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductCatalogError);
      const details = (error as ProductCatalogError).details;
      expect(details).toBeDefined();
      expect(details?.sku).toBeDefined();
    }
  });
});

describe('validateCustomAttributes', () => {
  it('accepts a valid string attribute', () => {
    expect(() => validateCustomAttributes({ color: { type: 'string', value: 'red' } })).not.toThrow();
  });

  it('accepts a valid number attribute', () => {
    expect(() => validateCustomAttributes({ size: { type: 'number', value: 42 } })).not.toThrow();
  });

  it('accepts a valid boolean attribute', () => {
    expect(() => validateCustomAttributes({ certified: { type: 'boolean', value: true } })).not.toThrow();
  });

  it('accepts a valid date attribute', () => {
    expect(() =>
      validateCustomAttributes({ released: { type: 'date', value: '2024-01-15T00:00:00Z' } })
    ).not.toThrow();
  });

  it('accepts a valid enum attribute', () => {
    expect(() =>
      validateCustomAttributes({ color: { type: 'enum', value: 'red', options: ['red', 'blue'] } })
    ).not.toThrow();
  });

  it('accepts a valid multi_enum attribute', () => {
    expect(() =>
      validateCustomAttributes({
        sizes: { type: 'multi_enum', value: ['M', 'L'], options: ['S', 'M', 'L'] },
      })
    ).not.toThrow();
  });

  it('rejects string attribute with non-string value', () => {
    expect(() => validateCustomAttributes({ color: { type: 'string', value: 42 } as never })).toThrow(
      ProductCatalogError
    );
    try {
      validateCustomAttributes({ color: { type: 'string', value: 42 } as never });
    } catch (error) {
      expect((error as ProductCatalogError).code).toBe('INVALID_PRODUCT_DATA');
    }
  });

  it('rejects number attribute with non-number value', () => {
    expect(() => validateCustomAttributes({ size: { type: 'number', value: '42' } as never })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects number attribute with NaN', () => {
    expect(() => validateCustomAttributes({ size: { type: 'number', value: NaN } })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects number attribute with Infinity', () => {
    expect(() => validateCustomAttributes({ size: { type: 'number', value: Infinity } })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects boolean attribute with non-boolean value', () => {
    expect(() => validateCustomAttributes({ certified: { type: 'boolean', value: 'yes' } as never })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects date attribute with invalid date string', () => {
    expect(() => validateCustomAttributes({ released: { type: 'date', value: 'not-a-date' } })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects enum attribute with value not in options', () => {
    expect(() =>
      validateCustomAttributes({ color: { type: 'enum', value: 'green', options: ['red', 'blue'] } })
    ).toThrow(ProductCatalogError);
  });

  it('rejects multi_enum attribute with a value not in options', () => {
    expect(() =>
      validateCustomAttributes({
        sizes: { type: 'multi_enum', value: ['M', 'XL'], options: ['S', 'M', 'L'] },
      })
    ).toThrow(ProductCatalogError);
  });

  it('rejects unknown attribute type', () => {
    expect(() =>
      validateCustomAttributes({ custom: { type: 'custom' as never, value: 'x' } })
    ).toThrow(ProductCatalogError);
  });

  it('rejects attribute missing type', () => {
    expect(() => validateCustomAttributes({ bad: { value: 'x' } as never })).toThrow(ProductCatalogError);
  });

  it('accepts empty attributes map', () => {
    expect(() => validateCustomAttributes({})).not.toThrow();
  });
});

describe('validateCreateProductInput', () => {
  it('accepts valid input', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: 100, currency: 'THB' })
    ).not.toThrow();
  });

  it('rejects missing sku', () => {
    expect(() => validateCreateProductInput({ sku: '', name: 'Test', price: 100 } as never)).toThrow(
      ProductCatalogError
    );
  });

  it('rejects non-string sku', () => {
    expect(() => validateCreateProductInput({ sku: 123 as never, name: 'Test', price: 100 })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects missing name', () => {
    expect(() => validateCreateProductInput({ sku: 'SKU-001', name: '', price: 100 } as never)).toThrow(
      ProductCatalogError
    );
  });

  it('rejects whitespace-only name', () => {
    expect(() => validateCreateProductInput({ sku: 'SKU-001', name: '   ', price: 100 })).toThrow(
      ProductCatalogError
    );
  });

  it('rejects negative price', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: -1 })
    ).toThrow(ProductCatalogError);
  });

  it('rejects non-finite price', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: Infinity })
    ).toThrow(ProductCatalogError);
  });

  it('rejects negative compareAtPrice', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: 100, compareAtPrice: -5 })
    ).toThrow(ProductCatalogError);
  });

  it('rejects negative costPrice', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: 100, costPrice: -5 })
    ).toThrow(ProductCatalogError);
  });

  it('rejects invalid currency format', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: 100, currency: 'us' })
    ).toThrow(ProductCatalogError);
  });

  it('rejects invalid status', () => {
    expect(() =>
      validateCreateProductInput({
        sku: 'SKU-001',
        name: 'Test',
        price: 100,
        status: 'invalid' as never,
      })
    ).toThrow(ProductCatalogError);
  });

  it('rejects negative stockQuantity', () => {
    expect(() =>
      validateCreateProductInput({ sku: 'SKU-001', name: 'Test', price: 100, stockQuantity: -1 })
    ).toThrow(ProductCatalogError);
  });

  it('rejects non-number stockQuantity', () => {
    expect(() =>
      validateCreateProductInput({
        sku: 'SKU-001',
        name: 'Test',
        price: 100,
        stockQuantity: '5' as never,
      })
    ).toThrow(ProductCatalogError);
  });

  it('rejects metadata that is not a plain object', () => {
    expect(() =>
      validateCreateProductInput({
        sku: 'SKU-001',
        name: 'Test',
        price: 100,
        metadata: [1, 2] as never,
      })
    ).toThrow(ProductCatalogError);
  });

  it('rejects invalid attributes', () => {
    expect(() =>
      validateCreateProductInput({
        sku: 'SKU-001',
        name: 'Test',
        price: 100,
        attributes: { bad: { type: 'number', value: 'x' } as never },
      })
    ).toThrow(ProductCatalogError);
  });
});

describe('validateUpdateProductInput', () => {
  it('accepts partial input with name only', () => {
    expect(() => validateUpdateProductInput({ name: 'Updated' })).not.toThrow();
  });

  it('rejects empty name when provided', () => {
    expect(() => validateUpdateProductInput({ name: '' })).toThrow(ProductCatalogError);
  });

  it('rejects whitespace-only name when provided', () => {
    expect(() => validateUpdateProductInput({ name: '  ' })).toThrow(ProductCatalogError);
  });

  it('accepts undefined name (not updating)', () => {
    expect(() => validateUpdateProductInput({ price: 200 })).not.toThrow();
  });

  it('rejects negative price', () => {
    expect(() => validateUpdateProductInput({ price: -10 })).toThrow(ProductCatalogError);
  });

  it('rejects invalid currency', () => {
    expect(() => validateUpdateProductInput({ currency: 'us' })).toThrow(ProductCatalogError);
  });

  it('accepts valid currency uppercase', () => {
    expect(() => validateUpdateProductInput({ currency: 'USD' })).not.toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => validateUpdateProductInput({ status: 'bad' as never })).toThrow(ProductCatalogError);
  });

  it('accepts valid status', () => {
    expect(() => validateUpdateProductInput({ status: 'active' })).not.toThrow();
  });

  it('rejects invalid attributes', () => {
    expect(() =>
      validateUpdateProductInput({ attributes: { bad: { type: 'string', value: 42 } as never } })
    ).toThrow(ProductCatalogError);
  });
});