import { ProductCatalogError } from './errors.js';
import type {
  AuditEvent,
  AuditEventType,
  Brand,
  BrandQuery,
  CatalogContext,
  Category,
  CategoryQuery,
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  CreateVariantInput,
  MediaStorageOutput,
  PaginatedResult,
  Product,
  ProductCatalogConfig,
  ProductImage,
  ProductQuery,
  ProductRepository,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateVariantInput,
  UploadProductImageInput,
  Variant,
} from './types.js';
import { generateUniqueSlug, slugify } from './utils/slug.js';
import { validateSku } from './validators/sku.validator.js';
import { validateCreateProductInput, validateUpdateProductInput } from './validators/product.validator.js';
import { validateCustomAttributes } from './validators/attribute.validator.js';
import { validateCreateCategoryInput, validateUpdateCategoryInput } from './validators/category.validator.js';

export interface ProductCatalogService {
  createProduct(ctx: CatalogContext, input: CreateProductInput): Promise<Product>;
  getProductById(ctx: CatalogContext, id: string): Promise<Product>;
  getProductBySku(ctx: CatalogContext, sku: string): Promise<Product>;
  getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product>;
  updateProduct(ctx: CatalogContext, id: string, input: UpdateProductInput): Promise<Product>;
  archiveProduct(ctx: CatalogContext, id: string): Promise<Product>;
  restoreProduct(ctx: CatalogContext, id: string): Promise<Product>;
  deleteProduct(ctx: CatalogContext, id: string): Promise<void>;
  listProducts(ctx: CatalogContext, query?: ProductQuery): Promise<PaginatedResult<Product>>;
  searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>>;
  createVariant(ctx: CatalogContext, input: CreateVariantInput): Promise<Variant>;
  getVariantById(ctx: CatalogContext, id: string): Promise<Variant>;
  updateVariant(ctx: CatalogContext, id: string, input: UpdateVariantInput): Promise<Variant>;
  deleteVariant(ctx: CatalogContext, id: string): Promise<void>;
  listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]>;
  createBrand(ctx: CatalogContext, input: CreateBrandInput): Promise<Brand>;
  getBrandById(ctx: CatalogContext, id: string): Promise<Brand>;
  updateBrand(ctx: CatalogContext, id: string, input: UpdateBrandInput): Promise<Brand>;
  deleteBrand(ctx: CatalogContext, id: string): Promise<void>;
  listBrands(ctx: CatalogContext, query?: BrandQuery): Promise<PaginatedResult<Brand>>;
  createCategory(ctx: CatalogContext, input: CreateCategoryInput): Promise<Category>;
  getCategoryById(ctx: CatalogContext, id: string): Promise<Category>;
  updateCategory(ctx: CatalogContext, id: string, input: UpdateCategoryInput): Promise<Category>;
  deleteCategory(ctx: CatalogContext, id: string): Promise<void>;
  listCategories(ctx: CatalogContext, query?: CategoryQuery): Promise<Category[]>;
  uploadProductImage(ctx: CatalogContext, input: UploadProductImageInput): Promise<ProductImage>;
  deleteProductImage(ctx: CatalogContext, imageId: string): Promise<void>;
  setPrimaryProductImage(ctx: CatalogContext, productId: string, imageId: string): Promise<ProductImage>;
  reorderProductImages(ctx: CatalogContext, productId: string, imageIdsInOrder: string[]): Promise<ProductImage[]>;
  listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]>;
}

type EntityType = AuditEvent['entityType'];

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function createProductCatalogService(config: ProductCatalogConfig): ProductCatalogService {
  if (!config.dataRepository || !config.mediaStorage) {
    throw new ProductCatalogError('dataRepository and mediaStorage are required', 'CONFIGURATION_ERROR');
  }

  const repo = config.dataRepository;
  const mediaStorage = config.mediaStorage;
  const defaultCurrency = config.defaults?.currency ?? 'THB';
  const defaultPageSize = config.defaults?.pageSize ?? 20;
  const maxPageSize = config.defaults?.maxPageSize ?? 100;

  async function run<T>(
    ctx: CatalogContext,
    operation: string,
    productId: string | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await action();
      log(ctx, operation, productId, started, 'success');
      return result;
    } catch (error) {
      const mapped = mapDomainError(error);
      log(ctx, operation, productId, started, 'failure', mapped.code);
      throw mapped;
    }
  }

  const service: ProductCatalogService = {
    createProduct: (ctx, input) =>
      run(ctx, 'product.create', undefined, async () => {
        validateCreateProductInput({ ...input, currency: input.currency ?? defaultCurrency });
        const sku = validateSku(input.sku);
        await assertUniqueProductSku(ctx, repo, sku);
        if (input.brandId) {
          await requireBrand(ctx, input.brandId);
        }
        if (input.categoryId) {
          await requireCategory(ctx, input.categoryId);
        }
        const now = new Date().toISOString();
        const slug = await uniqueSlug(ctx, input.slug ?? input.name, (candidate) => repo.getProductBySlug(ctx, candidate));
        const product: Product = {
          id: createId('prod'),
          tenantId: ctx.tenantId,
          catalogId: ctx.catalogId,
          sku,
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          shortDescription: input.shortDescription ?? null,
          status: input.status ?? 'draft',
          brandId: input.brandId ?? null,
          categoryId: input.categoryId ?? null,
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          costPrice: input.costPrice ?? null,
          currency: input.currency ?? defaultCurrency,
          stockQuantity: input.stockQuantity ?? 0,
          trackInventory: input.trackInventory ?? true,
          isActive: input.isActive ?? true,
          isFeatured: input.isFeatured ?? false,
          primaryImageId: null,
          attributes: input.attributes ?? {},
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        const created = await repo.createProduct(ctx, product);
        await audit(ctx, 'product.created', 'product', created.id);
        return created;
      }),

    getProductById: (ctx, id) => run(ctx, 'product.get_by_id', id, () => requireProduct(ctx, id)),
    getProductBySku: (ctx, sku) =>
      run(ctx, 'product.get_by_sku', undefined, async () => {
        const product = await repo.getProductBySku(ctx, validateSku(sku));
        if (!product) throw new ProductCatalogError(`Product SKU '${sku}' not found`, 'PRODUCT_NOT_FOUND');
        return product;
      }),
    getProductBySlug: (ctx, slug) =>
      run(ctx, 'product.get_by_slug', undefined, async () => {
        const product = await repo.getProductBySlug(ctx, slugify(slug));
        if (!product) throw new ProductCatalogError(`Product slug '${slug}' not found`, 'PRODUCT_NOT_FOUND');
        return product;
      }),

    updateProduct: (ctx, id, input) =>
      run(ctx, 'product.update', id, async () => {
        validateUpdateProductInput({ ...input, currency: input.currency?.toUpperCase() });
        const existing = await requireProduct(ctx, id);
        let sku = existing.sku;
        if (input.sku !== undefined) {
          sku = validateSku(input.sku);
          if (sku !== existing.sku) {
            await assertUniqueProductSku(ctx, repo, sku);
          }
        }
        if (input.brandId) {
          await requireBrand(ctx, input.brandId);
        }
        if (input.categoryId) {
          await requireCategory(ctx, input.categoryId);
        }
        const nextSlug =
          input.slug !== undefined || input.updateSlug === true
            ? await uniqueSlug(ctx, input.slug ?? input.name ?? existing.name, async (candidate) => {
                const found = await repo.getProductBySlug(ctx, candidate);
                return found && found.id !== existing.id ? found : null;
              })
            : existing.slug;
        const updated: Product = {
          ...existing,
          sku,
          name: input.name !== undefined ? input.name.trim() : existing.name,
          slug: nextSlug,
          description: input.description !== undefined ? input.description : existing.description,
          shortDescription: input.shortDescription !== undefined ? input.shortDescription : existing.shortDescription,
          status: input.status ?? existing.status,
          brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
          categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
          price: input.price ?? existing.price,
          compareAtPrice: input.compareAtPrice !== undefined ? input.compareAtPrice : existing.compareAtPrice,
          costPrice: input.costPrice !== undefined ? input.costPrice : existing.costPrice,
          currency: input.currency ?? existing.currency,
          stockQuantity: input.stockQuantity ?? existing.stockQuantity,
          trackInventory: input.trackInventory ?? existing.trackInventory,
          isActive: input.isActive ?? existing.isActive,
          isFeatured: input.isFeatured ?? existing.isFeatured,
          attributes: input.attributes ?? existing.attributes,
          metadata: input.metadata ?? existing.metadata,
          updatedAt: new Date().toISOString(),
        };
        const saved = await repo.updateProduct(ctx, updated);
        await audit(ctx, 'product.updated', 'product', saved.id);
        return saved;
      }),

    archiveProduct: (ctx, id) =>
      run(ctx, 'product.archive', id, async () => {
        const existing = await requireProduct(ctx, id);
        const saved = await repo.updateProduct(ctx, {
          ...existing,
          status: 'archived',
          archivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await audit(ctx, 'product.archived', 'product', saved.id);
        return saved;
      }),

    restoreProduct: (ctx, id) =>
      run(ctx, 'product.restore', id, async () => {
        const existing = await requireProduct(ctx, id);
        const saved = await repo.updateProduct(ctx, {
          ...existing,
          status: existing.isActive ? 'active' : 'inactive',
          archivedAt: null,
          updatedAt: new Date().toISOString(),
        });
        await audit(ctx, 'product.restored', 'product', saved.id);
        return saved;
      }),

    deleteProduct: (ctx, id) =>
      run(ctx, 'product.delete', id, async () => {
        await requireProduct(ctx, id);
        await repo.deleteProduct(ctx, id);
        await audit(ctx, 'product.deleted', 'product', id);
      }),

    listProducts: (ctx, query = {}) => run(ctx, 'product.list', undefined, () => repo.listProducts(ctx, normalizeQuery(query))),
    searchProducts: (ctx, query) =>
      run(ctx, 'product.search', undefined, () => repo.searchProducts(ctx, normalizeQuery(query))),

    createVariant: (ctx, input) =>
      run(ctx, 'variant.create', input.productId, async () => {
        await requireProduct(ctx, input.productId);
        const sku = validateSku(input.sku);
        await assertUniqueVariantSku(ctx, repo, sku);
        if (!input.name?.trim()) {
          throw new ProductCatalogError('Variant name is required', 'INVALID_VARIANT');
        }
        if (input.price < 0 || !Number.isFinite(input.price)) {
          throw new ProductCatalogError('Variant price must be non-negative', 'INVALID_VARIANT');
        }
        if (input.attributes) validateCustomAttributes(input.attributes);
        const now = new Date().toISOString();
        const variant = await repo.createVariant(ctx, {
          id: createId('var'),
          tenantId: ctx.tenantId,
          catalogId: ctx.catalogId,
          productId: input.productId,
          sku,
          name: input.name.trim(),
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          stockQuantity: input.stockQuantity ?? 0,
          attributes: input.attributes ?? {},
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        });
        await audit(ctx, 'variant.created', 'variant', variant.id);
        return variant;
      }),

    getVariantById: (ctx, id) =>
      run(ctx, 'variant.get_by_id', undefined, async () => {
        const variant = await repo.getVariantById(ctx, id);
        if (!variant) throw new ProductCatalogError(`Variant '${id}' not found`, 'INVALID_VARIANT');
        return variant;
      }),

    updateVariant: (ctx, id, input) =>
      run(ctx, 'variant.update', undefined, async () => {
        const existing = await service.getVariantById(ctx, id);
        let sku = existing.sku;
        if (input.sku !== undefined) {
          sku = validateSku(input.sku);
          const duplicate = await repo.getVariantBySku(ctx, sku);
          if (duplicate && duplicate.id !== id) {
            throw new ProductCatalogError(`Variant SKU '${sku}' already exists`, 'DUPLICATE_SKU');
          }
        }
        if (input.attributes) validateCustomAttributes(input.attributes);
        if (input.price !== undefined && (input.price < 0 || !Number.isFinite(input.price))) {
          throw new ProductCatalogError('Variant price must be non-negative', 'INVALID_VARIANT');
        }
        const saved = await repo.updateVariant(ctx, {
          ...existing,
          sku,
          name: input.name !== undefined ? input.name.trim() : existing.name,
          price: input.price ?? existing.price,
          compareAtPrice: input.compareAtPrice !== undefined ? input.compareAtPrice : existing.compareAtPrice,
          stockQuantity: input.stockQuantity ?? existing.stockQuantity,
          attributes: input.attributes ?? existing.attributes,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: new Date().toISOString(),
        });
        await audit(ctx, 'variant.updated', 'variant', saved.id);
        return saved;
      }),

    deleteVariant: (ctx, id) =>
      run(ctx, 'variant.delete', undefined, async () => {
        await service.getVariantById(ctx, id);
        await repo.deleteVariant(ctx, id);
        await audit(ctx, 'variant.deleted', 'variant', id);
      }),
    listVariantsByProductId: (ctx, productId) =>
      run(ctx, 'variant.list_by_product', productId, async () => {
        await requireProduct(ctx, productId);
        return repo.listVariantsByProductId(ctx, productId);
      }),

    createBrand: (ctx, input) =>
      run(ctx, 'brand.create', undefined, async () => {
        if (!input.name?.trim()) throw new ProductCatalogError('Brand name is required', 'INVALID_PRODUCT_DATA');
        const now = new Date().toISOString();
        const brand = await repo.createBrand(ctx, {
          id: createId('brand'),
          tenantId: ctx.tenantId,
          catalogId: ctx.catalogId,
          name: input.name.trim(),
          slug: await uniqueSlug(ctx, input.slug ?? input.name, (candidate) => repo.getBrandBySlug(ctx, candidate)),
          description: input.description ?? null,
          logoUrl: input.logoUrl ?? null,
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        });
        return brand;
      }),
    getBrandById: (ctx, id) => run(ctx, 'brand.get_by_id', undefined, () => requireBrand(ctx, id)),
    updateBrand: (ctx, id, input) =>
      run(ctx, 'brand.update', undefined, async () => {
        const existing = await requireBrand(ctx, id);
        if (input.name !== undefined && !input.name.trim()) {
          throw new ProductCatalogError('Brand name must not be empty', 'INVALID_PRODUCT_DATA');
        }
        return repo.updateBrand(ctx, {
          ...existing,
          name: input.name !== undefined ? input.name.trim() : existing.name,
          slug: input.slug !== undefined ? slugify(input.slug) : existing.slug,
          description: input.description !== undefined ? input.description : existing.description,
          logoUrl: input.logoUrl !== undefined ? input.logoUrl : existing.logoUrl,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: new Date().toISOString(),
        });
      }),
    deleteBrand: (ctx, id) =>
      run(ctx, 'brand.delete', undefined, async () => {
        await requireBrand(ctx, id);
        await repo.deleteBrand(ctx, id);
      }),
    listBrands: (ctx, query = {}) => run(ctx, 'brand.list', undefined, () => repo.listBrands(ctx, normalizeBrandQuery(query))),

    createCategory: (ctx, input) =>
      run(ctx, 'category.create', undefined, async () => {
        validateCreateCategoryInput(input);
        if (input.parentId) {
          await requireCategory(ctx, input.parentId);
        }
        const now = new Date().toISOString();
        const category = await repo.createCategory(ctx, {
          id: createId('cat'),
          tenantId: ctx.tenantId,
          catalogId: ctx.catalogId,
          parentId: input.parentId ?? null,
          name: input.name.trim(),
          slug: await uniqueSlug(ctx, input.slug ?? input.name, (candidate) => repo.getCategoryBySlug(ctx, candidate)),
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        });
        await audit(ctx, 'category.created', 'category', category.id);
        return category;
      }),
    getCategoryById: (ctx, id) => run(ctx, 'category.get_by_id', undefined, () => requireCategory(ctx, id)),
    updateCategory: (ctx, id, input) =>
      run(ctx, 'category.update', undefined, async () => {
        validateUpdateCategoryInput(input);
        const existing = await requireCategory(ctx, id);
        const nextParentId = input.parentId !== undefined ? input.parentId : existing.parentId;
        await assertNoCircularCategory(ctx, repo, id, nextParentId ?? null);
        const saved = await repo.updateCategory(ctx, {
          ...existing,
          parentId: nextParentId ?? null,
          name: input.name !== undefined ? input.name.trim() : existing.name,
          slug: input.slug !== undefined ? slugify(input.slug) : existing.slug,
          description: input.description !== undefined ? input.description : existing.description,
          imageUrl: input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          isActive: input.isActive ?? existing.isActive,
          updatedAt: new Date().toISOString(),
        });
        await audit(ctx, 'category.updated', 'category', saved.id);
        return saved;
      }),
    deleteCategory: (ctx, id) =>
      run(ctx, 'category.delete', undefined, async () => {
        await requireCategory(ctx, id);
        await repo.deleteCategory(ctx, id);
        await audit(ctx, 'category.deleted', 'category', id);
      }),
    listCategories: (ctx, query = {}) => run(ctx, 'category.list', undefined, () => repo.listCategories(ctx, query)),

    uploadProductImage: (ctx, input) =>
      run(ctx, 'image.upload', input.productId, async () => {
        const product = await requireProduct(ctx, input.productId);
        if (!IMAGE_MIME_TYPES.has(input.mimeType)) {
          throw new ProductCatalogError('Unsupported image MIME type', 'INVALID_PRODUCT_DATA');
        }
        const output = await uploadMediaSafely(input, ctx);
        const images = await repo.listProductImages(ctx, input.productId);
        const isPrimary = input.isPrimary === true || images.length === 0;
        if (isPrimary) {
          await Promise.all(images.map((image) => repo.updateProductImage(ctx, { ...image, isPrimary: false })));
        }
        const image = await repo.createProductImage(ctx, {
          id: createId('img'),
          tenantId: ctx.tenantId,
          catalogId: ctx.catalogId,
          productId: input.productId,
          storageProvider: output.storageProvider,
          storageKey: output.storageKey,
          publicUrl: output.publicUrl,
          fileName: input.fileName,
          mimeType: output.mimeType as ProductImage['mimeType'],
          fileSize: output.fileSize,
          width: null,
          height: null,
          altText: input.altText ?? null,
          sortOrder: images.length,
          isPrimary,
          createdAt: new Date().toISOString(),
        });
        if (isPrimary) {
          await repo.updateProduct(ctx, { ...product, primaryImageId: image.id, updatedAt: new Date().toISOString() });
        }
        await audit(ctx, 'image.uploaded', 'image', image.id);
        return image;
      }),

    deleteProductImage: (ctx, imageId) =>
      run(ctx, 'image.delete', undefined, async () => {
        const image = await requireImage(ctx, imageId);
        await deleteMediaSafely(image.storageKey);
        await repo.deleteProductImage(ctx, imageId);
        const product = await repo.getProductById(ctx, image.productId);
        if (product?.primaryImageId === imageId) {
          await repo.updateProduct(ctx, { ...product, primaryImageId: null, updatedAt: new Date().toISOString() });
        }
        await audit(ctx, 'image.deleted', 'image', imageId);
      }),

    setPrimaryProductImage: (ctx, productId, imageId) =>
      run(ctx, 'image.set_primary', productId, async () => {
        const product = await requireProduct(ctx, productId);
        const images = await repo.listProductImages(ctx, productId);
        const target = images.find((image) => image.id === imageId);
        if (!target) throw new ProductCatalogError(`Image '${imageId}' not found`, 'PRODUCT_NOT_FOUND');
        await Promise.all(images.map((image) => repo.updateProductImage(ctx, { ...image, isPrimary: image.id === imageId })));
        await repo.updateProduct(ctx, { ...product, primaryImageId: imageId, updatedAt: new Date().toISOString() });
        await audit(ctx, 'image.primary_changed', 'image', imageId);
        return { ...target, isPrimary: true };
      }),

    reorderProductImages: (ctx, productId, imageIdsInOrder) =>
      run(ctx, 'image.reorder', productId, async () => {
        await requireProduct(ctx, productId);
        const images = await repo.listProductImages(ctx, productId);
        const byId = new Map(images.map((image) => [image.id, image]));
        if (imageIdsInOrder.length !== images.length || imageIdsInOrder.some((id) => !byId.has(id))) {
          throw new ProductCatalogError('imageIdsInOrder must include every product image exactly once', 'INVALID_PRODUCT_DATA');
        }
        const updated: ProductImage[] = [];
        for (const [sortOrder, imageId] of imageIdsInOrder.entries()) {
          const image = byId.get(imageId);
          if (!image) continue;
          updated.push(await repo.updateProductImage(ctx, { ...image, sortOrder }));
        }
        return updated;
      }),
    listProductImages: (ctx, productId) =>
      run(ctx, 'image.list', productId, async () => {
        await requireProduct(ctx, productId);
        return repo.listProductImages(ctx, productId);
      }),
  };

  function normalizeQuery(query: ProductQuery): ProductQuery {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const requestedLimit = Math.floor(query.limit ?? defaultPageSize);
    const limit = Math.min(maxPageSize, Math.max(1, requestedLimit));
    return { ...query, page, limit };
  }

  function normalizeBrandQuery(query: BrandQuery): BrandQuery {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(maxPageSize, Math.max(1, Math.floor(query.limit ?? defaultPageSize)));
    return { ...query, page, limit };
  }

  async function requireProduct(ctx: CatalogContext, id: string): Promise<Product> {
    const product = await repo.getProductById(ctx, id);
    if (!product) throw new ProductCatalogError(`Product '${id}' not found`, 'PRODUCT_NOT_FOUND');
    return product;
  }

  async function requireBrand(ctx: CatalogContext, id: string): Promise<Brand> {
    const brand = await repo.getBrandById(ctx, id);
    if (!brand) throw new ProductCatalogError(`Brand '${id}' not found`, 'INVALID_PRODUCT_DATA');
    return brand;
  }

  async function requireCategory(ctx: CatalogContext, id: string): Promise<Category> {
    const category = await repo.getCategoryById(ctx, id);
    if (!category) throw new ProductCatalogError(`Category '${id}' not found`, 'INVALID_CATEGORY');
    return category;
  }

  async function requireImage(ctx: CatalogContext, id: string): Promise<ProductImage> {
    const image = await repo.getProductImageById(ctx, id);
    if (!image) throw new ProductCatalogError(`Image '${id}' not found`, 'PRODUCT_NOT_FOUND');
    return image;
  }

  async function uniqueSlug<T>(
    ctx: CatalogContext,
    base: string,
    lookup: (slug: string) => Promise<T | null>
  ): Promise<string> {
    void ctx;
    return generateUniqueSlug(base, async (candidate) => (await lookup(slugify(candidate))) !== null);
  }

  async function uploadMediaSafely(input: UploadProductImageInput, ctx: CatalogContext): Promise<MediaStorageOutput> {
    try {
      return await mediaStorage.upload({
        tenantId: ctx.tenantId,
        catalogId: ctx.catalogId,
        productId: input.productId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        content: input.fileBuffer,
      });
    } catch (error) {
      throw mapDomainError(error, 'MEDIA_UPLOAD_FAILED');
    }
  }

  async function deleteMediaSafely(storageKey: string): Promise<void> {
    try {
      await mediaStorage.delete(storageKey);
    } catch (error) {
      throw mapDomainError(error, 'MEDIA_DELETE_FAILED');
    }
  }

  function log(
    ctx: CatalogContext,
    operation: string,
    productId: string | undefined,
    started: number,
    result: 'success' | 'failure',
    errorCode?: ProductCatalogError['code']
  ): void {
    config.logger?.log({
      timestamp: new Date().toISOString(),
      level: result === 'success' ? 'info' : 'error',
      module: 'product-catalog',
      operation,
      tenantId: ctx.tenantId,
      catalogId: ctx.catalogId,
      productId,
      durationMs: Date.now() - started,
      result,
      errorCode,
    });
  }

  async function audit(
    ctx: CatalogContext,
    eventType: AuditEventType,
    entityType: EntityType,
    entityId: string
  ): Promise<void> {
    if (!config.auditSink) return;
    await config.auditSink.record({
      id: createId('audit'),
      timestamp: new Date().toISOString(),
      tenantId: ctx.tenantId,
      catalogId: ctx.catalogId,
      actor: ctx.actor ?? { id: 'system', type: 'system' },
      eventType,
      entityType,
      entityId,
    });
  }

  return service;
}

export async function assertNoCircularCategory(
  ctx: CatalogContext,
  repo: ProductRepository,
  targetCategoryId: string,
  candidateParentId: string | null
): Promise<void> {
  if (!candidateParentId) return;
  if (targetCategoryId === candidateParentId) {
    throw new ProductCatalogError(`Category '${targetCategoryId}' cannot be its own parent`, 'INVALID_CATEGORY');
  }

  let currentId: string | null = candidateParentId;
  const visited = new Set<string>([targetCategoryId]);
  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new ProductCatalogError(
        `Circular category relationship detected: '${currentId}' is an ancestor of category '${targetCategoryId}'`,
        'INVALID_CATEGORY'
      );
    }
    visited.add(currentId);
    const parentCategory = await repo.getCategoryById(ctx, currentId);
    if (!parentCategory) {
      throw new ProductCatalogError(`Parent category '${currentId}' does not exist`, 'INVALID_CATEGORY');
    }
    currentId = parentCategory.parentId;
  }
}

async function assertUniqueProductSku(ctx: CatalogContext, repo: ProductRepository, sku: string): Promise<void> {
  const duplicate = await repo.getProductBySku(ctx, sku);
  if (duplicate) throw new ProductCatalogError(`Product SKU '${sku}' already exists`, 'DUPLICATE_SKU');
}

async function assertUniqueVariantSku(ctx: CatalogContext, repo: ProductRepository, sku: string): Promise<void> {
  const duplicate = await repo.getVariantBySku(ctx, sku);
  if (duplicate) throw new ProductCatalogError(`Variant SKU '${sku}' already exists`, 'DUPLICATE_SKU');
}

function mapDomainError(error: unknown, fallbackCode: ProductCatalogError['code'] = 'PROVIDER_UNAVAILABLE'): ProductCatalogError {
  if (error instanceof ProductCatalogError) {
    return error;
  }
  return new ProductCatalogError('Product catalog provider operation failed', fallbackCode, undefined, error);
}

function createId(prefix: string): string {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
    return `${prefix}_${cryptoProvider.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
