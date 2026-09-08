import fs from 'node:fs';
import { ProductCatalogError } from '../../../core/errors.js';

export type FileLock = {
  release(): void;
};

export async function acquireFileLock(filePath: string, lockTimeoutMs = 3000): Promise<FileLock> {
  const lockPath = `${filePath}.lock`;
  const started = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${Date.now()}`, 'utf8');
      return {
        release: () => {
          try {
            fs.closeSync(fd);
          } finally {
            if (fs.existsSync(lockPath)) {
              fs.unlinkSync(lockPath);
            }
          }
        },
      };
    } catch (error) {
      if (!isFsCode(error, 'EEXIST')) {
        throw new ProductCatalogError('Failed to acquire CSV lock', 'STORAGE_ERROR', undefined, error);
      }
      if (Date.now() - started >= lockTimeoutMs) {
        throw new ProductCatalogError('CSV file is locked', 'CSV_LOCKED', { filePath });
      }
      await delay(50);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isFsCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
