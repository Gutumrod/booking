import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalMediaStorage } from '../../index.js';
import type { MediaStorage } from '../../index.js';

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
]);

const JPEG_BYTES = new Uint8Array([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
]);

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);

const PUBLIC_BASE = 'http://localhost:3000';

let tempDir: string;
let storage: MediaStorage;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'pc-media-'));
  storage = createLocalMediaStorage({
    baseUploadDir: tempDir,
    publicBaseUrl: PUBLIC_BASE,
  });
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('LocalMediaStorage integration', () => {
  describe('upload PNG', () => {
    it('uploads a PNG file successfully', async () => {
      const result = await storage.upload({
        tenantId: 'tenant-m',
        catalogId: 'catalog-m',
        productId: 'prod-png-001',
        fileName: 'test.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      expect(result.storageProvider).toBe('local');
      expect(result.mimeType).toBe('image/png');
      expect(result.fileSize).toBe(PNG_1X1.byteLength);
      expect(result.publicUrl).toBe(`${PUBLIC_BASE}/${result.storageKey}`);
    });

    it('uses the storage key layout uploads/products/{productId}/{uuid}.png', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'prod-layout',
        fileName: 'image.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      expect(result.storageKey).toMatch(/^uploads\/products\/prod-layout\/[0-9a-f-]+\.png$/);
    });

    it('records sanitized originalFileName in metadata', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'my image.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.originalFileName).toBe('my image.png');
    });
  });

  describe('upload JPEG', () => {
    it('uploads a JPEG file successfully', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'prod-jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        content: JPEG_BYTES,
      });

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.fileSize).toBe(JPEG_BYTES.byteLength);
      expect(result.storageKey).toMatch(/\.jpg$/);
    });
  });

  describe('upload WEBP', () => {
    it('uploads a WEBP file successfully', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'prod-webp',
        fileName: 'photo.webp',
        mimeType: 'image/webp',
        content: WEBP_BYTES,
      });

      expect(result.mimeType).toBe('image/webp');
      expect(result.storageKey).toMatch(/\.webp$/);
    });
  });

  describe('exists', () => {
    it('returns true after upload', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'f.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      expect(await storage.exists(result.storageKey)).toBe(true);
    });

    it('returns false for a non-existent key', async () => {
      expect(await storage.exists('uploads/products/no-such/file.png')).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('returns metadata for an uploaded file', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'meta.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      const meta = await storage.getMetadata(result.storageKey);
      expect(meta.storageKey).toBe(result.storageKey);
      expect(meta.fileSize).toBe(PNG_1X1.byteLength);
      expect(meta.mimeType).toBe('image/png');
      expect(meta.lastModified).toBeDefined();
    });
  });

  describe('delete', () => {
    it('deletes an uploaded file', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'del.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      await storage.delete(result.storageKey);
      expect(await storage.exists(result.storageKey)).toBe(false);
    });

    it('is idempotent (deleting a missing key does not throw)', async () => {
      await expect(storage.delete('uploads/products/no-such/file.png')).resolves.toBeUndefined();
    });
  });

  describe('move', () => {
    it('moves a file to a new key', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'move.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      const targetKey = 'uploads/products/p1/moved.png';
      const moved = await storage.move(result.storageKey, targetKey);
      expect(moved.storageKey).toBe(targetKey);
      expect(await storage.exists(result.storageKey)).toBe(false);
      expect(await storage.exists(targetKey)).toBe(true);
    });
  });

  describe('copy', () => {
    it('copies a file to a new key', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'copy.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      const targetKey = 'uploads/products/p1/copied.png';
      const copied = await storage.copy(result.storageKey, targetKey);
      expect(copied.storageKey).toBe(targetKey);
      expect(await storage.exists(result.storageKey)).toBe(true);
      expect(await storage.exists(targetKey)).toBe(true);
    });
  });

  describe('filename sanitization', () => {
    it('sanitizes fileName with ../evil in metadata.originalFileName', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: '../evil.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      const originalName = result.metadata!.originalFileName;
      expect(originalName).not.toContain('..');
      expect(originalName).not.toContain('/');
    });

    it('sanitizes fileName with path separators a/b\\c', async () => {
      const result = await storage.upload({
        tenantId: 't1',
        catalogId: 'c1',
        productId: 'p1',
        fileName: 'a/b\\c.png',
        mimeType: 'image/png',
        content: PNG_1X1,
      });

      const originalName = result.metadata!.originalFileName;
      expect(originalName).not.toContain('/');
      expect(originalName).not.toContain('\\');
    });
  });

  describe('getPublicUrl', () => {
    it('strips leading slashes from the key', () => {
      const url = storage.getPublicUrl('/uploads/products/p1/f.png');
      expect(url).toBe(`${PUBLIC_BASE}/uploads/products/p1/f.png`);
    });

    it('strips leading backslashes from the key', () => {
      const url = storage.getPublicUrl('\\uploads\\products\\p1\\f.png');
      expect(url).toBe(`${PUBLIC_BASE}/uploads/products/p1/f.png`);
    });

    it('constructs URL for a normal key', () => {
      const url = storage.getPublicUrl('uploads/products/p1/f.png');
      expect(url).toBe(`${PUBLIC_BASE}/uploads/products/p1/f.png`);
    });
  });

  describe('path traversal protection', () => {
    it('delete with ../ traversal key throws STORAGE_ERROR', async () => {
      await expect(storage.delete('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('exists with ../ traversal key throws STORAGE_ERROR', async () => {
      await expect(storage.exists('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('getMetadata with ../ traversal key throws STORAGE_ERROR', async () => {
      await expect(storage.getMetadata('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('delete with NUL byte key throws STORAGE_ERROR', async () => {
      await expect(storage.delete('uploads\0/../../evil.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('exists with NUL byte key throws STORAGE_ERROR', async () => {
      await expect(storage.exists('uploads\0/../evil.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('getMetadata with NUL byte key throws STORAGE_ERROR', async () => {
      await expect(storage.getMetadata('uploads\0/evil.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('move with traversal source key throws STORAGE_ERROR', async () => {
      await expect(
        storage.move('../../outside.png', 'uploads/products/p1/safe.png')
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    });

    it('copy with traversal target key throws STORAGE_ERROR', async () => {
      await expect(
        storage.copy('uploads/products/p1/safe.png', '../../evil.png')
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    });
  });
});