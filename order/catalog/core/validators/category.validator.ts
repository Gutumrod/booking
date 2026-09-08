import { ProductCatalogError } from '../errors.js';
import type { CreateCategoryInput, UpdateCategoryInput } from '../types.js';

export function validateCreateCategoryInput(input: CreateCategoryInput): void {
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new ProductCatalogError('Category name is required', 'INVALID_CATEGORY');
  }
  validateCategoryPatch(input);
}

export function validateUpdateCategoryInput(input: UpdateCategoryInput): void {
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length === 0)) {
    throw new ProductCatalogError('Category name must not be empty', 'INVALID_CATEGORY');
  }
  validateCategoryPatch(input);
}

function validateCategoryPatch(input: UpdateCategoryInput): void {
  if (input.sortOrder !== undefined && typeof input.sortOrder !== 'number') {
    throw new ProductCatalogError('sortOrder must be a number', 'INVALID_CATEGORY');
  }
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    throw new ProductCatalogError('isActive must be a boolean', 'INVALID_CATEGORY');
  }
}
