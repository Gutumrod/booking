import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProductCatalogError } from '../../../core/errors.js';
import { normalizeSku } from '../../../core/utils/sku.js';
import type {
  Brand,
  BrandQuery,
  CatalogContext,
  Category,
  CategoryQuery,
  CustomAttributeMap,
  PaginatedResult,
  Product,
  ProductImage,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  Variant,
} from '../../../core/types.js';
import { acquireFileLock } from './file-lock.js';
import { parseCsv, serializeCsv, type CsvRow } from './csv-parser.js';

export type CsvProductRepositoryOptions = {
  dataDirectory: string;
  lockTimeoutMs?: number;
};

type TableName = 'products' | 'variants' | 'brands' | 'categories' | 'product_images';

const HEADERS: Record<TableName, string[]> = {
  products: [
    'id',
    'tenant_id',
    'catalog_id',
    'sku',
    'name',
    'slug',
    'description',
    'short_description',
    'status',
    'brand_id',
    'category_id',
    'price',
    'compare_at_price',
    'cost_price',
    'currency',
    'stock_quantity',
    'track_inventory',
    'is_active',
    'is_featured',
    'primary_image_id',
    'attributes_json',
    'metadata_json',
    'created_at',
    'updated_at',
    'archived_at',
  ],
  variants: [
    'id',
    'tenant_id',
    'catalog_id',
    'product_id',
    'sku',
    'name',
    'price',
    'compare_at_price',
    'stock_quantity',
    'attributes_json',
    'is_active',
    'created_at',
    'updated_at',
  ],
  brands: ['id', 'tenant_id', 'catalog_id', 'name', 'slug', 'description', 'logo_url', 'is_active', 'created_at', 'updated_at'],
  categories: [
    'id',
    'tenant_id',
    'catalog_id',
    'parent_id',
    'name',
    'slug',
    'description',
    'image_url',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at',
  ],
  product_images: [
    'id',
    'tenant_id',
    'catalog_id',
    'product_id',
    'storage_provider',
    'storage_key',
    'public_url',
    'file_name',
    'mime_type',
    'file_size',
    'width',
    'height',
    'alt_text',
    'sort_order',
    'is_primary',
    'created_at',
  ],
};

const FILES: Record<TableName, string> = {
  products: 'products.csv',
  variants: 'variants.csv',
  brands: 'brands.csv',
  categories: 'categories.csv',
  product_images: 'product_images.csv',
};

export class CsvProductRepository implements ProductRepository {
  private readonly dataDirectory: string;
  private readonly lockTimeoutMs: number;

  constructor(options: CsvProductRepositoryOptions) {
    if (!options.dataDirectory) {
      throw new ProductCatalogError('dataDirectory is required', 'CONFIGURATION_ERROR');
    }
    this.dataDirectory = path.resolve(options.dataDirectory);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 3000;
    fs.mkdirSync(this.dataDirectory, { recursive: true });
    for (const table of Object.keys(HEADERS) as TableName[]) {
      this.ensureFile(table);
    }
  }

  async createProduct(ctx: CatalogContext, product: Product): Promise<Product> {
    return this.mutate('products', (rows) => {
      if (rows.some((row) => sameScope(row, ctx) && row.sku === product.sku)) {
        throw new ProductCatalogError(`Product SKU '${product.sku}' already exists`, 'DUPLICATE_SKU');
      }
      rows.push(productToRow(product));
      return product;
    });
  }

  async getProductById(ctx: CatalogContext, id: string): Promise<Product | null> {
    return this.find('products', ctx, (row) => row.id === id, rowToProduct);
  }

  async getProductBySku(ctx: CatalogContext, sku: string): Promise<Product | null> {
    const normalized = normalizeSku(sku);
    return this.find('products', ctx, (row) => row.sku === normalized, rowToProduct);
  }

  async getProductBySlug(ctx: CatalogContext, slug: string): Promise<Product | null> {
    return this.find('products', ctx, (row) => row.slug === slug, rowToProduct);
  }

  async updateProduct(ctx: CatalogContext, product: Product): Promise<Product> {
    return this.replace('products', ctx, product.id, productToRow(product), rowToProduct);
  }

  async deleteProduct(ctx: CatalogContext, id: string): Promise<void> {
    await this.deleteById('products', ctx, id);
    await this.mutate('variants', (rows) => removeRows(rows, (row) => sameScope(row, ctx) && row.product_id === id));
    await this.mutate('product_images', (rows) => removeRows(rows, (row) => sameScope(row, ctx) && row.product_id === id));
  }

  async listProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>> {
    const products = this.read('products').filter((row) => sameScope(row, ctx)).map(rowToProduct);
    return this.filterProducts(ctx, products, query);
  }

  async searchProducts(ctx: CatalogContext, query: ProductQuery): Promise<PaginatedResult<Product>> {
    return this.listProducts(ctx, query);
  }

  async createVariant(ctx: CatalogContext, variant: Variant): Promise<Variant> {
    return this.mutate('variants', (rows) => {
      if (rows.some((row) => sameScope(row, ctx) && row.sku === variant.sku)) {
        throw new ProductCatalogError(`Variant SKU '${variant.sku}' already exists`, 'DUPLICATE_SKU');
      }
      rows.push(variantToRow(variant));
      return variant;
    });
  }

  async getVariantById(ctx: CatalogContext, id: string): Promise<Variant | null> {
    return this.find('variants', ctx, (row) => row.id === id, rowToVariant);
  }

  async getVariantBySku(ctx: CatalogContext, sku: string): Promise<Variant | null> {
    const normalized = normalizeSku(sku);
    return this.find('variants', ctx, (row) => row.sku === normalized, rowToVariant);
  }

  async updateVariant(ctx: CatalogContext, variant: Variant): Promise<Variant> {
    return this.replace('variants', ctx, variant.id, variantToRow(variant), rowToVariant);
  }

  async deleteVariant(ctx: CatalogContext, id: string): Promise<void> {
    await this.deleteById('variants', ctx, id);
  }

  async listVariantsByProductId(ctx: CatalogContext, productId: string): Promise<Variant[]> {
    return this.read('variants').filter((row) => sameScope(row, ctx) && row.product_id === productId).map(rowToVariant);
  }

  async createBrand(_ctx: CatalogContext, brand: Brand): Promise<Brand> {
    return this.mutate('brands', (rows) => {
      rows.push(brandToRow(brand));
      return brand;
    });
  }

  async getBrandById(ctx: CatalogContext, id: string): Promise<Brand | null> {
    return this.find('brands', ctx, (row) => row.id === id, rowToBrand);
  }

  async getBrandBySlug(ctx: CatalogContext, slug: string): Promise<Brand | null> {
    return this.find('brands', ctx, (row) => row.slug === slug, rowToBrand);
  }

  async updateBrand(ctx: CatalogContext, brand: Brand): Promise<Brand> {
    return this.replace('brands', ctx, brand.id, brandToRow(brand), rowToBrand);
  }

  async deleteBrand(ctx: CatalogContext, id: string): Promise<void> {
    await this.deleteById('brands', ctx, id);
  }

  async listBrands(ctx: CatalogContext, query: BrandQuery = {}): Promise<PaginatedResult<Brand>> {
    let brands = this.read('brands').filter((row) => sameScope(row, ctx)).map(rowToBrand);
    if (query.search) {
      const search = query.search.toLowerCase();
      brands = brands.filter((brand) => brand.name.toLowerCase().includes(search) || brand.slug.includes(search));
    }
    if (query.isActive !== undefined) {
      brands = brands.filter((brand) => brand.isActive === query.isActive);
    }
    return paginate(brands, query.page ?? 1, query.limit ?? 20);
  }

  async createCategory(_ctx: CatalogContext, category: Category): Promise<Category> {
    return this.mutate('categories', (rows) => {
      rows.push(categoryToRow(category));
      return category;
    });
  }

  async getCategoryById(ctx: CatalogContext, id: string): Promise<Category | null> {
    return this.find('categories', ctx, (row) => row.id === id, rowToCategory);
  }

  async getCategoryBySlug(ctx: CatalogContext, slug: string): Promise<Category | null> {
    return this.find('categories', ctx, (row) => row.slug === slug, rowToCategory);
  }

  async updateCategory(ctx: CatalogContext, category: Category): Promise<Category> {
    return this.replace('categories', ctx, category.id, categoryToRow(category), rowToCategory);
  }

  async deleteCategory(ctx: CatalogContext, id: string): Promise<void> {
    await this.deleteById('categories', ctx, id);
  }

  async listCategories(ctx: CatalogContext, query: CategoryQuery = {}): Promise<Category[]> {
    let categories = this.read('categories').filter((row) => sameScope(row, ctx)).map(rowToCategory);
    if (query.parentId !== undefined) {
      categories = categories.filter((category) => category.parentId === query.parentId);
    }
    if (query.search) {
      const search = query.search.toLowerCase();
      categories = categories.filter((category) => category.name.toLowerCase().includes(search) || category.slug.includes(search));
    }
    if (query.isActive !== undefined) {
      categories = categories.filter((category) => category.isActive === query.isActive);
    }
    return categories.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  }

  async createProductImage(_ctx: CatalogContext, image: ProductImage): Promise<ProductImage> {
    return this.mutate('product_images', (rows) => {
      rows.push(imageToRow(image));
      return image;
    });
  }

  async getProductImageById(ctx: CatalogContext, id: string): Promise<ProductImage | null> {
    return this.find('product_images', ctx, (row) => row.id === id, rowToImage);
  }

  async updateProductImage(ctx: CatalogContext, image: ProductImage): Promise<ProductImage> {
    return this.replace('product_images', ctx, image.id, imageToRow(image), rowToImage);
  }

  async deleteProductImage(ctx: CatalogContext, id: string): Promise<void> {
    await this.deleteById('product_images', ctx, id);
  }

  async listProductImages(ctx: CatalogContext, productId: string): Promise<ProductImage[]> {
    return this.read('product_images')
      .filter((row) => sameScope(row, ctx) && row.product_id === productId)
      .map(rowToImage)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private filterProducts(ctx: CatalogContext, products: Product[], query: ProductQuery): PaginatedResult<Product> {
    const brands = new Map(this.read('brands').filter((row) => sameScope(row, ctx)).map((row) => [row.id, rowToBrand(row)]));
    const categories = new Map(
      this.read('categories').filter((row) => sameScope(row, ctx)).map((row) => [row.id, rowToCategory(row)])
    );

    let items = [...products];
    if (query.search) {
      const search = query.search.toLowerCase();
      items = items.filter((product) => {
        const brandName = product.brandId ? brands.get(product.brandId)?.name ?? '' : '';
        const categoryName = product.categoryId ? categories.get(product.categoryId)?.name ?? '' : '';
        return [product.name, product.sku, product.description ?? '', brandName, categoryName].some((value) =>
          value.toLowerCase().includes(search)
        );
      });
    }
    if (query.categoryId) items = items.filter((product) => product.categoryId === query.categoryId);
    if (query.brandId) items = items.filter((product) => product.brandId === query.brandId);
    if (query.status) items = items.filter((product) => product.status === query.status);
    if (query.minPrice !== undefined) items = items.filter((product) => product.price >= query.minPrice!);
    if (query.maxPrice !== undefined) items = items.filter((product) => product.price <= query.maxPrice!);
    if (query.inStock !== undefined) items = items.filter((product) => (product.stockQuantity > 0) === query.inStock);
    if (query.isFeatured !== undefined) items = items.filter((product) => product.isFeatured === query.isFeatured);
    if (query.attributes) {
      items = items.filter((product) =>
        Object.entries(query.attributes ?? {}).every(([key, expected]) => attributeMatches(product.attributes, key, expected))
      );
    }
    if (query.sort) {
      const { field, order } = query.sort;
      items.sort((left, right) => compareValues(left[field], right[field]) * (order === 'asc' ? 1 : -1));
    } else {
      items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
    return paginate(items, query.page ?? 1, query.limit ?? 20);
  }

  private async find<T>(
    table: TableName,
    ctx: CatalogContext,
    predicate: (row: CsvRow) => boolean,
    mapper: (row: CsvRow) => T
  ): Promise<T | null> {
    const row = this.read(table).find((item) => sameScope(item, ctx) && predicate(item));
    return row ? mapper(row) : null;
  }

  private async replace<T>(
    table: TableName,
    ctx: CatalogContext,
    id: string,
    replacement: CsvRow,
    mapper: (row: CsvRow) => T
  ): Promise<T> {
    return this.mutate(table, (rows) => {
      const index = rows.findIndex((row) => sameScope(row, ctx) && row.id === id);
      if (index === -1) {
        throw new ProductCatalogError(`Record '${id}' not found`, table === 'products' ? 'PRODUCT_NOT_FOUND' : 'STORAGE_ERROR');
      }
      rows[index] = replacement;
      return mapper(replacement);
    });
  }

  private async deleteById(table: TableName, ctx: CatalogContext, id: string): Promise<void> {
    await this.mutate(table, (rows) => {
      const before = rows.length;
      removeRows(rows, (row) => sameScope(row, ctx) && row.id === id);
      if (rows.length === before) {
        throw new ProductCatalogError(`Record '${id}' not found`, table === 'products' ? 'PRODUCT_NOT_FOUND' : 'STORAGE_ERROR');
      }
    });
  }

  private read(table: TableName): CsvRow[] {
    try {
      this.ensureFile(table);
      return parseCsv(fs.readFileSync(this.filePath(table), 'utf8'), HEADERS[table]);
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw mapFsError(error);
    }
  }

  private async mutate<T>(table: TableName, update: (rows: CsvRow[]) => T): Promise<T> {
    const filePath = this.filePath(table);
    const lock = await acquireFileLock(filePath, this.lockTimeoutMs);
    try {
      const rows = this.read(table);
      const result = update(rows);
      this.write(table, rows);
      return result;
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw mapFsError(error);
    } finally {
      lock.release();
    }
  }

  private write(table: TableName, rows: CsvRow[]): void {
    const filePath = this.filePath(table);
    const tmpPath = `${filePath}.tmp.${crypto.randomUUID()}`;
    const content = serializeCsv(HEADERS[table], rows);
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      }
      const fd = fs.openSync(tmpPath, 'w');
      try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
      throw mapFsError(error);
    }
  }

  private ensureFile(table: TableName): void {
    const filePath = this.filePath(table);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, serializeCsv(HEADERS[table], []), 'utf8');
    }
  }

  private filePath(table: TableName): string {
    return path.join(this.dataDirectory, FILES[table]);
  }
}

export function createCsvProductRepository(options: CsvProductRepositoryOptions): ProductRepository {
  return new CsvProductRepository(options);
}

function productToRow(product: Product): CsvRow {
  return {
    id: product.id,
    tenant_id: product.tenantId,
    catalog_id: product.catalogId,
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    description: product.description ?? '',
    short_description: product.shortDescription ?? '',
    status: product.status,
    brand_id: product.brandId ?? '',
    category_id: product.categoryId ?? '',
    price: String(product.price),
    compare_at_price: nullableNumber(product.compareAtPrice),
    cost_price: nullableNumber(product.costPrice),
    currency: product.currency,
    stock_quantity: String(product.stockQuantity),
    track_inventory: String(product.trackInventory),
    is_active: String(product.isActive),
    is_featured: String(product.isFeatured),
    primary_image_id: product.primaryImageId ?? '',
    attributes_json: JSON.stringify(product.attributes),
    metadata_json: JSON.stringify(product.metadata),
    created_at: product.createdAt,
    updated_at: product.updatedAt,
    archived_at: product.archivedAt ?? '',
  };
}

function rowToProduct(row: CsvRow): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    catalogId: row.catalog_id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: nullableString(row.description),
    shortDescription: nullableString(row.short_description),
    status: row.status as ProductStatus,
    brandId: nullableString(row.brand_id),
    categoryId: nullableString(row.category_id),
    price: numberValue(row.price),
    compareAtPrice: nullableNumberValue(row.compare_at_price),
    costPrice: nullableNumberValue(row.cost_price),
    currency: row.currency,
    stockQuantity: numberValue(row.stock_quantity),
    trackInventory: booleanValue(row.track_inventory),
    isActive: booleanValue(row.is_active),
    isFeatured: booleanValue(row.is_featured),
    primaryImageId: nullableString(row.primary_image_id),
    attributes: jsonValue<CustomAttributeMap>(row.attributes_json, {}),
    metadata: jsonValue<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: nullableString(row.archived_at),
  };
}

function variantToRow(variant: Variant): CsvRow {
  return {
    id: variant.id,
    tenant_id: variant.tenantId,
    catalog_id: variant.catalogId,
    product_id: variant.productId,
    sku: variant.sku,
    name: variant.name,
    price: String(variant.price),
    compare_at_price: nullableNumber(variant.compareAtPrice),
    stock_quantity: String(variant.stockQuantity),
    attributes_json: JSON.stringify(variant.attributes),
    is_active: String(variant.isActive),
    created_at: variant.createdAt,
    updated_at: variant.updatedAt,
  };
}

function rowToVariant(row: CsvRow): Variant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    catalogId: row.catalog_id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    price: numberValue(row.price),
    compareAtPrice: nullableNumberValue(row.compare_at_price),
    stockQuantity: numberValue(row.stock_quantity),
    attributes: jsonValue<CustomAttributeMap>(row.attributes_json, {}),
    isActive: booleanValue(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function brandToRow(brand: Brand): CsvRow {
  return {
    id: brand.id,
    tenant_id: brand.tenantId,
    catalog_id: brand.catalogId,
    name: brand.name,
    slug: brand.slug,
    description: brand.description ?? '',
    logo_url: brand.logoUrl ?? '',
    is_active: String(brand.isActive),
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
  };
}

function rowToBrand(row: CsvRow): Brand {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    catalogId: row.catalog_id,
    name: row.name,
    slug: row.slug,
    description: nullableString(row.description),
    logoUrl: nullableString(row.logo_url),
    isActive: booleanValue(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function categoryToRow(category: Category): CsvRow {
  return {
    id: category.id,
    tenant_id: category.tenantId,
    catalog_id: category.catalogId,
    parent_id: category.parentId ?? '',
    name: category.name,
    slug: category.slug,
    description: category.description ?? '',
    image_url: category.imageUrl ?? '',
    sort_order: String(category.sortOrder),
    is_active: String(category.isActive),
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

function rowToCategory(row: CsvRow): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    catalogId: row.catalog_id,
    parentId: nullableString(row.parent_id),
    name: row.name,
    slug: row.slug,
    description: nullableString(row.description),
    imageUrl: nullableString(row.image_url),
    sortOrder: numberValue(row.sort_order),
    isActive: booleanValue(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function imageToRow(image: ProductImage): CsvRow {
  return {
    id: image.id,
    tenant_id: image.tenantId,
    catalog_id: image.catalogId,
    product_id: image.productId,
    storage_provider: image.storageProvider,
    storage_key: image.storageKey,
    public_url: image.publicUrl,
    file_name: image.fileName,
    mime_type: image.mimeType,
    file_size: String(image.fileSize),
    width: nullableNumber(image.width),
    height: nullableNumber(image.height),
    alt_text: image.altText ?? '',
    sort_order: String(image.sortOrder),
    is_primary: String(image.isPrimary),
    created_at: image.createdAt,
  };
}

function rowToImage(row: CsvRow): ProductImage {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    catalogId: row.catalog_id,
    productId: row.product_id,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    publicUrl: row.public_url,
    fileName: row.file_name,
    mimeType: row.mime_type as ProductImage['mimeType'],
    fileSize: numberValue(row.file_size),
    width: nullableNumberValue(row.width),
    height: nullableNumberValue(row.height),
    altText: nullableString(row.alt_text),
    sortOrder: numberValue(row.sort_order),
    isPrimary: booleanValue(row.is_primary),
    createdAt: row.created_at,
  };
}

function paginate<T>(items: T[], page: number, limit: number): PaginatedResult<T> {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.floor(limit));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

function sameScope(row: CsvRow, ctx: CatalogContext): boolean {
  return row.tenant_id === ctx.tenantId && row.catalog_id === ctx.catalogId;
}

function attributeMatches(attributes: CustomAttributeMap, key: string, expected: string | number | boolean): boolean {
  const attr = attributes[key];
  if (!attr) return false;
  if (attr.type === 'multi_enum') return attr.value.includes(String(expected));
  return attr.value === expected;
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function removeRows(rows: CsvRow[], predicate: (row: CsvRow) => boolean): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index]!)) rows.splice(index, 1);
  }
}

function nullableString(value: string): string | null {
  return value === '' ? null : value;
}

function nullableNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

function numberValue(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ProductCatalogError('CSV numeric field is corrupted', 'CSV_CORRUPTED');
  return parsed;
}

function nullableNumberValue(value: string): number | null {
  return value === '' ? null : numberValue(value);
}

function booleanValue(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ProductCatalogError('CSV boolean field is corrupted', 'CSV_CORRUPTED');
}

function jsonValue<T>(value: string, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new ProductCatalogError('CSV JSON field is corrupted', 'CSV_CORRUPTED', undefined, error);
  }
}

function mapFsError(error: unknown): ProductCatalogError {
  if (error instanceof ProductCatalogError) return error;
  if (isFsCode(error, 'EACCES') || isFsCode(error, 'ENOSPC') || isFsCode(error, 'ENOENT')) {
    return new ProductCatalogError('CSV storage operation failed', 'STORAGE_ERROR', undefined, error);
  }
  return new ProductCatalogError('CSV provider operation failed', 'STORAGE_ERROR', undefined, error);
}

function isFsCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
