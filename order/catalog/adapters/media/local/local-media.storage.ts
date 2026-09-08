import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProductCatalogError } from '../../../core/errors.js';
import { assertSafePath, sanitizeFileName } from '../../../core/utils/sanitize.js';
import type { MediaMetadata, MediaStorage, MediaStorageOutput, UploadMediaInput } from '../../../core/types.js';

export type LocalMediaStorageOptions = {
  baseUploadDir: string;
  publicBaseUrl: string;
  maxFileSizeByte?: number;
};

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;

type SupportedMime = 'image/jpeg' | 'image/png' | 'image/webp';

export class LocalMediaStorage implements MediaStorage {
  private readonly baseUploadDir: string;
  private readonly publicBaseUrl: string;
  private readonly maxFileSizeByte: number;

  constructor(options: LocalMediaStorageOptions) {
    if (!options.baseUploadDir || !options.publicBaseUrl) {
      throw new ProductCatalogError('baseUploadDir and publicBaseUrl are required', 'CONFIGURATION_ERROR');
    }
    this.baseUploadDir = path.resolve(options.baseUploadDir);
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
    this.maxFileSizeByte = options.maxFileSizeByte ?? DEFAULT_MAX_FILE_SIZE;
    fs.mkdirSync(this.baseUploadDir, { recursive: true });
  }

  async upload(input: UploadMediaInput): Promise<MediaStorageOutput> {
    try {
      const content = toUint8Array(input.content);
      if (content.byteLength > this.maxFileSizeByte) {
        throw new ProductCatalogError('File size exceeds limit', 'INVALID_PRODUCT_DATA');
      }

      const detectedMime = detectMimeType(content);
      if (detectedMime !== input.mimeType) {
        throw new ProductCatalogError('Unsupported or corrupted image file', 'MEDIA_UPLOAD_FAILED');
      }

      const safeOriginalName = sanitizeFileName(input.fileName);
      const targetFileName = `${crypto.randomUUID()}.${extensionForMime(detectedMime)}`;
      const relativeKey = path.posix.join('uploads', 'products', sanitizePathSegment(input.productId), targetFileName);
      const targetPath = this.resolveStorageKey(relativeKey);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const fd = fs.openSync(targetPath, 'w');
      try {
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      return {
        storageProvider: 'local',
        storageKey: relativeKey,
        publicUrl: this.getPublicUrl(relativeKey),
        fileSize: content.byteLength,
        mimeType: detectedMime,
        metadata: { originalFileName: safeOriginalName },
      };
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media upload failed', 'MEDIA_UPLOAD_FAILED', undefined, error);
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      const targetPath = this.resolveStorageKey(storageKey);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media delete failed', 'MEDIA_DELETE_FAILED', undefined, error);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      return fs.existsSync(this.resolveStorageKey(storageKey));
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media exists check failed', 'STORAGE_ERROR', undefined, error);
    }
  }

  getPublicUrl(storageKey: string): string {
    const safeKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${this.publicBaseUrl}/${safeKey}`;
  }

  async getMetadata(storageKey: string): Promise<MediaMetadata> {
    try {
      const targetPath = this.resolveStorageKey(storageKey);
      const stat = fs.statSync(targetPath);
      const content = fs.readFileSync(targetPath);
      return {
        storageKey,
        fileSize: stat.size,
        mimeType: detectMimeType(content),
        lastModified: stat.mtime.toISOString(),
      };
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media metadata read failed', 'STORAGE_ERROR', undefined, error);
    }
  }

  async move(sourceKey: string, targetKey: string): Promise<MediaStorageOutput> {
    try {
      const sourcePath = this.resolveStorageKey(sourceKey);
      const targetPath = this.resolveStorageKey(targetKey);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.renameSync(sourcePath, targetPath);
      return this.outputForKey(targetKey);
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media move failed', 'STORAGE_ERROR', undefined, error);
    }
  }

  async copy(sourceKey: string, targetKey: string): Promise<MediaStorageOutput> {
    try {
      const sourcePath = this.resolveStorageKey(sourceKey);
      const targetPath = this.resolveStorageKey(targetKey);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      return this.outputForKey(targetKey);
    } catch (error) {
      if (error instanceof ProductCatalogError) throw error;
      throw new ProductCatalogError('Media copy failed', 'STORAGE_ERROR', undefined, error);
    }
  }

  private outputForKey(storageKey: string): MediaStorageOutput {
    const targetPath = this.resolveStorageKey(storageKey);
    const content = fs.readFileSync(targetPath);
    return {
      storageProvider: 'local',
      storageKey,
      publicUrl: this.getPublicUrl(storageKey),
      fileSize: content.byteLength,
      mimeType: detectMimeType(content),
    };
  }

  private resolveStorageKey(storageKey: string): string {
    if (storageKey.includes('\0')) {
      throw new ProductCatalogError('Path traversal detected', 'STORAGE_ERROR');
    }
    const normalizedKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = path.resolve(this.baseUploadDir, normalizedKey);
    return assertSafePath(this.baseUploadDir, targetPath);
  }
}

export function createLocalMediaStorage(options: LocalMediaStorageOptions): MediaStorage {
  return new LocalMediaStorage(options);
}

function toUint8Array(content: Uint8Array | ArrayBuffer): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function detectMimeType(content: Uint8Array): SupportedMime {
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47 &&
    content[4] === 0x0d &&
    content[5] === 0x0a &&
    content[6] === 0x1a &&
    content[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    content[0] === 0x52 &&
    content[1] === 0x49 &&
    content[2] === 0x46 &&
    content[3] === 0x46 &&
    content[8] === 0x57 &&
    content[9] === 0x45 &&
    content[10] === 0x42 &&
    content[11] === 0x50
  ) {
    return 'image/webp';
  }
  throw new ProductCatalogError('Unsupported or corrupted image file', 'MEDIA_UPLOAD_FAILED');
}

function extensionForMime(mimeType: SupportedMime): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

function sanitizePathSegment(segment: string): string {
  return sanitizeFileName(segment).replace(/\.+/g, '-');
}
