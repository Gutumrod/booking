/**
 * Node.js Host Integration Example — reference only when integrating into a real project.
 * Do NOT copy this file wholesale into production.
 *
 * Demonstrates how a Host wires the Product Catalog module:
 *   - The Host reads env/config and constructs adapters itself.
 *   - The module NEVER reads process.env — all config is injected by the Host.
 *   - Writes to isolated temp directories and cleans up on exit.
 */

import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  createProductCatalogService,
  createCsvProductRepository,
  createLocalMediaStorage,
  ProductCatalogError,
} from '../index.js';
import type {
  AuditEvent,
  AuditSink,
  CatalogContext,
  LogEntry,
  ProductCatalogConfig,
  StructuredLogger,
} from '../index.js';

// Minimal 1×1 PNG — passes the LocalMediaStorage magic-byte detector (8-byte PNG signature).
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

async function runIntegrationExample(): Promise<void> {
  // Isolated temp directories — both cleaned up in the finally block.
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pc-data-'));
  const mediaDir = await mkdtemp(path.join(os.tmpdir(), 'pc-media-'));

  try {
    // ── Adapters (Host-constructed from Host-owned config) ─────────────────────

    // The Host reads its own env and passes only values — the module receives no env reference.
    const dataRepository = createCsvProductRepository({
      dataDirectory: dataDir,
      lockTimeoutMs: 5000,
    });

    const mediaStorage = createLocalMediaStorage({
      baseUploadDir: mediaDir,
      publicBaseUrl: 'https://static.example.com',
      maxFileSizeByte: 5 * 1024 * 1024,
    });

    // ── Logger — Host-owned implementation ─────────────────────────────────────

    const logger: StructuredLogger = {
      log(entry: LogEntry): void {
        const dur = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : '';
        console.log(
          `[${entry.level.toUpperCase()}] ${entry.module}/${entry.operation} ` +
          `result=${entry.result}${dur}`,
        );
      },
    };

    // ── Audit sink — Host-owned implementation ─────────────────────────────────

    const auditLog: AuditEvent[] = [];
    const auditSink: AuditSink = {
      async record(event: AuditEvent): Promise<void> {
        auditLog.push(event);
      },
    };

    // ── Service construction ───────────────────────────────────────────────────

    const config: ProductCatalogConfig = {
      dataRepository,
      mediaStorage,
      logger,
      auditSink,
      defaults: { currency: 'THB', pageSize: 20, maxPageSize: 100 },
    };

    const service = createProductCatalogService(config);

    // ── Catalog context (Host provides tenant + catalog scope per operation) ────

    const ctx: CatalogContext = {
      tenantId: 'tenant-001',
      catalogId: 'catalog-main',
      actor: { id: 'user-42', type: 'user' },
    };

    // ── Brand ──────────────────────────────────────────────────────────────────

    const brand = await service.createBrand(ctx, {
      name: 'Acme Electronics',
      description: 'Leading consumer electronics brand',
      isActive: true,
    });
    console.log(`Brand created: ${brand.id} "${brand.name}"`);

    // ── Categories (root + child) ──────────────────────────────────────────────

    const rootCategory = await service.createCategory(ctx, {
      name: 'Electronics',
      description: 'All electronic goods',
      isActive: true,
    });
    console.log(`Category created: ${rootCategory.id} "${rootCategory.name}"`);

    const childCategory = await service.createCategory(ctx, {
      name: 'Smartphones',
      parentId: rootCategory.id,
      description: 'Mobile phones and accessories',
      isActive: true,
    });
    console.log(
      `Child category created: ${childCategory.id} "${childCategory.name}" ` +
      `(parent: ${childCategory.parentId})`,
    );

    // ── Product ────────────────────────────────────────────────────────────────

    const product = await service.createProduct(ctx, {
      sku: 'PHONE-001',
      name: 'Acme Phone X',
      description: 'Flagship smartphone with AI-powered camera',
      shortDescription: 'High-performance smartphone',
      status: 'active',
      brandId: brand.id,
      categoryId: childCategory.id,
      price: 25999,
      compareAtPrice: 29999,
      currency: 'THB',
      stockQuantity: 50,
      trackInventory: true,
      isActive: true,
      isFeatured: true,
      attributes: {
        color: {
          type: 'enum',
          value: 'Midnight Black',
          options: ['Midnight Black', 'Pearl White'],
        },
        storage: {
          type: 'enum',
          value: '256GB',
          options: ['128GB', '256GB', '512GB'],
        },
      },
      metadata: { warehouseCode: 'WH-A', importedAt: new Date().toISOString() },
    });
    console.log(
      `Product created: ${product.id} "${product.name}" ` +
      `sku=${product.sku} price=${product.price} ${product.currency}`,
    );

    // ── Variant ────────────────────────────────────────────────────────────────

    const variant = await service.createVariant(ctx, {
      productId: product.id,
      sku: 'PHONE-001-BLK-512',
      name: 'Acme Phone X — Black 512GB',
      price: 29999,
      stockQuantity: 10,
      isActive: true,
      attributes: {
        color: {
          type: 'enum',
          value: 'Midnight Black',
          options: ['Midnight Black', 'Pearl White'],
        },
        storage: {
          type: 'enum',
          value: '512GB',
          options: ['128GB', '256GB', '512GB'],
        },
      },
    });
    console.log(`Variant created: ${variant.id} "${variant.name}" sku=${variant.sku}`);

    // ── Image upload ───────────────────────────────────────────────────────────

    // PNG_1X1 passes magic-byte detection; LocalMediaStorage detects the MIME
    // from the buffer rather than trusting the declared mimeType alone.
    const image = await service.uploadProductImage(ctx, {
      productId: product.id,
      fileName: 'product-hero.png',
      mimeType: 'image/png',
      fileBuffer: PNG_1X1,
      altText: 'Acme Phone X hero image',
      isPrimary: true,
    });
    console.log(`Image uploaded: ${image.id} url=${image.publicUrl} primary=${image.isPrimary}`);

    // Set primary image explicitly (demonstrating the standalone call)
    const primaryImage = await service.setPrimaryProductImage(ctx, product.id, image.id);
    console.log(`Primary image confirmed: ${primaryImage.id} isPrimary=${primaryImage.isPrimary}`);

    // Reorder images (single-image no-op — exercises the API)
    const reordered = await service.reorderProductImages(ctx, product.id, [image.id]);
    console.log(`Images reordered: ${reordered.length} image(s)`);

    // List product images
    const productImages = await service.listProductImages(ctx, product.id);
    console.log(`Product images: ${productImages.length}`);

    // ── List products with pagination ──────────────────────────────────────────

    const page1 = await service.listProducts(ctx, { page: 1, limit: 10 });
    console.log(
      `listProducts: total=${page1.total} page=${page1.page}/${page1.totalPages} ` +
      `hasNext=${page1.hasNext}`,
    );

    // ── Search products ────────────────────────────────────────────────────────

    const searchResult = await service.searchProducts(ctx, {
      search: 'Acme',
      status: 'active',
      isFeatured: true,
      sort: { field: 'price', order: 'desc' },
      page: 1,
      limit: 5,
    });
    console.log(`searchProducts "Acme": ${searchResult.total} result(s)`);

    // ── List variants ──────────────────────────────────────────────────────────

    const variantList = await service.listVariantsByProductId(ctx, product.id);
    console.log(`Variants for product: ${variantList.length}`);

    // ── Archive and restore ────────────────────────────────────────────────────

    const archived = await service.archiveProduct(ctx, product.id);
    console.log(`Product archived: status=${archived.status} archivedAt=${archived.archivedAt}`);

    const restored = await service.restoreProduct(ctx, product.id);
    console.log(`Product restored: status=${restored.status}`);

    // ── Audit log summary ──────────────────────────────────────────────────────

    console.log(`\nAudit events: ${auditLog.length} total`);
    for (const evt of auditLog) {
      console.log(`  [AUDIT] ${evt.eventType} entityId=${evt.entityId} actor=${evt.actor.id}`);
    }

    // ── Error handling ─────────────────────────────────────────────────────────

    // PRODUCT_NOT_FOUND — fetch a product that does not exist
    try {
      await service.getProductById(ctx, 'does-not-exist');
    } catch (err) {
      if (err instanceof ProductCatalogError) {
        switch (err.code) {
          case 'PRODUCT_NOT_FOUND':
            console.log(`\nExpected: ${err.code} — ${err.message}`);
            break;
          default:
            console.error(`Unexpected catalog error: ${err.code} — ${err.message}`);
        }
      } else {
        throw err;
      }
    }

    // DUPLICATE_SKU — attempt to create a second product with the same SKU
    try {
      await service.createProduct(ctx, {
        sku: 'PHONE-001',   // already exists in this catalog
        name: 'Duplicate Phone',
        price: 100,
      });
    } catch (err) {
      if (err instanceof ProductCatalogError && err.code === 'DUPLICATE_SKU') {
        console.log(`Expected: ${err.code} — ${err.message}`);
      } else {
        throw err;
      }
    }

  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
    console.log('\nTemp directories cleaned up.');
  }
}

runIntegrationExample()
  .then(() => {
    console.log('Integration example completed successfully.');
  })
  .catch((err: unknown) => {
    console.error('Integration example failed:', err);
    process.exit(1);
  });
