import type { Tab } from '../store/databaseStore';

export const findToolbarQueryTab = (
  tabs: Tab[], connectionId: string, database: string | null, activeTabId: string | null
): Tab | undefined => {
  const isReusable = (tab: Tab) => tab.type === 'query'
    && tab.title === 'SQL Query'
    && !tab.savedQueryId
    && tab.connectionId === connectionId
    && (tab.database || '') === (database || '');

  const active = tabs.find(tab => tab.id === activeTabId && isReusable(tab));
  if (active) return active;

  for (let index = tabs.length - 1; index >= 0; index--) {
    if (isReusable(tabs[index])) return tabs[index];
  }
  return undefined;
};
