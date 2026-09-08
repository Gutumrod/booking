export function slugify(name: string): string {
  const normalized = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'item';
}

export async function generateUniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  if (!(await exists(root))) {
    return root;
  }

  let suffix = 1;
  while (await exists(`${root}-${suffix}`)) {
    suffix += 1;
  }

  return `${root}-${suffix}`;
}
