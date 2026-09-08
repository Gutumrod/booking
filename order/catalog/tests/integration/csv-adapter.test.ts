import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCsvProductRepository } from '../../index.js';
import type { Brand, CatalogContext, Category, Product, ProductImage, Variant } from '../../index.js';

const CTX: CatalogContext = { tenantId: 'tenant-csv', catalogId: 'catalog-csv' };

let tempDir: string;
let nextId = 0;
function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}_${nextId}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  const now = new Date().toISOString();
  return {
    id: uid('prod'),
    tenantId: CTX.tenantId,
    catalogId: CTX.catalogId,
    sku: uid('SKU').replace(/_/g, '-'),
    name: 'Test Product',
    slug: 'test-product',
    description: 'desc',
    shortDescription: 'short',
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
    ...overrides,
  };
}

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  const now = new Date().toISOString();
  return {
    id: uid('var'),
    tenantId: CTX.tenantId,
    catalogId: CTX.catalogId,
    productId: 'prod_0',
    sku: uid('VAR').replace(/_/g, '-'),
    name: 'Test Variant',
    price: 50,
    compareAtPrice: null,
    stockQuantity: 0,
    attributes: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'pc-csv-'));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('CsvProductRepository integration', () => {
  describe('round trip read/write', () => {
    it('creates a product and re-reads from a fresh repo instance on the same dir', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'RT-001', name: 'Round Trip' });
      await repo.createProduct(CTX, product);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getProductById(CTX, product.id);
      expect(found).not.toBeNull();
      expect(found!.sku).toBe('RT-001');
      expect(found!.name).toBe('Round Trip');
    });

    it('round trips a variant', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'RT-P-001' });
      await repo.createProduct(CTX, product);

      const variant = makeVariant({ productId: product.id, sku: 'RT-V-001', name: 'Red Variant' });
      await repo.createVariant(CTX, variant);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getVariantById(CTX, variant.id);
      expect(found).not.toBeNull();
      expect(found!.sku).toBe('RT-V-001');
      expect(found!.name).toBe('Red Variant');
    });

    it('round trips a brand', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const brand: Brand = {
        id: uid('brand'),
        tenantId: CTX.tenantId,
        catalogId: CTX.catalogId,
        name: 'TestBrand',
        slug: 'testbrand',
        description: 'A brand',
        logoUrl: 'http://example.com/logo.png',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repo.createBrand(CTX, brand);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getBrandById(CTX, brand.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('TestBrand');
      expect(found!.logoUrl).toBe('http://example.com/logo.png');
    });

    it('round trips a category', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const category: Category = {
        id: uid('cat'),
        tenantId: CTX.tenantId,
        catalogId: CTX.catalogId,
        parentId: null,
        name: 'TestCategory',
        slug: 'testcategory',
        description: 'A category',
        imageUrl: null,
        sortOrder: 5,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repo.createCategory(CTX, category);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getCategoryById(CTX, category.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('TestCategory');
      expect(found!.sortOrder).toBe(5);
    });

    it('round trips a product image record', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'IMG-P-001' });
      await repo.createProduct(CTX, product);

      const image: ProductImage = {
        id: uid('img'),
        tenantId: CTX.tenantId,
        catalogId: CTX.catalogId,
        productId: product.id,
        storageProvider: 'local',
        storageKey: 'uploads/products/p1/test.png',
        publicUrl: 'http://localhost:3000/uploads/products/p1/test.png',
        fileName: 'test.png',
        mimeType: 'image/png',
        fileSize: 1024,
        width: null,
        height: null,
        altText: 'test image',
        sortOrder: 0,
        isPrimary: true,
        createdAt: new Date().toISOString(),
      };
      await repo.createProductImage(CTX, image);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getProductImageById(CTX, image.id);
      expect(found).not.toBeNull();
      expect(found!.mimeType).toBe('image/png');
      expect(found!.fileSize).toBe(1024);
      expect(found!.isPrimary).toBe(true);
    });
  });

  describe('UTF-8 / Thai round trip', () => {
    it('stores and reads Thai product names and descriptions', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({
        sku: 'THAI-001',
        name: 'หมวกกันน็อค',
        description: 'หมวกกันน็อคแบบเต็มใบสำหรับการขับขี่รถจักรยานยนต์',
      });
      await repo.createProduct(CTX, product);

      const repo2 = createCsvProductRepository({ dataDirectory: tempDir });
      const found = await repo2.getProductById(CTX, product.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('หมวกกันน็อค');
      expect(found!.description).toBe('หมวกกันน็อคแบบเต็มใบสำหรับการขับขี่รถจักรยานยนต์');
    });
  });

  describe('atomic write', () => {
    it('leaves no .tmp.* files after a write', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      await repo.createProduct(CTX, makeProduct({ sku: 'ATOM-001' }));

      const files = await readdir(tempDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('produces a .bak file after a second write to an existing file', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      await repo.createProduct(CTX, makeProduct({ sku: 'BAK-001', name: 'First' }));
      await repo.createProduct(CTX, makeProduct({ sku: 'BAK-002', name: 'Second' }));

      const bakPath = path.join(tempDir, 'products.csv.bak');
      const bakExists = fs.existsSync(bakPath);
      expect(bakExists).toBe(true);
    });
  });

  describe('corruption detection', () => {
    it('throws CSV_CORRUPTED on header mismatch', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      await repo.createProduct(CTX, makeProduct({ sku: 'CORRUPT-001' }));

      const productsPath = path.join(tempDir, 'products.csv');
      await writeFile(productsPath, 'wrong,header,here\nval1,val2,val3\n', 'utf8');

      await expect(repo.getProductById(CTX, 'any')).rejects.toMatchObject({
        code: 'CSV_CORRUPTED',
      });
    });

    it('throws CSV_CORRUPTED on corrupted numeric field', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'CORRUPT-N-001' });
      await repo.createProduct(CTX, product);

      const productsPath = path.join(tempDir, 'products.csv');
      const content = await readFile(productsPath, 'utf8');
      const lines = content.split('\n');
      // Corrupt the price field (column index 11) in the data row
      const dataRow = lines[1]!.split(',');
      dataRow[11] = 'not-a-number';
      lines[1] = dataRow.join(',');
      await writeFile(productsPath, lines.join('\n'), 'utf8');

      await expect(repo.getProductById(CTX, product.id)).rejects.toMatchObject({
        code: 'CSV_CORRUPTED',
      });
    });

    it('throws CSV_CORRUPTED on corrupted boolean field', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'CORRUPT-B-001' });
      await repo.createProduct(CTX, product);

      const productsPath = path.join(tempDir, 'products.csv');
      const content = await readFile(productsPath, 'utf8');
      const lines = content.split('\n');
      // is_active is column index 17
      const dataRow = lines[1]!.split(',');
      dataRow[17] = 'maybe';
      lines[1] = dataRow.join(',');
      await writeFile(productsPath, lines.join('\n'), 'utf8');

      await expect(repo.getProductById(CTX, product.id)).rejects.toMatchObject({
        code: 'CSV_CORRUPTED',
      });
    });

    it('throws CSV_CORRUPTED on corrupted JSON attributes field', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'CORRUPT-J-001' });
      await repo.createProduct(CTX, product);

      const productsPath = path.join(tempDir, 'products.csv');
      const content = await readFile(productsPath, 'utf8');
      const lines = content.split('\n');
      // attributes_json is column index 20
      const dataRow = lines[1]!.split(',');
      dataRow[20] = '{invalid json';
      lines[1] = dataRow.join(',');
      await writeFile(productsPath, lines.join('\n'), 'utf8');

      await expect(repo.getProductById(CTX, product.id)).rejects.toMatchObject({
        code: 'CSV_CORRUPTED',
      });
    });
  });

  describe('duplicate SKU at repo level', () => {
    it('rejects duplicate SKU in the same scope', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      await repo.createProduct(CTX, makeProduct({ sku: 'DUP-CSV-001' }));
      await expect(repo.createProduct(CTX, makeProduct({ sku: 'DUP-CSV-001' }))).rejects.toMatchObject({
        code: 'DUPLICATE_SKU',
      });
    });
  });

  describe('file locking', () => {
    it('throws CSV_LOCKED when a lock file exists and lockTimeoutMs is short', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir, lockTimeoutMs: 10 });

      // Manually create the lock file
      const lockPath = path.join(tempDir, 'products.csv.lock');
      fs.writeFileSync(lockPath, 'manual lock', 'utf8');

      await expect(repo.createProduct(CTX, makeProduct({ sku: 'LOCKED-001' }))).rejects.toMatchObject({
        code: 'CSV_LOCKED',
      });

      // Clean up lock
      fs.unlinkSync(lockPath);
    });
  });

  describe('cascade delete', () => {
    it('deleting a product removes its variants', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'CASC-001' });
      await repo.createProduct(CTX, product);

      const variant = makeVariant({ productId: product.id, sku: 'CASC-V-001' });
      await repo.createVariant(CTX, variant);

      await repo.deleteProduct(CTX, product.id);

      const variants = await repo.listVariantsByProductId(CTX, product.id);
      expect(variants).toHaveLength(0);
    });

    it('deleting a product removes its images', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      const product = makeProduct({ sku: 'CASC-IMG-001' });
      await repo.createProduct(CTX, product);

      const image: ProductImage = {
        id: uid('img'),
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
      await repo.createProductImage(CTX, image);

      await repo.deleteProduct(CTX, product.id);

      const images = await repo.listProductImages(CTX, product.id);
      expect(images).toHaveLength(0);
    });
  });

  describe('construction', () => {
    it('creates 5 CSV files on construction', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'pc-csv-init-'));
      try {
        createCsvProductRepository({ dataDirectory: dir });
        const files = await readdir(dir);
        expect(files).toContain('products.csv');
        expect(files).toContain('variants.csv');
        expect(files).toContain('brands.csv');
        expect(files).toContain('categories.csv');
        expect(files).toContain('product_images.csv');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('throws CONFIGURATION_ERROR when dataDirectory is empty', () => {
      expect(() => createCsvProductRepository({ dataDirectory: '' })).toThrow();
      try {
        createCsvProductRepository({ dataDirectory: '' });
      } catch (error) {
        expect(error).toMatchObject({ code: 'CONFIGURATION_ERROR' });
      }
    });
  });

  describe('updateProduct at repo level', () => {
    it('throws PRODUCT_NOT_FOUND when updating missing record', async () => {
      const repo = createCsvProductRepository({ dataDirectory: tempDir });
      await expect(repo.updateProduct(CTX, makeProduct({ id: 'no-such' }))).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
    });
  });
});