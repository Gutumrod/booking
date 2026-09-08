import { ProductCatalogError } from '../errors.js';

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/\0/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '.')
    .trim()
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'file';
}

export function assertSafePath(baseDir: string, target: string): string {
  const normalizedBase = normalizePath(baseDir);
  const normalizedTarget = normalizePath(target);
  const prefix = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;

  if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(prefix)) {
    throw new ProductCatalogError('Path traversal detected', 'STORAGE_ERROR');
  }

  return target;
}

function normalizePath(value: string): string {
  const raw = value.replace(/\\/g, '/');
  const match = /^([A-Za-z]:)?(\/)?(.*)$/.exec(raw);
  const drive = match?.[1]?.toLowerCase() ?? '';
  const absolute = match?.[2] ?? '';
  const rest = match?.[3] ?? raw;
  const parts: string[] = [];

  for (const part of rest.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `${drive}${absolute}${parts.join('/')}`.replace(/\/+$/, '');
}
