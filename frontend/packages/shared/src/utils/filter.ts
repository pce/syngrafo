/**
 * @file utils/filter.ts
 * Generic composable filter + pagination helpers.
 *
 * Design intent
 * ─────────────
 * • Use these for *client-side* list filtering (e.g. asset browser, file lists).
 * • For large datasets that require true pagination, pass offset/limit params
 *   directly to the backend IPC call instead of filtering here.
 *
 * All helpers are pure functions with no external dependencies so they are
 * trivially tree-shaken by bundlers.
 */

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Apply a single predicate to an array. Typed alias for Array.prototype.filter. */
export function applyFilter<T>(items: T[], predicate: (item: T) => boolean): T[] {
  return items.filter(predicate);
}

/**
 * Compose multiple predicates with logical AND.
 * Returns a reusable `(items: T[]) => T[]` transform.
 *
 * @example
 * const keep = composeFilters(isImage, matchesSearch('cam'));
 * const visible = keep(allAssets);
 */
export function composeFilters<T>(
  ...predicates: ReadonlyArray<(item: T) => boolean>
): (items: T[]) => T[] {
  return (items: T[]) => items.filter(item => predicates.every(p => p(item)));
}

// ---------------------------------------------------------------------------
// Common predicates (factories)
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring predicate on a string field.
 *
 * @example
 * const byName = substringFilter<Asset>(a => a.name, query);
 */
export function substringFilter<T>(
  getter: (item: T) => string,
  query: string,
): (item: T) => boolean {
  const q = query.toLowerCase().trim();
  if (!q) return () => true;
  return (item: T) => getter(item).toLowerCase().includes(q);
}

/**
 * Extension/kind allow-list predicate.
 *
 * @example
 * const imgOnly = extensionFilter<Asset>(a => a.name, new Set(['jpg','png','webp']));
 */
export function extensionFilter<T>(
  nameGetter: (item: T) => string,
  allowedExts: ReadonlySet<string>,
): (item: T) => boolean {
  return (item: T) => {
    const name = nameGetter(item);
    const ext  = (name.split('.').pop() ?? '').toLowerCase();
    return allowedExts.has(ext);
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Extract one page from a pre-filtered array.
 *
 * Use this for *virtual* client-side pagination (e.g. infinite scroll where
 * the full list is already in memory after a single IPC scan).
 *
 * For truly large datasets, push offset/limit into the backend IPC call instead.
 *
 * @param items    The complete filtered list.
 * @param page     0-based page index.
 * @param pageSize Number of items per page.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * Calculate the total number of pages for a list.
 */
export function pageCount(totalItems: number, pageSize: number): number {
  return pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0;
}
