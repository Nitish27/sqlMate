import { SidebarHistory } from './SidebarHistory';
import { useDatabaseStore } from '../store/databaseStore';
import { ConnectionRail } from './ConnectionRail';
import { QuickNavBar } from './QuickNavBar';
import { SidebarTree } from './SidebarTree';

export const Sidebar = () => {
  const { 
    sidebarViewMode,
    activePanels
  } = useDatabaseStore();

  if (!activePanels.sidebar) return null;

  return (
    <div className="flex w-full h-full select-none overflow-hidden bg-sidebar">
      {/* Far left: Connection Rail (Icon strip) */}
      <ConnectionRail />

      {/* Main Sidebar Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 border-l border-white/5">
        {/* Top: Quick Navigation Bar */}
        <QuickNavBar />

        {/* Content Area: Tree, History, or Queries */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {sidebarViewMode === 'history' ? (
            <SidebarHistory />
          ) : sidebarViewMode === 'queries' ? (
            <div className="flex-1 flex items-center justify-center p-4 text-center text-text-muted text-[11px] italic">
              No queries saved
            </div>
          ) : (
            <SidebarTree />
          )}
        </div>
      </div>
    </div>
  );
};
