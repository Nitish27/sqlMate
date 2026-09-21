import { useState, type DragEvent } from 'react';
import { X, Layout, Terminal, Settings } from 'lucide-react';
import { useDatabaseStore, TabType } from '../store/databaseStore';
import type { TabDropPosition } from '../utils/tabReordering';

const TabIcon = ({ type, size = 12 }: { type: TabType; size?: number }) => {
  switch (type) {
    case 'table': return <Layout size={size} />;
    case 'query': return <Terminal size={size} />;
    case 'structure': return <Settings size={size} />;
    default: return <Layout size={size} />;
  }
};

export const TabManager = () => {
  const { tabs, activeTabId, setActiveTabId, closeTab, reorderTab, activeConnectionId } = useDatabaseStore();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null);

  const currentTabs = tabs.filter(t => t.connectionId === activeConnectionId);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tabId);
    setDraggedTabId(tabId);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    if (!draggedTabId || draggedTabId === tabId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    setDropTarget({ tabId, position });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, tabId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedTabId;
    if (sourceId && dropTarget?.tabId === tabId) {
      reorderTab(sourceId, tabId, dropTarget.position);
    }
    setDraggedTabId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setDropTarget(null);
  };

  if (currentTabs.length === 0) return null;

  return (
    <div className="h-9 bg-[#2C2C2C] flex items-end px-2 gap-px border-b border-[#1e1e1e] overflow-x-auto no-scrollbar">
      {currentTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(event) => handleDragStart(event, tab.id)}
            onDragOver={(event) => handleDragOver(event, tab.id)}
            onDrop={(event) => handleDrop(event, tab.id)}
            onDragEnd={handleDragEnd}
            onClick={() => setActiveTabId(tab.id)}
            aria-grabbed={draggedTabId === tab.id}
            title="Drag to reorder tab"
            className={`
              group flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] h-7 text-[11px] 
              rounded-t-md transition-all cursor-grab active:cursor-grabbing select-none relative
              ${draggedTabId === tab.id ? 'opacity-50' : ''}
              ${isActive ? 'bg-[#1e1e1e] text-text-primary' : 'bg-[#333333] text-text-muted hover:bg-[#383838]'}
            `}
          >
            {dropTarget?.tabId === tab.id && (
              <div className={`absolute top-0 bottom-0 w-0.5 bg-accent z-20 ${
                dropTarget.position === 'before' ? '-left-px' : '-right-px'
              }`} />
            )}
            <span className={isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}>
              <TabIcon type={tab.type} />
            </span>
            <span className="flex-1 truncate font-medium">{tab.title}</span>
            <button
              draggable={false}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`
                p-0.5 rounded-sm hover:bg-[#444] transition-colors
                ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
              `}
            >
              <X size={10} />
            </button>
            {/* Active indicator line */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent rounded-t-full" />
            )}
          </div>
        );
      })}
    </div>
  );
};
