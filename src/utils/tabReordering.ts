export type TabDropPosition = 'before' | 'after';

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
