import { useRef, useState, type PointerEvent } from 'react';
import { X, Layout, Terminal, Settings } from 'lucide-react';
import { useDatabaseStore, TabType } from '../store/databaseStore';
import { getTabDropTarget, type TabDropPosition } from '../utils/tabReordering';
import { useRecoveryStore } from '../store/recoveryStore';
import { rowDraftContext } from '../utils/rowDrafts';

const TabIcon = ({ type, size = 12 }: { type: TabType; size?: number }) => {
  switch (type) {
    case 'table': return <Layout size={size} />;
    case 'query': return <Terminal size={size} />;
    case 'structure': return <Settings size={size} />;
    default: return <Layout size={size} />;
  }
};

export const TabManager = () => {
  const { tabs, activeTabId, activeDatabase, savedConnections, setActiveTabId, closeTab, reorderTab, activeConnectionId } = useDatabaseStore();
  const drafts = useRecoveryStore(state => state.drafts);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ tabId: string; position: TabDropPosition } | null>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ tabId: string; pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const currentTabs = tabs.filter(t => t.connectionId === activeConnectionId);

  const getDropTarget = (clientX: number, clientY: number) => {
    const strip = tabStripRef.current;
    if (!strip) return null;
    const stripBounds = strip.getBoundingClientRect();
    if (clientY < stripBounds.top || clientY > stripBounds.bottom) return null;

    const bounds = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]')).map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.tabId!, left: rect.left, right: rect.right };
    });
    return getTabDropTarget(bounds, clientX);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    suppressClickRef.current = false;
    dragRef.current = {
      tabId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      drag.dragging = true;
      setDraggedTabId(drag.tabId);
    }
    event.preventDefault();
    const target = getDropTarget(event.clientX, event.clientY);
    setDropTarget(previous => previous?.tabId === target?.tabId && previous?.position === target?.position
      ? previous : target);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      const target = getDropTarget(event.clientX, event.clientY);
      if (target) reorderTab(drag.tabId, target.tabId, target.position);
      suppressClickRef.current = true;
      event.preventDefault();
    }
    dragRef.current = null;
    setDraggedTabId(null);
    setDropTarget(null);
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setDraggedTabId(null);
    setDropTarget(null);
  };

  if (currentTabs.length === 0) return null;

  return (
    <div ref={tabStripRef} className="h-9 bg-[#2C2C2C] flex items-end px-2 gap-px border-b border-[#1e1e1e] overflow-x-auto no-scrollbar">
      {currentTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onPointerDown={(event) => handlePointerDown(event, tab.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              setActiveTabId(tab.id);
            }}
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
            {tab.type === 'table' && drafts.some(draft => draft.context === rowDraftContext(
              tab.connectionId,
              tab.database || activeDatabase || savedConnections.find(connection => connection.id === tab.connectionId)?.database || '',
              tab.tableName || '',
            )) && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" title="Pending row edits" aria-label="Pending row edits" />
            )}
            <button
              onPointerDown={(event) => event.stopPropagation()}
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
