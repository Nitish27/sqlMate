import type { Tab } from '../store/databaseStore';
import type { SavedQuery } from './savedQueries';

export function isUnsavedQuery(tab: Tab, savedQueries: SavedQuery[]): boolean {
  if (tab.type !== 'query') return false;
  const saved = savedQueries.find(item => item.id === tab.savedQueryId && item.connectionId === tab.connectionId);
  return saved ? saved.sql !== (tab.query ?? '') : Boolean(tab.query?.trim());
}
