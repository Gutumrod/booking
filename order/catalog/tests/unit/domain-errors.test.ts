import { describe, expect, it } from 'vitest';
import { ProductCatalogError } from '../../index.js';

describe('ProductCatalogError', () => {
  it('is an instance of Error', () => {
    const error = new ProductCatalogError('something went wrong', 'PRODUCT_NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
  });

  it('sets name to "ProductCatalogError"', () => {
    const error = new ProductCatalogError('msg', 'DUPLICATE_SKU');
    expect(error.name).toBe('ProductCatalogError');
  });

  it('sets the message from the first argument', () => {
    const error = new ProductCatalogError('custom message', 'STORAGE_ERROR');
    expect(error.message).toBe('custom message');
  });

  it('sets the code property', () => {
    const error = new ProductCatalogError('msg', 'INVALID_PRODUCT_DATA');
    expect(error.code).toBe('INVALID_PRODUCT_DATA');
  });

  it('sets details when provided', () => {
    const error = new ProductCatalogError('msg', 'CSV_CORRUPTED', { row: 5, col: 3 });
    expect(error.details).toEqual({ row: 5, col: 3 });
  });

  it('sets details to undefined when not provided', () => {
    const error = new ProductCatalogError('msg', 'CSV_CORRUPTED');
    expect(error.details).toBeUndefined();
  });

  it('sets cause when provided', () => {
    const rootCause = new Error('root failure');
    const error = new ProductCatalogError('msg', 'PROVIDER_UNAVAILABLE', undefined, rootCause);
    expect(error.cause).toBe(rootCause);
  });

  it('sets cause to undefined when not provided', () => {
    const error = new ProductCatalogError('msg', 'PROVIDER_UNAVAILABLE');
    expect(error.cause).toBeUndefined();
  });

  it('supports all 12 error codes', () => {
    const codes = [
      'PRODUCT_NOT_FOUND',
      'DUPLICATE_SKU',
      'INVALID_PRODUCT_DATA',
      'INVALID_VARIANT',
      'INVALID_CATEGORY',
      'STORAGE_ERROR',
      'MEDIA_UPLOAD_FAILED',
      'MEDIA_DELETE_FAILED',
      'CSV_LOCKED',
      'CSV_CORRUPTED',
      'PROVIDER_UNAVAILABLE',
      'CONFIGURATION_ERROR',
    ] as const;

    for (const code of codes) {
      const error: ProductCatalogError = new ProductCatalogError(`msg for ${code}`, code);
      expect(error.code).toBe(code);
    }
  });

  it('can be caught with instanceof check in try/catch', () => {
    try {
      throw new ProductCatalogError('fail', 'CONFIGURATION_ERROR');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductCatalogError);
      if (error instanceof ProductCatalogError) {
        expect(error.code).toBe('CONFIGURATION_ERROR');
      }
    }
  });

  it('preserves stack trace', () => {
    const error = new ProductCatalogError('fail', 'STORAGE_ERROR');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ProductCatalogError');
  });
});