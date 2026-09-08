import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCsvProductRepository,
  createLocalMediaStorage,
  createProductCatalogService,
  type CatalogContext,
  type CustomAttributeMap,
} from '../index.js';

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

describe('product catalog MVP smoke', () => {
  it('creates products, rejects duplicate SKU, validates attributes, protects category cycles, and stores media', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-catalog-'));
    try {
      const dataDirectory = path.join(root, 'data');
      const uploadDirectory = path.join(root, 'uploads-root');
      const repository = createCsvProductRepository({ dataDirectory });
      const mediaStorage = createLocalMediaStorage({
        baseUploadDir: uploadDirectory,
        publicBaseUrl: 'http://localhost:3000',
      });
      const service = createProductCatalogService({
        dataRepository: repository,
        mediaStorage,
      });
      const ctx: CatalogContext = {
        tenantId: 'tenant_demo',
        catalogId: 'catalog_demo',
        actor: { id: 'tester', type: 'user' },
      };

      const parent = await service.createCategory(ctx, { name: 'หมวกกันน็อค' });
      const child = await service.createCategory(ctx, { name: 'Adventure', parentId: parent.id });
      await expect(service.updateCategory(ctx, parent.id, { parentId: child.id })).rejects.toMatchObject({
        code: 'INVALID_CATEGORY',
      });

      const product = await service.createProduct(ctx, {
        sku: ' helmet adv 001 ',
        name: 'หมวกกันน็อค ADV',
        price: 4500,
        categoryId: parent.id,
        attributes: {
          certified: { type: 'boolean', value: true },
          sizes: { type: 'multi_enum', value: ['M', 'L'], options: ['S', 'M', 'L'] },
        },
      });
      expect(product.sku).toBe('HELMET-ADV-001');
      expect(product.slug).toContain('หมวกกันน็อค-adv');

      const slugCollision = await service.createProduct(ctx, {
        sku: 'helmet-adv-002',
        name: 'หมวกกันน็อค ADV',
        price: 4600,
      });
      expect(slugCollision.slug).toBe(`${product.slug}-1`);

      await expect(
        service.createProduct(ctx, {
          sku: 'HELMET-ADV-001',
          name: 'Duplicate Helmet',
          price: 4500,
        })
      ).rejects.toMatchObject({ code: 'DUPLICATE_SKU' });

      await expect(
        service.createProduct(ctx, {
          sku: 'HELMET-ADV-003',
          name: 'Bad Attribute Helmet',
          price: 4500,
          attributes: {
            displacement: { type: 'number', value: '350' },
          } as unknown as CustomAttributeMap,
        })
      ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_DATA' });

      const upload = await mediaStorage.upload({
        tenantId: ctx.tenantId,
        catalogId: ctx.catalogId,
        productId: product.id,
        fileName: 'helmet.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });
      expect(await mediaStorage.exists(upload.storageKey)).toBe(true);
      await mediaStorage.delete(upload.storageKey);
      expect(await mediaStorage.exists(upload.storageKey)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
