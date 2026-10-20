export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string;
  targetFingerprint: string;
  database?: string;
  updatedAt: number;
}

const isShortString = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit;

export function parseSavedQueries(value: unknown): SavedQuery[] {
  if (value == null) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved query library');
  const library = value as Record<string, unknown>;
  if (library.version !== 1 || !Array.isArray(library.queries)) throw new Error('Unsupported saved query library format');
  const seen = new Set<string>();
  return library.queries.map((item): SavedQuery => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid saved query');
    const query = item as Record<string, unknown>;
    if (!isShortString(query.id, 128) || seen.has(query.id)
      || !isShortString(query.connectionId, 128)
      || !isShortString(query.targetFingerprint, 4096)
      || !isShortString(query.name, 120) || !query.name.trim()
      || !isShortString(query.sql, 1_000_000)
      || (query.database !== undefined && !isShortString(query.database, 2048))
      || typeof query.updatedAt !== 'number' || !Number.isFinite(query.updatedAt)) throw new Error('Invalid saved query');
    seen.add(query.id);
    return {
      id: query.id,
      name: query.name.trim(),
      sql: query.sql,
      connectionId: query.connectionId,
      targetFingerprint: query.targetFingerprint,
      ...(query.database === undefined ? {} : { database: query.database }),
      updatedAt: query.updatedAt,
    };
  });
}

export function upsertSavedQuery(queries: SavedQuery[], item: SavedQuery): SavedQuery[] {
  const index = queries.findIndex(query => query.id === item.id);
  if (index === -1) return [item, ...queries];
  return queries.map(query => query.id === item.id
    ? { ...query, name: item.name.trim(), sql: item.sql, updatedAt: item.updatedAt }
    : query);
}

export function renameSavedQuery(queries: SavedQuery[], id: string, name: string): SavedQuery[] {
  return queries.map(query => query.id === id ? { ...query, name: name.trim(), updatedAt: Date.now() } : query);
}

export function removeSavedQuery(queries: SavedQuery[], id: string): SavedQuery[] {
  return queries.filter(query => query.id !== id);
}

export function filterSavedQueries(queries: SavedQuery[], connectionId: string, search: string): SavedQuery[] {
  const term = search.trim().toLowerCase();
  return queries.filter(query => query.connectionId === connectionId
    && (!term || query.name.toLowerCase().includes(term) || query.sql.toLowerCase().includes(term)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
