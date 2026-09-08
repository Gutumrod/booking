export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function isValidSku(sku: string): boolean {
  return /^[A-Z0-9_-]{3,64}$/.test(sku);
}
