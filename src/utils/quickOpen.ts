import type { HistoryItem, SavedConnection, SidebarItem, Tab } from '../store/databaseStore';
import type { SavedQuery } from './savedQueries';
import { connectionIdentity } from './connectionClarity';

export type QuickOpenKind = 'connection' | 'database' | 'table' | 'tab' | 'saved' | 'history';

export interface QuickOpenItem {
  id: string;
  kind: QuickOpenKind;
  title: string;
  detail: string;
  searchText: string;
  connectionId: string;
  targetId: string;
  database?: string;
}

interface QuickOpenState {
  activeConnectionId: string | null;
  activeDatabase: string | null;
  activeDatabases?: Record<string, string | null>;
  openConnectionIds: string[];
  savedConnections: SavedConnection[];
  databases: string[];
  sidebarItems: Record<string, SidebarItem[]>;
  tabs: Tab[];
  savedQueries: SavedQuery[];
  queryHistory: HistoryItem[];
}

const kindOrder: Record<QuickOpenKind, number> = {
  table: 0, tab: 1, database: 2, connection: 3, saved: 4, history: 5,
};

export function buildQuickOpenItems(state: QuickOpenState): QuickOpenItem[] {
  const connections = new Map(state.savedConnections.map(connection => [connection.id, connection]));
  const openIds = new Set(state.openConnectionIds.filter(id => connections.has(id)));
  const activeId = state.activeConnectionId;
  const activeConnection = activeId && openIds.has(activeId) ? connections.get(activeId) : null;
  const items: QuickOpenItem[] = [];

  for (const id of state.openConnectionIds) {
    const connection = connections.get(id);
    if (!connection) continue;
    const identity = connectionIdentity(connection);
    items.push({ id: `connection:${id}`, kind: 'connection', title: connection.name,
      detail: `${identity.environment} | ${identity.target}`, searchText: `${connection.name} ${identity.target}`,
      connectionId: id, targetId: id });
  }

  if (activeId && activeConnection) {
    for (const database of [...new Set(state.databases)]) {
      items.push({ id: `database:${activeId}:${database}`, kind: 'database', title: database,
        detail: `Database | ${activeConnection.name}`, searchText: `${database} ${activeConnection.name}`,
        connectionId: activeId, targetId: database, database });
    }
    for (const item of state.sidebarItems[activeId] || []) {
      if (item.item_type !== 'Table' && item.item_type !== 'View') continue;
      items.push({ id: `table:${activeId}:${item.item_type}:${item.name}`, kind: 'table', title: item.name,
        detail: `${item.item_type} | ${activeConnection.name} / ${state.activeDatabase || activeConnection.database || ''}`,
        searchText: `${item.name} ${item.schema || ''} ${activeConnection.name}`,
        connectionId: activeId, targetId: item.name, database: state.activeDatabase || undefined });
    }
  }

  for (const tab of state.tabs) {
    if (!openIds.has(tab.connectionId)) continue;
    const connection = connections.get(tab.connectionId)!;
    const currentDatabase = tab.connectionId === activeId
      ? state.activeDatabase : state.activeDatabases?.[tab.connectionId];
    if (tab.type === 'table' && currentDatabase && tab.database && tab.database !== currentDatabase) continue;
    items.push({ id: `tab:${tab.id}`, kind: 'tab', title: tab.title,
      detail: `Open tab | ${connection.name} / ${tab.database || currentDatabase || connection.database || ''}`,
      searchText: `${tab.title} ${connection.name}`, connectionId: tab.connectionId,
      targetId: tab.id, database: tab.database });
  }

  for (const query of state.savedQueries) {
    if (!openIds.has(query.connectionId)) continue;
    const connection = connections.get(query.connectionId)!;
    items.push({ id: `saved:${query.id}`, kind: 'saved', title: query.name,
      detail: `Saved SQL | ${connection.name} / ${query.database || connection.database || ''}`,
      searchText: `${query.name} ${query.sql} ${connection.name}`, connectionId: query.connectionId,
      targetId: query.id, database: query.database });
  }

  for (const history of state.queryHistory) {
    if (!openIds.has(history.connectionId)) continue;
    const connection = connections.get(history.connectionId)!;
    const excerpt = history.sql.trim().replace(/\s+/g, ' ').slice(0, 90) || 'Recent query';
    items.push({ id: `history:${history.id}`, kind: 'history', title: excerpt,
      detail: `History | ${connection.name} / ${history.database || connection.database || ''}`,
      searchText: `${history.sql} ${connection.name}`, connectionId: history.connectionId,
      targetId: history.id, database: history.database });
  }

  return items;
}

function matchScore(item: QuickOpenItem, token: string): number | null {
  const title = item.title.toLowerCase();
  const detail = item.detail.toLowerCase();
  const searchText = item.searchText.toLowerCase();
  if (title === token) return 0;
  if (title.startsWith(token)) return 10;
  if (title.includes(token)) return 20;
  if (detail.includes(token)) return 40;
  if (searchText.includes(token)) return 50;
  let position = 0;
  for (const letter of token) {
    position = title.indexOf(letter, position);
    if (position < 0) return null;
    position += 1;
  }
  return 60;
}

export function searchQuickOpenItems(items: QuickOpenItem[], search: string, limit = 50): QuickOpenItem[] {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.map((item, index) => {
    const scores = tokens.map(token => matchScore(item, token));
    if (scores.some(score => score === null)) return null;
    return { item, index, score: scores.reduce<number>((sum, score) => sum + score!, 0) };
  }).filter((entry): entry is { item: QuickOpenItem; index: number; score: number } => entry !== null)
    .sort((a, b) => a.score - b.score || kindOrder[a.item.kind] - kindOrder[b.item.kind] || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(entry => entry.item);
}

export function resolveQuickOpenTarget(item: QuickOpenItem, state: QuickOpenState): QuickOpenItem | null {
  const current = buildQuickOpenItems(state).find(candidate => candidate.id === item.id);
  if (!current || current.kind !== item.kind || current.connectionId !== item.connectionId) return null;
  if ((item.kind === 'table' || item.kind === 'database') && current.database !== item.database) return null;
  return current;
}
