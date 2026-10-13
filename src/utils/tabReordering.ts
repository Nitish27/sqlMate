export type TabDropPosition = 'before' | 'after';

interface TabDropBounds {
  id: string;
  left: number;
  right: number;
}

export const getTabDropTarget = (
  tabs: TabDropBounds[],
  clientX: number
): { tabId: string; position: TabDropPosition } | null => {
  for (const tab of tabs) {
    const position = clientX < (tab.left + tab.right) / 2 ? 'before' : 'after';
    if (clientX <= tab.right) return { tabId: tab.id, position };
  }

  return tabs.length ? { tabId: tabs[tabs.length - 1].id, position: 'after' } : null;
};

interface ReorderableTab {
  id: string;
  connectionId: string;
}

export const reorderTabs = <T extends ReorderableTab>(
  tabs: T[],
  sourceId: string,
  targetId: string,
  position: TabDropPosition
): T[] => {
  if (sourceId === targetId) return tabs;

  const sourceTab = tabs.find(tab => tab.id === sourceId);
  const targetTab = tabs.find(tab => tab.id === targetId);
  if (!sourceTab || !targetTab || sourceTab.connectionId !== targetTab.connectionId) {
    return tabs;
  }

  const reorderedTabs = [...tabs];
  const sourceIndex = reorderedTabs.findIndex(tab => tab.id === sourceId);
  const [movedTab] = reorderedTabs.splice(sourceIndex, 1);
  const targetIndex = reorderedTabs.findIndex(tab => tab.id === targetId);
  const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex;

  reorderedTabs.splice(insertionIndex, 0, movedTab);
  return reorderedTabs;
};
