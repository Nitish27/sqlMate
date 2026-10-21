import type { TableStructure } from '../store/databaseStore';

export function createTableStructureCache<T>(maxEntries = 128, ttlMs = 60_000) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  let generation = 0;
  const keyFor = (connectionId: string, database: string, tableName: string) =>
    JSON.stringify([connectionId, database, tableName]);

  return {
    async get(connectionId: string, database: string, tableName: string, load: () => Promise<T>): Promise<T> {
      const key = keyFor(connectionId, database, tableName);
      const cached = entries.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.value;
      }
      const existing = pending.get(key);
      if (existing) return existing;
      const startedAtGeneration = generation;
      const request = load().then(value => {
        if (generation === startedAtGeneration) {
          entries.delete(key);
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
    invalidate(connectionId?: string) {
      generation += 1;
      if (!connectionId) {
        entries.clear();
        pending.clear();
        return;
      }
      for (const key of entries.keys()) {
        if (JSON.parse(key)[0] === connectionId) entries.delete(key);
      }
      for (const key of pending.keys()) {
        if (JSON.parse(key)[0] === connectionId) pending.delete(key);
      }
    },
  };
}

export const tableStructureCache = createTableStructureCache<TableStructure>();
