import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProductCatalogService,
  createCsvProductRepository,
  createLocalMediaStorage,
  ProductCatalogError,
} from '../../index.js';
import type {
  CatalogContext,
  MediaStorage,
  Product,
  ProductImage,
  ProductRepository,
} from '../../index.js';

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

const CTX: CatalogContext = { tenantId: 'tenant-fail', catalogId: 'catalog-fail' };

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'pc-svc-fail-'));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function makeProduct(): Product {
  const now = new Date().toISOString();
  return {
    id: 'prod_fail_001',
    tenantId: CTX.tenantId,
    catalogId: CTX.catalogId,
    sku: 'FAIL-001',
    name: 'Fail Product',
    slug: 'fail-product',
    description: null,
    shortDescription: null,
    status: 'draft',
    brandId: null,
    categoryId: null,
    price: 100,
    compareAtPrice: null,
    costPrice: null,
    currency: 'THB',
    stockQuantity: 0,
    trackInventory: true,
    isActive: true,
    isFeatured: false,
    primaryImageId: null,
    attributes: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function noopRepo(): ProductRepository {
  const notImpl = () => {
    throw new Error('not implemented');
  };
  return {
    createProduct: notImpl as never,
    getProductById: notImpl as never,
    getProductBySku: notImpl as never,
    getProductBySlug: notImpl as never,
    updateProduct: notImpl as never,
    deleteProduct: notImpl as never,
    listProducts: notImpl as never,
    searchProducts: notImpl as never,
    createVariant: notImpl as never,
    getVariantById: notImpl as never,
    getVariantBySku: notImpl as never,
    updateVariant: notImpl as never,
    deleteVariant: notImpl as never,
    listVariantsByProductId: notImpl as never,
    createBrand: notImpl as never,
    getBrandById: notImpl as never,
    getBrandBySlug: notImpl as never,
    updateBrand: notImpl as never,
    deleteBrand: notImpl as never,
    listBrands: notImpl as never,
    createCategory: notImpl as never,
    getCategoryById: notImpl as never,
    getCategoryBySlug: notImpl as never,
    updateCategory: notImpl as never,
    deleteCategory: notImpl as never,
    listCategories: notImpl as never,
    createProductImage: notImpl as never,
    getProductImageById: notImpl as never,
    updateProductImage: notImpl as never,
    deleteProductImage: notImpl as never,
    listProductImages: notImpl as never,
  };
}

function noopStorage(): MediaStorage {
  const notImpl = () => {
    throw new Error('not implemented');
  };
  return {
    upload: notImpl as never,
    delete: notImpl as never,
    exists: notImpl as never,
    getPublicUrl: notImpl as never,
    getMetadata: notImpl as never,
    move: notImpl as never,
    copy: notImpl as never,
  };
}

describe('service failure mapping', () => {
  describe('CONFIGURATION_ERROR', () => {
    it('throws when dataRepository is missing', () => {
      expect(() =>
        createProductCatalogService({ dataRepository: undefined as never, mediaStorage: noopStorage() })
      ).toThrow(ProductCatalogError);
      try {
        createProductCatalogService({ dataRepository: undefined as never, mediaStorage: noopStorage() });
      } catch (error) {
        expect((error as ProductCatalogError).code).toBe('CONFIGURATION_ERROR');
      }
    });

    it('throws when mediaStorage is missing', () => {
      expect(() =>
        createProductCatalogService({ dataRepository: noopRepo(), mediaStorage: undefined as never })
      ).toThrow(ProductCatalogError);
    });

    it('throws when both are missing', () => {
      expect(() =>
        createProductCatalogService({ dataRepository: undefined as never, mediaStorage: undefined as never })
      ).toThrow(ProductCatalogError);
    });
  });

  describe('provider error mapping', () => {
    it('maps generic Error from repo to PROVIDER_UNAVAILABLE', async () => {
      const repo = noopRepo();
      repo.createProduct = (() => {
        throw new Error('boom');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: noopStorage() });

      await expect(
        service.createProduct(CTX, { sku: 'X-001', name: 'Test', price: 100 })
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });

    it('propagates ProductCatalogError from repo unchanged', async () => {
      const repo = noopRepo();
      repo.getProductBySku = (async () => null) as never;
      repo.getProductBySlug = (async () => null) as never;
      repo.createProduct = (() => {
        throw new ProductCatalogError('dup', 'DUPLICATE_SKU');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: noopStorage() });

      await expect(
        service.createProduct(CTX, { sku: 'X-002', name: 'Test', price: 100 })
      ).rejects.toMatchObject({ code: 'DUPLICATE_SKU' });
    });

    it('maps generic Error from repo.getProductById to PROVIDER_UNAVAILABLE', async () => {
      const repo = noopRepo();
      repo.getProductById = (() => {
        throw new Error('connection lost');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: noopStorage() });

      await expect(service.getProductById(CTX, 'any')).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    });
  });

  describe('media upload failures', () => {
    it('maps mediaStorage.upload throwing generic Error to MEDIA_UPLOAD_FAILED', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const storage = noopStorage();
      storage.upload = (() => {
        throw new Error('upload fail');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'test.png',
          mimeType: 'image/png',
          fileBuffer: PNG_1X1,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('maps mediaStorage.upload rejecting to MEDIA_UPLOAD_FAILED', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const storage = noopStorage();
      storage.upload = (async () => {
        throw new Error('async upload error');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'test.png',
          mimeType: 'image/png',
          fileBuffer: PNG_1X1,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });
  });

  describe('media delete failures', () => {
    it('maps mediaStorage.delete throwing to MEDIA_DELETE_FAILED', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      const image: ProductImage = {
        id: 'img_fail_001',
        tenantId: CTX.tenantId,
        catalogId: CTX.catalogId,
        productId: product.id,
        storageProvider: 'local',
        storageKey: 'uploads/test.png',
        publicUrl: 'http://localhost/test.png',
        fileName: 'test.png',
        mimeType: 'image/png',
        fileSize: 100,
        width: null,
        height: null,
        altText: null,
        sortOrder: 0,
        isPrimary: false,
        createdAt: new Date().toISOString(),
      };
      repo.getProductImageById = (async () => image) as never;
      repo.getProductById = (async () => product) as never;
      const storage = noopStorage();
      storage.delete = (() => {
        throw new Error('delete fail');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(service.deleteProductImage(CTX, image.id)).rejects.toMatchObject({
        code: 'MEDIA_DELETE_FAILED',
      });
    });
  });

  describe('invalid image via service', () => {
    it('rejects unsupported mimeType (image/gif) with INVALID_PRODUCT_DATA', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const storage = noopStorage();
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'test.gif',
          mimeType: 'image/gif',
          fileBuffer: new Uint8Array([0x01, 0x02, 0x03]),
        })
      ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_DATA' });
    });

    it('rejects correct mimeType but wrong magic bytes with MEDIA_UPLOAD_FAILED', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const uploadDir = path.join(tempDir, 'uploads');
      const storage = createLocalMediaStorage({
        baseUploadDir: uploadDir,
        publicBaseUrl: 'http://localhost:3000',
      });
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'fake.png',
          mimeType: 'image/png',
          fileBuffer: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('rejects oversized file with INVALID_PRODUCT_DATA', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const uploadDir = path.join(tempDir, 'uploads');
      const storage = createLocalMediaStorage({
        baseUploadDir: uploadDir,
        publicBaseUrl: 'http://localhost:3000',
        maxFileSizeByte: 4,
      });
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'big.png',
          mimeType: 'image/png',
          fileBuffer: new Uint8Array([...PNG_1X1, 0x00, 0x00]),
        })
      ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_DATA' });
    });
  });

  describe('timeout-like behavior', () => {
    it('rejects with MEDIA_UPLOAD_FAILED when upload rejects after a delay', async () => {
      const repo = noopRepo();
      const product = makeProduct();
      repo.getProductById = (async () => product) as never;
      const storage = noopStorage();
      storage.upload = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('timeout upload');
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'slow.png',
          mimeType: 'image/png',
          fileBuffer: PNG_1X1,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });
  });

  describe('EACCES-like error from repo', () => {
    it('maps EACCES-like error to PROVIDER_UNAVAILABLE (not STORAGE_ERROR)', async () => {
      const repo = noopRepo();
      const eaccesModuleError: Error & { code?: string } = new Error('permission denied');
      eaccesModuleError.code = 'EACCES';
      repo.createProduct = (() => {
        throw eaccesModuleError;
      }) as never;
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: noopStorage() });

      await expect(
        service.createProduct(CTX, { sku: 'X-EACC-001', name: 'Test', price: 100 })
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });
  });

  describe('end-to-end with real CSV adapter', () => {
    it('createProduct then getProductById round trips through service with real adapters', async () => {
      const dataDir = path.join(tempDir, 'data');
      const uploadDir = path.join(tempDir, 'uploads');
      const repo = createCsvProductRepository({ dataDirectory: dataDir });
      const storage = createLocalMediaStorage({
        baseUploadDir: uploadDir,
        publicBaseUrl: 'http://localhost:3000',
      });
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      const product = await service.createProduct(CTX, { sku: 'E2E-001', name: 'End to End', price: 200 });
      const found = await service.getProductById(CTX, product.id);
      expect(found.sku).toBe('E2E-001');

      const uploaded = await service.uploadProductImage(CTX, {
        productId: product.id,
        fileName: 'real.png',
        mimeType: 'image/png',
        fileBuffer: PNG_1X1,
      });
      expect(uploaded.mimeType).toBe('image/png');
      expect(uploaded.isPrimary).toBe(true);
    });

    it('uploadProductImage with correct mimeType but random bytes fails with MEDIA_UPLOAD_FAILED', async () => {
      const dataDir = path.join(tempDir, 'data2');
      const uploadDir = path.join(tempDir, 'uploads2');
      const repo = createCsvProductRepository({ dataDirectory: dataDir });
      const storage = createLocalMediaStorage({
        baseUploadDir: uploadDir,
        publicBaseUrl: 'http://localhost:3000',
      });
      const service = createProductCatalogService({ dataRepository: repo, mediaStorage: storage });

      const product = await service.createProduct(CTX, { sku: 'E2E-002', name: 'Bad Image', price: 50 });
      await expect(
        service.uploadProductImage(CTX, {
          productId: product.id,
          fileName: 'random.png',
          mimeType: 'image/png',
          fileBuffer: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });
  });
});