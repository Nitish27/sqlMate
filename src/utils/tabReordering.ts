export type TabDropPosition = 'before' | 'after';

export interface TabDragBounds {
  id: string;
  left: number;
  width: number;
}

export const getTabDragPreview = (
  tabs: TabDragBounds[],
  sourceId: string,
  draggedCenter: number,
  gap: number,
): { order: string[]; offsets: Record<string, number> } => {
  const sourceIndex = tabs.findIndex(tab => tab.id === sourceId);
  if (sourceIndex < 0) {
    return { order: tabs.map(tab => tab.id), offsets: {} };
  }

  const remaining = tabs.filter(tab => tab.id !== sourceId);
  let insertionIndex = remaining.length;
  for (let index = 0; index < remaining.length; index++) {
    if (draggedCenter <= remaining[index].left + remaining[index].width / 2) {
      insertionIndex = index;
      break;
    }
  }

  const order = remaining.map(tab => tab.id);
  order.splice(insertionIndex, 0, sourceId);
  if (insertionIndex === sourceIndex) {
    return { order, offsets: Object.fromEntries(order.map(id => [id, 0])) };
  }
  const widths = new Map(tabs.map(tab => [tab.id, tab.width]));
  const originalLefts = new Map(tabs.map(tab => [tab.id, tab.left]));
  const offsets: Record<string, number> = {};
  let nextLeft = tabs[0].left;
  for (const id of order) {
    offsets[id] = nextLeft - originalLefts.get(id)!;
    nextLeft += widths.get(id)! + gap;
  }

  return { order, offsets };
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
