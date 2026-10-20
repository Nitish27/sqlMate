import { SidebarHistory } from './SidebarHistory';
import { useDatabaseStore } from '../store/databaseStore';
import { ConnectionRail } from './ConnectionRail';
import { SidebarTree } from './SidebarTree';
import { SidebarSavedQueries } from './SidebarSavedQueries';
import { Database, Bookmark, History } from 'lucide-react';

export const Sidebar = () => {
  const { 
    sidebarViewMode,
    activePanels,
    setSidebarViewMode,
  } = useDatabaseStore();

  if (!activePanels.sidebar) return null;

  return (
    <div className="flex w-full h-full select-none overflow-hidden bg-sidebar">
      {/* Far left: Connection Rail (Icon strip) */}
      <ConnectionRail />

      {/* Main Sidebar Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 border-l border-border">
        <div role="group" className="flex gap-1 border-b border-border bg-sidebar p-2" aria-label="Sidebar views">
          {([
            ['items', Database, 'Items'],
            ['queries', Bookmark, 'Saved'],
            ['history', History, 'History'],
          ] as const).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSidebarViewMode(mode)}
              aria-pressed={sidebarViewMode === mode}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-1 py-1.5 text-[11px] transition-colors ${sidebarViewMode === mode ? 'bg-surface text-accent' : 'text-text-muted hover:bg-surface hover:text-text-primary'}`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {/* Content Area: Tree, History, or Queries */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {sidebarViewMode === 'history' ? (
            <SidebarHistory />
          ) : sidebarViewMode === 'queries' ? (
            <SidebarSavedQueries />
          ) : (
            <SidebarTree />
          )}
        </div>
      </div>
    </div>
  );
};
