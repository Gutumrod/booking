import { describe, expect, it } from 'vitest';
import { slugify, generateUniqueSlug } from '../../core/index.js';

describe('slugify', () => {
  it('lowercases English text', () => {
    expect(slugify('Full Face Helmet')).toBe('full-face-helmet');
  });

  it('replaces spaces with dashes', () => {
    expect(slugify('A B C')).toBe('a-b-c');
  });

  it('collapses consecutive non-alphanumeric runs into single dash', () => {
    expect(slugify('A---B   C')).toBe('a-b-c');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('---hello world---')).toBe('hello-world');
  });

  it('returns "item" for empty string', () => {
    expect(slugify('')).toBe('item');
  });

  it('returns "item" for whitespace-only string', () => {
    expect(slugify('   ')).toBe('item');
  });

  it('returns "item" for punctuation-only string', () => {
    expect(slugify('!!!@@@###')).toBe('item');
  });

  it('preserves Thai characters (NFKC)', () => {
    expect(slugify('หมวกกันน็อค ADV')).toBe('หมวกกันน็อค-adv');
  });

  it('preserves Thai characters with no spaces', () => {
    expect(slugify('หมวกกันน็อค')).toBe('หมวกกันน็อค');
  });

  it('handles mixed Thai and English', () => {
    expect(slugify('หมวกกันน็อค Full Face')).toBe('หมวกกันน็อค-full-face');
  });

  it('handles numbers', () => {
    expect(slugify('Helmet 2024 Model')).toBe('helmet-2024-model');
  });

  it('handles special characters', () => {
    expect(slugify('A+B*C&D')).toBe('a-b-c-d');
  });

  it('handles single character', () => {
    expect(slugify('A')).toBe('a');
  });

  it('preserves unicode letters and marks', () => {
    expect(slugify('café résumé')).toBe('café-résumé');
  });
});

describe('generateUniqueSlug', () => {
  it('returns the base slug when no collision', async () => {
    const exists = async (_slug: string): Promise<boolean> => false;
    const result = await generateUniqueSlug('Full Face Helmet', exists);
    expect(result).toBe('full-face-helmet');
  });

  it('appends -1 on first collision', async () => {
    const taken = new Set(['full-face-helmet']);
    const exists = async (slug: string): Promise<boolean> => taken.has(slug);
    const result = await generateUniqueSlug('Full Face Helmet', exists);
    expect(result).toBe('full-face-helmet-1');
  });

  it('appends -2 on second collision', async () => {
    const taken = new Set(['full-face-helmet', 'full-face-helmet-1']);
    const exists = async (slug: string): Promise<boolean> => taken.has(slug);
    const result = await generateUniqueSlug('Full Face Helmet', exists);
    expect(result).toBe('full-face-helmet-2');
  });

  it('appends -3 after three collisions', async () => {
    const taken = new Set(['item', 'item-1', 'item-2']);
    const exists = async (slug: string): Promise<boolean> => taken.has(slug);
    const result = await generateUniqueSlug('', exists);
    expect(result).toBe('item-3');
  });

  it('handles Thai base slug collisions', async () => {
    const taken = new Set(['หมวกกันน็อค-adv']);
    const exists = async (slug: string): Promise<boolean> => taken.has(slug);
    const result = await generateUniqueSlug('หมวกกันน็อค ADV', exists);
    expect(result).toBe('หมวกกันน็อค-adv-1');
  });

  it('returns the slugified base when raw input has special chars', async () => {
    const exists = async (): Promise<boolean> => false;
    const result = await generateUniqueSlug('---Hello World!!!', exists);
    expect(result).toBe('hello-world');
  });
});