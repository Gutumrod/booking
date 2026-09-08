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

const RANDOM_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

const PUBLIC_BASE = 'http://localhost:3000';

let tempDir: string;
let storage: MediaStorage;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'pc-media-fail-'));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function makeStorage(maxFileSizeByte?: number): MediaStorage {
  return createLocalMediaStorage({
    baseUploadDir: tempDir,
    publicBaseUrl: PUBLIC_BASE,
    maxFileSizeByte,
  });
}

describe('LocalMediaStorage failure scenarios', () => {
  describe('oversized upload', () => {
    it('rejects content larger than maxFileSizeByte with INVALID_PRODUCT_DATA', async () => {
      storage = makeStorage(4);
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'big.png',
          mimeType: 'image/png',
          content: new Uint8Array(5),
        })
      ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_DATA' });
    });

    it('rejects a 5-byte file when maxFileSizeByte is 4', async () => {
      storage = makeStorage(4);
      const fiveBytes = new Uint8Array([1, 2, 3, 4, 5]);
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'big.png',
          mimeType: 'image/png',
          content: fiveBytes,
        })
      ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_DATA' });
    });
  });

  describe('MIME mismatch', () => {
    it('rejects declared image/png but content is JPEG bytes with MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'fake.png',
          mimeType: 'image/png',
          content: JPEG_BYTES,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('rejects declared image/jpeg but content is PNG bytes with MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'fake.jpg',
          mimeType: 'image/jpeg',
          content: PNG_1X1,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });
  });

  describe('unsupported MIME', () => {
    it('rejects declared image/gif with random content as MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'test.gif',
          mimeType: 'image/gif',
          content: RANDOM_BYTES,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('rejects declared image/png with random content (no magic bytes) as MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'random.png',
          mimeType: 'image/png',
          content: RANDOM_BYTES,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('rejects declared image/jpeg with random content (no magic bytes) as MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'random.jpg',
          mimeType: 'image/jpeg',
          content: RANDOM_BYTES,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });

    it('rejects declared image/webp with random content (no magic bytes) as MEDIA_UPLOAD_FAILED', async () => {
      storage = makeStorage();
      await expect(
        storage.upload({
          tenantId: 't1',
          catalogId: 'c1',
          productId: 'p1',
          fileName: 'random.webp',
          mimeType: 'image/webp',
          content: RANDOM_BYTES,
        })
      ).rejects.toMatchObject({ code: 'MEDIA_UPLOAD_FAILED' });
    });
  });

  describe('path traversal', () => {
    it('delete with ../ traversal key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.delete('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('exists with ../ traversal key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.exists('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('getMetadata with ../ traversal key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.getMetadata('../../outside.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('delete with NUL byte key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.delete('evil\0.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('exists with NUL byte key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.exists('evil\0.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });

    it('getMetadata with NUL byte key throws STORAGE_ERROR', async () => {
      storage = makeStorage();
      await expect(storage.getMetadata('evil\0.png')).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });
  });

  describe('delete on missing key', () => {
    it('does not throw when deleting a non-existent file', async () => {
      storage = makeStorage();
      await expect(
        storage.delete('uploads/products/no-such-product/missing.png')
      ).resolves.toBeUndefined();
    });
  });

  describe('move with missing source', () => {
    it('throws STORAGE_ERROR when source does not exist', async () => {
      storage = makeStorage();
      await expect(
        storage.move('uploads/products/missing/src.png', 'uploads/products/p1/dst.png')
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    });
  });

  describe('getMetadata on missing key', () => {
    it('throws STORAGE_ERROR when file does not exist', async () => {
      storage = makeStorage();
      await expect(
        storage.getMetadata('uploads/products/missing/file.png')
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    });
  });

  describe('copy with missing source', () => {
    it('throws STORAGE_ERROR when source does not exist', async () => {
      storage = makeStorage();
      await expect(
        storage.copy('uploads/products/missing/src.png', 'uploads/products/p1/dst.png')
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    });
  });
});