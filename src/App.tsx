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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnectionId, setShowDatabaseSelector]);
  
  // Find the active tab to render its content
  const activeTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="flex h-screen w-full bg-[#1e1e1e] text-[#cccccc] overflow-hidden font-sans">
      {!activeConnectionId ? (
        <WelcomeScreen />
      ) : (
        <>
          {activePanels.sidebar && <Sidebar />}
          
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <Toolbar 
              onRefresh={triggerRefresh}
              onCommit={() => console.log('Commit active tab')}
              onDiscard={() => console.log('Discard active tab')}
              pendingChangesCount={0} 
            />
            
            <TabManager />

            {/* Workspace Content */}
            <div className="flex-1 flex overflow-hidden relative">
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div className="flex-1 overflow-hidden relative">
                  {activeTab ? (
                    <div className="h-full flex flex-col">
                      {/* Content based on tab type */}
                      {activeTab.type === 'table' && (
                        <TabContentTable 
                          key={activeTab.id} // Important for state isolation
                          tableName={activeTab.tableName!} 
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

                {/* Bottom Console Panel */}
                {activePanels.console && (
                  <div className="h-48 border-t border-[#1e1e1e] bg-[#1a1a1a] flex flex-col animate-in slide-in-from-bottom-2 duration-200">
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

              {/* Right Panel */}
              {activePanels.right && (
                <div className="w-64 border-l border-[#1e1e1e] bg-[#252526] flex flex-col animate-in slide-in-from-right-2 duration-200">
                   <ObjectDetails />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <ConnectionModal open={showConnectionModal} onOpenChange={setShowConnectionModal} />
      <DatabaseSelectorModal />
    </div>
  );
}

export default App;
