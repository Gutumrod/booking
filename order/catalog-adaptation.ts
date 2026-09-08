import type { CreateProductInput } from './catalog/index.ts';

export type Bk01CatalogProductInput = Omit<CreateProductInput, 'stockQuantity' | 'trackInventory'> & { stockQuantity?: number; trackInventory?: boolean };

export function adaptBk01CatalogProductInput(input: Bk01CatalogProductInput): CreateProductInput {
  if ((input.stockQuantity ?? 0) !== 0 || (input.trackInventory ?? false) !== false) {
    throw new Error('Inventory semantics are disabled for BK01 Order V1');
  }
  return Object.freeze({ ...input, stockQuantity: 0, trackInventory: false });
}
