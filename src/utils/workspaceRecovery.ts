import type { Tab } from '../store/databaseStore';

export type RecoveryTab = Pick<Tab, 'id' | 'type' | 'title' | 'connectionId' | 'database' | 'tableName' | 'query'>;

export interface RecoverySnapshot {
  version: 1;
  tabs: RecoveryTab[];
  activeDatabases: Record<string, string | null>;
}

const emptySnapshot = (): RecoverySnapshot => ({
  version: 1, tabs: [], activeDatabases: {},
});

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

const optionalString = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;

function tabDescriptor(value: unknown): RecoveryTab | null {
  const tab = record(value);
  if (!tab || (tab.type !== 'table' && tab.type !== 'query')) return null;
  const id = optionalString(tab.id, 128);
  const connectionId = optionalString(tab.connectionId, 128);
  if (!id || !connectionId) return null;
  const tableName = optionalString(tab.tableName, 2048);
  if (tab.type === 'table' && !tableName) return null;
  return {
    id,
    connectionId,
    type: tab.type,
    title: optionalString(tab.title, 2048) || tableName || 'SQL Query',
    ...(tableName ? { tableName } : {}),
    ...(optionalString(tab.database, 2048) !== undefined ? { database: tab.database as string } : {}),
    ...(tab.type === 'query' ? { query: typeof tab.query === 'string' ? tab.query : '' } : {}),
  };
}

export function captureWorkspace(state: Pick<RecoverySnapshot, 'tabs' | 'activeDatabases'>): RecoverySnapshot {
  const tabs = state.tabs.map(tabDescriptor).filter((tab): tab is RecoveryTab => tab !== null);
  return { version: 1, tabs, activeDatabases: { ...state.activeDatabases } };
}

export function restoreWorkspace(value: unknown, connectionIds: string[]): RecoverySnapshot {
  const snapshot = record(value);
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.tabs)) return emptySnapshot();
  const known = new Set(connectionIds);
  const seen = new Set<string>();
  const tabs = snapshot.tabs.map(tabDescriptor).filter((tab): tab is RecoveryTab => {
    if (!tab || !known.has(tab.connectionId) || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  const storedDatabases = record(snapshot.activeDatabases) || {};
  const activeDatabases: RecoverySnapshot['activeDatabases'] = {};
  for (const connectionId of connectionIds) {
    const database = optionalString(storedDatabases[connectionId], 2048);
    if (database !== undefined) activeDatabases[connectionId] = database;
  }
  return { version: 1, tabs, activeDatabases };
}
