import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, Layout, Terminal, Settings } from 'lucide-react';
import { useDatabaseStore, TabType } from '../store/databaseStore';
import { getTabDragPreview, type TabDragBounds } from '../utils/tabReordering';
import { useRecoveryStore } from '../store/recoveryStore';
import { rowDraftContext } from '../utils/rowDrafts';

interface DragSession {
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  grabOffset: number;
  width: number;
  top: number;
  gap: number;
  bounds: TabDragBounds[];
  dragging: boolean;
}

interface DragPresentation {
  tabId: string;
  clientX: number;
  clientY: number;
  grabOffset: number;
  width: number;
  top: number;
  startY: number;
  preview: ReturnType<typeof getTabDragPreview> | null;
}

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
  const [dragPresentation, setDragPresentation] = useState<DragPresentation | null>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const currentTabs = tabs.filter(t => t.connectionId === activeConnectionId);

  const updateDragPresentation = (drag: DragSession) => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const rect = strip.getBoundingClientRect();
    const inside = drag.clientY >= rect.top - 12 && drag.clientY <= rect.bottom + 12;
    const center = drag.clientX - rect.left + strip.scrollLeft - drag.grabOffset + drag.width / 2;
    setDragPresentation({
      tabId: drag.tabId,
      clientX: drag.clientX,
      clientY: drag.clientY,
      grabOffset: drag.grabOffset,
      width: drag.width,
      top: drag.top,
      startY: drag.startY,
      preview: inside ? getTabDragPreview(drag.bounds, drag.tabId, center, drag.gap) : null,
    });
  };

  const stopAutoScroll = () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  };

  const autoScroll = () => {
    const strip = tabStripRef.current;
    const drag = dragRef.current;
    if (!strip || !drag?.dragging) {
      scrollFrameRef.current = null;
      return;
    }

    const rect = strip.getBoundingClientRect();
    if (drag.clientY >= rect.top - 12 && drag.clientY <= rect.bottom + 12) {
      const edge = 36;
      const leftDistance = drag.clientX - rect.left;
      const rightDistance = rect.right - drag.clientX;
      const speed = leftDistance < edge
        ? -Math.ceil((edge - leftDistance) / 3)
        : rightDistance < edge ? Math.ceil((edge - rightDistance) / 3) : 0;
      if (speed) {
        const previous = strip.scrollLeft;
        strip.scrollLeft += Math.max(-14, Math.min(14, speed));
        if (strip.scrollLeft !== previous) updateDragPresentation(drag);
      }
    }
    scrollFrameRef.current = requestAnimationFrame(autoScroll);
  };

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, tabId: string) => {
    suppressClickRef.current = false;
    if (dragRef.current || event.button !== 0 || currentTabs.length < 2 || (event.target as HTMLElement).closest('button')) return;
    const strip = tabStripRef.current;
    if (!strip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const bounds = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]')).map(element => ({
      id: element.dataset.tabId!, left: element.offsetLeft, width: element.offsetWidth,
    }));
    dragRef.current = {
      tabId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, grabOffset: event.clientX - rect.left,
      width: rect.width, top: rect.top, gap: parseFloat(getComputedStyle(strip).columnGap) || 0,
      bounds, dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      drag.dragging = true;
      scrollFrameRef.current = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    updateDragPresentation(drag);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    stopAutoScroll();
    if (drag.dragging) {
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      const strip = tabStripRef.current;
      const rect = strip?.getBoundingClientRect();
      if (strip && rect && event.clientY >= rect.top - 12 && event.clientY <= rect.bottom + 12) {
        const center = event.clientX - rect.left + strip.scrollLeft - drag.grabOffset + drag.width / 2;
        const { order } = getTabDragPreview(drag.bounds, drag.tabId, center, drag.gap);
        const index = order.indexOf(drag.tabId);
        const targetId = index > 0 ? order[index - 1] : order[1];
        if (targetId) reorderTab(drag.tabId, targetId, index > 0 ? 'after' : 'before');
      }
      suppressClickRef.current = true;
      event.preventDefault();
    }
    dragRef.current = null;
    setDragPresentation(null);
  };

  const handlePointerCancel = () => {
    stopAutoScroll();
    dragRef.current = null;
    setDragPresentation(null);
  };

  useEffect(() => {
    stopAutoScroll();
    dragRef.current = null;
    setDragPresentation(null);
  }, [activeConnectionId]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tabId: string, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const neighbor = currentTabs[index + direction];
      if (neighbor) reorderTab(tabId, neighbor.id, direction < 0 ? 'before' : 'after');
      event.preventDefault();
    } else if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const nextIndex = (index + direction + currentTabs.length) % currentTabs.length;
      setActiveTabId(currentTabs[nextIndex].id);
      tabStripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]')[nextIndex]?.focus();
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === ' ') {
      setActiveTabId(tabId);
      event.preventDefault();
    }
  };

  if (currentTabs.length === 0) return null;

  const floatingTab = currentTabs.find(tab => tab.id === dragPresentation?.tabId);

  return (
    <>
    <div
      ref={tabStripRef}
      role="tablist"
      aria-label="Open tabs"
      onPointerDownCapture={() => { suppressClickRef.current = false; }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      className="relative h-9 bg-[#2C2C2C] flex items-end px-2 gap-px border-b border-[#1e1e1e] overflow-x-auto no-scrollbar"
    >
      {currentTabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isDragged = dragPresentation?.tabId === tab.id;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onPointerDown={(event) => handlePointerDown(event, tab.id)}
            onClick={() => setActiveTabId(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id, index)}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            aria-grabbed={isDragged}
            title={`${tab.title} - drag to reorder, or press Alt+Shift+Arrow`}
            style={{ transform: dragPresentation?.preview
              ? `translateX(${dragPresentation.preview.offsets[tab.id] ?? 0}px)` : undefined }}
            className={`
              group flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] h-7 text-[11px] 
              rounded-t-md cursor-grab active:cursor-grabbing select-none relative touch-none sql-tab-focus
              ${dragPresentation ? 'sql-tab-reordering' : 'transition-colors'}
              ${isDragged ? 'sql-tab-drag-placeholder' : ''}
              ${isActive ? 'bg-[#1e1e1e] text-text-primary' : 'bg-[#333333] text-text-muted hover:bg-[#383838]'}
            `}
          >
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
              aria-label={`Close ${tab.title}`}
              tabIndex={isActive ? 0 : -1}
              className={`
                p-0.5 rounded-sm hover:bg-[#444] focus:opacity-100 transition-colors
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
    {dragPresentation && floatingTab && createPortal(
      <div
        aria-hidden="true"
        className={`sql-tab-drag-ghost ${dragPresentation.preview ? '' : 'sql-tab-drag-ghost-invalid'}`}
        style={{
          left: dragPresentation.clientX - dragPresentation.grabOffset,
          top: dragPresentation.top + Math.max(-8, Math.min(8, dragPresentation.clientY - dragPresentation.startY)),
          width: dragPresentation.width,
        }}
      >
        <TabIcon type={floatingTab.type} />
        <span className="truncate font-medium">{floatingTab.title}</span>
      </div>,
      document.body,
    )}
    </>
  );
};
