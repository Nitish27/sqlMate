import { Sidebar } from "./components/Sidebar";
import { Database } from "lucide-react";
import { useDatabaseStore } from "./store/databaseStore";
import { Toolbar } from "./components/Toolbar";
import { TabManager } from "./components/TabManager";
import { TabContentTable } from "./components/TabContentTable";
import { TabContentQuery } from "./components/TabContentQuery";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ConnectionModal } from "./components/ConnectionModal";
import { DatabaseSelectorModal } from "./components/DatabaseSelectorModal";
import { ObjectDetails } from "./components/ObjectDetails";
import { useEffect } from "react";
import { Group, Panel, Separator } from 'react-resizable-panels';

function App() {
  const activeConnectionId = useDatabaseStore((state) => state.activeConnectionId);
  const tabs = useDatabaseStore((state) => state.tabs);
  const activeTabId = useDatabaseStore((state) => state.activeTabId);
  const triggerRefresh = useDatabaseStore((state) => state.triggerRefresh);
  const showConnectionModal = useDatabaseStore((state) => state.showConnectionModal);
  const setShowConnectionModal = useDatabaseStore((state) => state.setShowConnectionModal);
  const setShowDatabaseSelector = useDatabaseStore((state) => state.setShowDatabaseSelector);
  const activePanels = useDatabaseStore((state) => state.activePanels);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K or Ctrl+K for Database Selector
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (activeConnectionId) {
          setShowDatabaseSelector(true);
        }
      }

      // ⌘E or Ctrl+E for SQL Query Editor
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        if (activeConnectionId) {
          useDatabaseStore.getState().openTab({
            type: 'query',
            title: 'SQL Query',
            connectionId: activeConnectionId,
            query: ''
          });
        }
      }

      // ⌘R or Ctrl+R for Refresh
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        useDatabaseStore.getState().triggerRefresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnectionId, setShowDatabaseSelector]);
  
  const sidebarVisible = activePanels.sidebar;
  const rightVisible = activePanels.right;

  return (
    <div className="flex h-screen w-full bg-[#1e1e1e] text-[#cccccc] overflow-hidden font-sans">
      {!activeConnectionId ? (
        <WelcomeScreen />
      ) : (
        <Group 
          orientation="horizontal" 
          id="main-layout" 
          autoSaveId="sqlmate-main-layout-v1"
          className="flex-1 h-full w-full bg-[#1e1e1e] text-[#cccccc] overflow-hidden font-sans"
        >
          {/* Left Sidebar - order=1 */}
          {sidebarVisible && (
            <Panel 
              defaultSize={20} 
              minSize={15} 
              id="sidebar-panel" 
              order={1} 
              className="h-full flex flex-col"
            >
              <Sidebar />
            </Panel>
          )}
          
          {sidebarVisible && (
            <Separator
              id="sidebar-resizer"
              className="relative flex items-center justify-center transition-colors group w-[2px] mx-[-1px] cursor-col-resize z-50 hover:bg-accent/40 hover:w-[4px] hover:mx-[-2px] active:bg-accent active:w-[4px] active:mx-[-2px] bg-[#1e1e1e]"
            >
              <div className="absolute bg-[#3C3C3C] group-hover:bg-accent transition-colors w-[1px] h-full" />
            </Separator>
          )}
          
          {/* Main Workspace - order=2 */}
          <Panel 
            defaultSize={60} 
            minSize={30} 
            id="workspace-panel" 
            order={2}
            className="flex flex-col min-w-0 overflow-hidden relative"
          >
            <div className="flex flex-col h-full w-full overflow-hidden">
              <Toolbar 
                onRefresh={triggerRefresh}
                onCommit={() => console.log('Commit active tab')}
                onDiscard={() => console.log('Discard active tab')}
                pendingChangesCount={0} 
              />
              
              <TabManager />

              <div className="flex-1 overflow-hidden relative">
                <div className="h-full w-full flex flex-col overflow-hidden">
                  {tabs.length > 0 ? (
                    (() => {
                      const activeTab = tabs.find(t => t.id === activeTabId);
                      if (!activeTab) return null;

                      return (
                        <div className="h-full flex flex-col flex-1 min-h-0 overflow-hidden">
                          {activeTab.type === 'table' && (
                            <TabContentTable 
                              key={activeTab.id}
                              id={activeTab.id}
                              tableName={activeTab.tableName || ''} 
                              connectionId={activeTab.connectionId} 
                            />
                          )}
                          {activeTab.type === 'query' && (
                            <TabContentQuery 
                              key={activeTab.id}
                              id={activeTab.id}
                              initialQuery={activeTab.query}
                              connectionId={activeTab.connectionId}
                            />
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted select-none gap-4">
                      <div className="flex flex-col items-center gap-2 opacity-50">
                        <Database size={48} strokeWidth={1} />
                        <p className="text-sm">No tab open. Select a table from the sidebar.</p>
                      </div>
                      <div className="text-[11px] bg-[#2C2C2C] px-3 py-1.5 rounded-md border border-[#3C3C3C]">
                        Press <kbd className="bg-[#444] px-1 rounded mx-0.5">⌘</kbd> + <kbd className="bg-[#444] px-1 rounded mx-0.5">P</kbd> to Quick Open anything
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {activePanels.console && (
                <div className="h-48 border-t border-[#1e1e1e] bg-[#1a1a1a] flex flex-col animate-in slide-in-from-bottom-2 duration-200 shrink-0">
                  <div className="px-3 py-1 bg-[#2C2C2C] text-[10px] font-bold text-text-muted uppercase tracking-wider flex justify-between items-center">
                    <span>Console / SQL Log</span>
                    <button onClick={() => useDatabaseStore.getState().togglePanel('console')} className="hover:text-white transition-colors">Close</button>
                  </div>
                  <div className="flex-1 p-3 font-mono text-[12px] opacity-70 overflow-auto">
                    <p className="text-[#6A9955]">-- Ready. Waiting for queries...</p>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* Right Panel - order=3 */}
          {rightVisible && (
            <Separator
              id="right-resizer"
              className="relative flex items-center justify-center transition-colors group w-[2px] mx-[-1px] cursor-col-resize z-50 hover:bg-accent/40 hover:w-[4px] hover:mx-[-2px] active:bg-accent active:w-[4px] active:mx-[-2px] bg-[#1e1e1e]"
            >
              <div className="absolute bg-[#3C3C3C] group-hover:bg-accent transition-colors w-[1px] h-full" />
            </Separator>
          )}
          
          {rightVisible && (
            <Panel 
              defaultSize={20} 
              minSize={15} 
              id="object-details-panel" 
              order={3}
              className="h-full flex flex-col"
            >
              <ObjectDetails />
            </Panel>
          )}
        </Group>
      )}

      <ConnectionModal open={showConnectionModal} onOpenChange={setShowConnectionModal} />
      <DatabaseSelectorModal />
    </div>
  );
}

export default App;
