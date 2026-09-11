// Query-result adapters for consumer data accessors (Codex R2-5 / NEW-F8).
//
// A query/network error must throw so the booking page reaches LOAD_ERROR; only
// a successful query with no row / no rows may become SHOP_NOT_FOUND,
// NO_SERVICES or NO_STAFF.
//
// Pure and framework-free for unit testing from `tests/`.

export interface QueryResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

/** Single-row read: throws on error, null only for a genuine no-row result. */
export function rowOrNull<T>(result: QueryResult<T>, what: string): T | null {
  if (result.error) throw new Error(result.error.message || `Failed to fetch ${what}`);
  return result.data ?? null;
}

/** Multi-row read: throws on error, [] only for a genuine empty result. */
export function rowsOrThrow<T>(result: QueryResult<T[]>, what: string): T[] {
  if (result.error) throw new Error(result.error.message || `Failed to fetch ${what}`);
  return result.data ?? [];
}
