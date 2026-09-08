import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCsvProductRepository } from '../../index.js';
import type { Brand, CatalogContext, Category, Product, ProductRepository, Variant } from '../../index.js';

const CTX_A: CatalogContext = { tenantId: 'tenant-a', catalogId: 'catalog-a' };
const CTX_B: CatalogContext = { tenantId: 'tenant-b', catalogId: 'catalog-b' };

let repo: ProductRepository;
let tempDir: string;

async function makeRepo(): Promise<ProductRepository> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'pc-contract-'));
  return createCsvProductRepository({ dataDirectory: tempDir });
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  const now = new Date().toISOString();
  return {
    id: 'prod_' + Math.random().toString(36).slice(2, 10),
    tenantId: CTX_A.tenantId,
    catalogId: CTX_A.catalogId,
    sku: 'SKU-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: 'Test Product',
    slug: 'test-product',
    description: 'A test product',
    shortDescription: 'Test',
    status: 'draft',
    brandId: null,
    categoryId: null,
    price: 100,
    compareAtPrice: null,
    costPrice: null,
    currency: 'THB',
    stockQuantity: 10,
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
    id: 'var_' + Math.random().toString(36).slice(2, 10),
    tenantId: CTX_A.tenantId,
    catalogId: CTX_A.catalogId,
    productId: 'prod_test1',
    sku: 'VAR-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: 'Test Variant',
    price: 50,
    compareAtPrice: null,
    stockQuantity: 5,
    attributes: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  const now = new Date().toISOString();
  return {
    id: 'brand_' + Math.random().toString(36).slice(2, 10),
    tenantId: CTX_A.tenantId,
    catalogId: CTX_A.catalogId,
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A brand',
    logoUrl: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  const now = new Date().toISOString();
  return {
    id: 'cat_' + Math.random().toString(36).slice(2, 10),
    tenantId: CTX_A.tenantId,
    catalogId: CTX_A.catalogId,
    parentId: null,
    name: 'Test Category',
    slug: 'test-category',
    description: 'A category',
    imageUrl: null,
    sortOrder: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('ProductRepository contract (CsvProductRepository)', () => {
  describe('createProduct / getProductById / getProductBySku / getProductBySlug', () => {
    it('creates a product and retrieves it by id', async () => {
      const product = makeProduct();
      const created = await repo.createProduct(CTX_A, product);
      expect(created.id).toBe(product.id);

      const found = await repo.getProductById(CTX_A, product.id);
      expect(found).not.toBeNull();
      expect(found!.sku).toBe(product.sku);
      expect(found!.name).toBe(product.name);
    });

    it('retrieves a product by sku', async () => {
      const product = makeProduct({ sku: 'UNIQUE-SKU-001' });
      await repo.createProduct(CTX_A, product);

      const found = await repo.getProductBySku(CTX_A, 'unique-sku-001');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(product.id);
    });

    it('retrieves a product by slug', async () => {
      const product = makeProduct({ slug: 'my-slug' });
      await repo.createProduct(CTX_A, product);

      const found = await repo.getProductBySlug(CTX_A, 'my-slug');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(product.id);
    });

    it('returns null when product not found by id', async () => {
      const found = await repo.getProductById(CTX_A, 'nonexistent');
      expect(found).toBeNull();
    });

    it('returns null when product not found by sku', async () => {
      const found = await repo.getProductBySku(CTX_A, 'NOSUCHSKU');
      expect(found).toBeNull();
    });

    it('returns null when product not found by slug', async () => {
      const found = await repo.getProductBySlug(CTX_A, 'no-such-slug');
      expect(found).toBeNull();
    });
  });

  describe('updateProduct', () => {
    it('updates an existing product', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      const updated = await repo.updateProduct(CTX_A, {
        ...product,
        name: 'Updated Name',
        price: 200,
        updatedAt: new Date().toISOString(),
      });
      expect(updated.name).toBe('Updated Name');
      expect(updated.price).toBe(200);

      const found = await repo.getProductById(CTX_A, product.id);
      expect(found!.name).toBe('Updated Name');
      expect(found!.price).toBe(200);
    });

    it('throws PRODUCT_NOT_FOUND when updating a missing product', async () => {
      await expect(repo.updateProduct(CTX_A, makeProduct({ id: 'missing' }))).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
    });
  });

  describe('archiveProduct / restoreProduct (via updateProduct)', () => {
    it('archives a product by setting status=archived and archivedAt', async () => {
      const product = makeProduct({ status: 'active' });
      await repo.createProduct(CTX_A, product);

      const archived = await repo.updateProduct(CTX_A, {
        ...product,
        status: 'archived',
        archivedAt: new Date().toISOString(),
      });
      expect(archived.status).toBe('archived');
      expect(archived.archivedAt).not.toBeNull();
    });

    it('restores a product by clearing archivedAt and setting status', async () => {
      const product = makeProduct({ status: 'archived', archivedAt: '2024-01-01T00:00:00Z' });
      await repo.createProduct(CTX_A, product);

      const restored = await repo.updateProduct(CTX_A, {
        ...product,
        status: 'active',
        archivedAt: null,
      });
      expect(restored.status).toBe('active');
      expect(restored.archivedAt).toBeNull();
    });
  });

  describe('deleteProduct', () => {
    it('deletes a product', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      await repo.deleteProduct(CTX_A, product.id);
      const found = await repo.getProductById(CTX_A, product.id);
      expect(found).toBeNull();
    });

    it('throws PRODUCT_NOT_FOUND when deleting a missing product', async () => {
      await expect(repo.deleteProduct(CTX_A, 'missing')).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
    });

    it('cascades deletion to variants and images', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      const variant = makeVariant({ productId: product.id });
      await repo.createVariant(CTX_A, variant);

      await repo.deleteProduct(CTX_A, product.id);

      const variants = await repo.listVariantsByProductId(CTX_A, product.id);
      expect(variants).toHaveLength(0);
    });
  });

  describe('duplicate SKU', () => {
    it('rejects duplicate product SKU within the same scope', async () => {
      const product = makeProduct({ sku: 'DUP-SKU-001' });
      await repo.createProduct(CTX_A, product);

      await expect(repo.createProduct(CTX_A, makeProduct({ sku: 'DUP-SKU-001' }))).rejects.toMatchObject({
        code: 'DUPLICATE_SKU',
      });
    });

    it('allows the same SKU across different tenants', async () => {
      const productA = makeProduct({ sku: 'SHARED-SKU-01' });
      await repo.createProduct(CTX_A, productA);

      const productB = makeProduct({
        sku: 'SHARED-SKU-01',
        tenantId: CTX_B.tenantId,
        catalogId: CTX_B.catalogId,
      });
      await expect(repo.createProduct(CTX_B, productB)).resolves.toBeDefined();
    });
  });

  describe('listProducts', () => {
    it('returns all products for the tenant/catalog scope', async () => {
      for (let i = 0; i < 3; i++) {
        await repo.createProduct(CTX_A, makeProduct({ sku: `SKU-LIST-${i.toString().padStart(2, '0')}` }));
      }
      const result = await repo.listProducts(CTX_A, {});
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.createProduct(CTX_A, makeProduct({ sku: `SKU-PAGE-${i.toString().padStart(2, '0')}` }));
      }
      const result = await repo.listProducts(CTX_A, { page: 1, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrev).toBe(false);

      const page2 = await repo.listProducts(CTX_A, { page: 2, limit: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.hasPrev).toBe(true);
      expect(page2.hasNext).toBe(true);

      const page3 = await repo.listProducts(CTX_A, { page: 3, limit: 2 });
      expect(page3.items).toHaveLength(1);
      expect(page3.hasNext).toBe(false);
    });
  });

  describe('filtering', () => {
    it('filters by status', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'F1', status: 'draft' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'F2', status: 'active' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'F3', status: 'active' }));

      const result = await repo.listProducts(CTX_A, { status: 'active' });
      expect(result.items).toHaveLength(2);
      expect(result.items.every((p: Product) => p.status === 'active')).toBe(true);
    });

    it('filters by brandId', async () => {
      const brand = makeBrand();
      await repo.createBrand(CTX_A, brand);

      await repo.createProduct(CTX_A, makeProduct({ sku: 'B1', brandId: brand.id }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'B2', brandId: null }));

      const result = await repo.listProducts(CTX_A, { brandId: brand.id });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('B1');
    });

    it('filters by categoryId', async () => {
      const cat = makeCategory();
      await repo.createCategory(CTX_A, cat);

      await repo.createProduct(CTX_A, makeProduct({ sku: 'C1', categoryId: cat.id }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'C2', categoryId: null }));

      const result = await repo.listProducts(CTX_A, { categoryId: cat.id });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('C1');
    });

    it('filters by minPrice', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P1', price: 50 }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P2', price: 150 }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P3', price: 300 }));

      const result = await repo.listProducts(CTX_A, { minPrice: 100 });
      expect(result.items).toHaveLength(2);
    });

    it('filters by maxPrice', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P1', price: 50 }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P2', price: 150 }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'P3', price: 300 }));

      const result = await repo.listProducts(CTX_A, { maxPrice: 100 });
      expect(result.items).toHaveLength(1);
    });

    it('filters by inStock', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'S1', stockQuantity: 0 }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'S2', stockQuantity: 10 }));

      const inStock = await repo.listProducts(CTX_A, { inStock: true });
      expect(inStock.items).toHaveLength(1);
      expect(inStock.items[0]!.sku).toBe('S2');

      const outOfStock = await repo.listProducts(CTX_A, { inStock: false });
      expect(outOfStock.items).toHaveLength(1);
      expect(outOfStock.items[0]!.sku).toBe('S1');
    });

    it('filters by isFeatured', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'FE1', isFeatured: true }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'FE2', isFeatured: false }));

      const result = await repo.listProducts(CTX_A, { isFeatured: true });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('FE1');
    });
  });

  describe('searchProducts', () => {
    it('matches on name (case-insensitive)', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'SE1', name: 'Adventure Helmet' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'SE2', name: 'Road Gloves' }));

      const result = await repo.searchProducts(CTX_A, { search: 'adventure' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.name).toBe('Adventure Helmet');
    });

    it('matches on sku', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'SEARCH-SKU-01', name: 'Product A' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'OTHER-SKU-02', name: 'Product B' }));

      const result = await repo.searchProducts(CTX_A, { search: 'search-sku' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('SEARCH-SKU-01');
    });

    it('matches on description', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'D1', description: 'Premium carbon fiber helmet' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'D2', description: 'Basic plastic gloves' }));

      const result = await repo.searchProducts(CTX_A, { search: 'carbon' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('D1');
    });

    it('matches on brand name', async () => {
      const brand = makeBrand({ name: 'Shoei' });
      await repo.createBrand(CTX_A, brand);
      await repo.createProduct(CTX_A, makeProduct({ sku: 'BR1', brandId: brand.id }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'BR2', brandId: null }));

      const result = await repo.searchProducts(CTX_A, { search: 'shoei' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('BR1');
    });

    it('matches on category name', async () => {
      const cat = makeCategory({ name: 'Helmets' });
      await repo.createCategory(CTX_A, cat);
      await repo.createProduct(CTX_A, makeProduct({ sku: 'CT1', categoryId: cat.id }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'CT2', categoryId: null }));

      const result = await repo.searchProducts(CTX_A, { search: 'helmets' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sku).toBe('CT1');
    });
  });

  describe('tenant isolation', () => {
    it('product created in tenant A is invisible to tenant B', async () => {
      const product = makeProduct({ sku: 'ISOLATE-001' });
      await repo.createProduct(CTX_A, product);

      const found = await repo.getProductById(CTX_B, product.id);
      expect(found).toBeNull();
    });

    it('listProducts in tenant B returns no products from tenant A', async () => {
      await repo.createProduct(CTX_A, makeProduct({ sku: 'ISO-A1' }));
      await repo.createProduct(CTX_A, makeProduct({ sku: 'ISO-A2' }));

      const result = await repo.listProducts(CTX_B, {});
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('same SKU is allowed across different tenants', async () => {
      const productA = makeProduct({ sku: 'ISO-SHARED' });
      await repo.createProduct(CTX_A, productA);

      const productB = makeProduct({
        sku: 'ISO-SHARED',
        tenantId: CTX_B.tenantId,
        catalogId: CTX_B.catalogId,
      });
      await repo.createProduct(CTX_B, productB);

      const foundA = await repo.getProductBySku(CTX_A, 'ISO-SHARED');
      const foundB = await repo.getProductBySku(CTX_B, 'ISO-SHARED');
      expect(foundA!.id).toBe(productA.id);
      expect(foundB!.id).toBe(productB.id);
    });

    it('updateProduct from tenant B on tenant A product throws PRODUCT_NOT_FOUND', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      await expect(
        repo.updateProduct(CTX_B, { ...product, name: 'Hacked' })
      ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    });

    it('deleteProduct from tenant B on tenant A product throws PRODUCT_NOT_FOUND', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      await expect(repo.deleteProduct(CTX_B, product.id)).rejects.toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
    });
  });

  describe('variants', () => {
    it('creates a variant and retrieves it by id', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      const variant = makeVariant({ productId: product.id });
      await repo.createVariant(CTX_A, variant);

      const found = await repo.getVariantById(CTX_A, variant.id);
      expect(found).not.toBeNull();
      expect(found!.sku).toBe(variant.sku);
    });

    it('lists variants by product id', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      await repo.createVariant(CTX_A, makeVariant({ productId: product.id, sku: 'V1' }));
      await repo.createVariant(CTX_A, makeVariant({ productId: product.id, sku: 'V2' }));

      const variants = await repo.listVariantsByProductId(CTX_A, product.id);
      expect(variants).toHaveLength(2);
    });

    it('rejects duplicate variant SKU within same scope', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      const v1 = makeVariant({ productId: product.id, sku: 'VAR-DUP-01' });
      await repo.createVariant(CTX_A, v1);

      await expect(repo.createVariant(CTX_A, makeVariant({ productId: product.id, sku: 'VAR-DUP-01' }))).rejects.toMatchObject({
        code: 'DUPLICATE_SKU',
      });
    });

    it('deletes a variant', async () => {
      const product = makeProduct();
      await repo.createProduct(CTX_A, product);

      const variant = makeVariant({ productId: product.id });
      await repo.createVariant(CTX_A, variant);

      await repo.deleteVariant(CTX_A, variant.id);
      const found = await repo.getVariantById(CTX_A, variant.id);
      expect(found).toBeNull();
    });
  });

  describe('brands', () => {
    it('creates a brand and retrieves it by id', async () => {
      const brand = makeBrand({ name: 'Honda', slug: 'honda' });
      await repo.createBrand(CTX_A, brand);

      const found = await repo.getBrandById(CTX_A, brand.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Honda');
    });

    it('lists brands with pagination', async () => {
      for (let i = 0; i < 3; i++) {
        await repo.createBrand(CTX_A, makeBrand({ name: `Brand ${i}`, slug: `brand-${i}` }));
      }
      const result = await repo.listBrands(CTX_A, { page: 1, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
    });
  });

  describe('categories', () => {
    it('creates a category and retrieves it by id', async () => {
      const cat = makeCategory({ name: 'Apparel', slug: 'apparel' });
      await repo.createCategory(CTX_A, cat);

      const found = await repo.getCategoryById(CTX_A, cat.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Apparel');
    });

    it('lists categories (returns array, not paginated)', async () => {
      await repo.createCategory(CTX_A, makeCategory({ name: 'C1', slug: 'c1' }));
      await repo.createCategory(CTX_A, makeCategory({ name: 'C2', slug: 'c2' }));

      const categories = await repo.listCategories(CTX_A, {});
      expect(Array.isArray(categories)).toBe(true);
      expect(categories).toHaveLength(2);
    });
  });
});