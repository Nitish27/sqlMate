export interface TablePageIdentity {
  connectionId: string;
  database: string;
  tableName: string;
  filters: unknown[];
  sortColumn: string | null;
  sortDirection: string;
  limit: number;
  offset: number;
  generation: number;
}

export interface CachedTablePage {
  columns: string[];
  rows: unknown[][];
  time: number;
  hasMore?: boolean;
}

export function integerKeysetCursor(
  page: CachedTablePage | undefined,
  primaryKeys: string[],
  columnTypes: Record<string, string>,
  sortColumn: string | null,
): number | undefined {
  if (!page || sortColumn || primaryKeys.length !== 1) return undefined;
  const key = primaryKeys[0];
  if (!/^(tinyint|smallint|mediumint|int|integer|bigint|serial)/.test((columnTypes[key] || '').toLowerCase())) {
    return undefined;
  }
  const index = page.columns.indexOf(key);
  const value = index >= 0 ? page.rows[page.rows.length - 1]?.[index] : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export function tablePageKeys(identity: TablePageIdentity) {
  const count = JSON.stringify([
    identity.connectionId, identity.database, identity.tableName,
    identity.filters, identity.generation,
  ]);
  return {
    count,
    page: JSON.stringify([
      count, identity.sortColumn, identity.sortDirection,
      identity.limit, identity.offset,
    ]),
  };
}

export function createTablePageCache(maxPagesPerTab = 3, maxPages = 36, freshForMs = 30_000) {
  const pages = new Map<string, CacheEntry<CachedTablePage>>();
  const counts = new Map<string, CacheEntry<number>>();
  const prefix = (tabId: string) => `${tabId}\0`;
  const entryKey = (tabId: string, key: string) => prefix(tabId) + key;

  function get<T>(entries: Map<string, CacheEntry<T>>, tabId: string, key: string, now: number) {
    const id = entryKey(tabId, key);
    const entry = entries.get(id);
    if (!entry) return undefined;
    entries.delete(id);
    entries.set(id, entry);
    return { value: entry.value, fresh: now - entry.fetchedAt < freshForMs };
  }

  function put<T>(entries: Map<string, CacheEntry<T>>, tabId: string, key: string, value: T, now: number, perTabLimit: number, globalLimit: number) {
    const id = entryKey(tabId, key);
    entries.delete(id);
    entries.set(id, { value, fetchedAt: now });
    const ownKeys = [...entries.keys()].filter(candidate => candidate.startsWith(prefix(tabId)));
    while (ownKeys.length > perTabLimit) entries.delete(ownKeys.shift()!);
    while (entries.size > globalLimit) entries.delete(entries.keys().next().value!);
  }

  return {
    getPage: (tabId: string, key: string, now = Date.now()) => get(pages, tabId, key, now),
    putPage: (tabId: string, key: string, value: CachedTablePage, now = Date.now()) =>
      put(pages, tabId, key, value, now, maxPagesPerTab, maxPages),
    getCount: (tabId: string, key: string, now = Date.now()) => get(counts, tabId, key, now),
    putCount: (tabId: string, key: string, value: number, now = Date.now()) =>
      put(counts, tabId, key, value, now, maxPagesPerTab, maxPages),
    dropTab: (tabId: string) => {
      for (const entries of [pages, counts]) {
        for (const key of entries.keys()) {
          if (key.startsWith(prefix(tabId))) entries.delete(key);
        }
      }
    },
  };
}

// Session-only: result rows can contain secrets and must never enter workspace recovery.
export const tablePageCache = createTablePageCache();
