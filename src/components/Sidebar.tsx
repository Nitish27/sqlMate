import { Database, Plus, Settings, Activity, History as HistoryIcon } from 'lucide-react';
import { DatabaseExplorer } from './DatabaseExplorer';
import { SidebarHistory } from './SidebarHistory';
import { useDatabaseStore } from '../store/databaseStore';
import { Logo } from './Logo';

export const Sidebar = () => {
  const { 
    activeConnectionId, 
    setActiveConnection, 
    setShowConnectionModal, 
    sidebarSearchTerm, 
    setSidebarSearchTerm, 
    sidebarViewMode,
    setSidebarViewMode
  } = useDatabaseStore();

  const handleOpenHistory = () => {
    setSidebarViewMode('history');
  };

  return (
    <>
      <div className="w-full bg-sidebar border-r border-border flex flex-col h-full select-none">
        <div className="flex items-center px-4 py-3 bg-[#1e1e1e] border-b border-black/10">
          <Logo height={24} />
        </div>
        {activeConnectionId ? (
          <div className="flex flex-col border-b border-border bg-[#2C2C2C]">
            <div className="flex items-center px-3 pt-4 pb-2 gap-0.5">
              <button 
                onClick={() => setSidebarViewMode('items')}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  sidebarViewMode === 'items' ? 'bg-[#555555] text-white' : 'text-[#999999] hover:text-white'
                }`}
              >
                Items
              </button>
              <button 
                onClick={() => setSidebarViewMode('queries')}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  sidebarViewMode === 'queries' ? 'bg-[#555555] text-white' : 'text-[#999999] hover:text-white'
                }`}
              >
                Queries
              </button>
              <button 
                onClick={() => setSidebarViewMode('history')}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  sidebarViewMode === 'history' ? 'bg-[#555555] text-white' : 'text-[#999999] hover:text-white'
                }`}
              >
                History
              </button>
            </div>
            
            <div className="px-2 pb-2 bg-[#3C3C3C]">
               <div className="relative">
                   <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2 top-1.5 text-gray-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                   <input 
                     className="w-full bg-[#252526] border border-[#1e1e1e] rounded pl-7 pr-7 py-0.5 text-[11px] text-[#cccccc] focus:outline-none focus:border-[#007acc] placeholder-gray-500" 
                     placeholder={sidebarViewMode === 'history' ? "Search for history..." : "Search for item..."}
                     value={sidebarSearchTerm}
                     onChange={(e) => setSidebarSearchTerm(e.target.value)}
                   />
                   {sidebarSearchTerm && (
                     <button 
                       onClick={() => setSidebarSearchTerm('')}
                       className="absolute right-2 top-1.5 text-gray-500 hover:text-gray-300"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                     </button>
                   )}
               </div>
            </div>
          </div>
        ) : (
          <div className="p-4 flex items-center justify-between border-b border-border bg-[#2C2C2C] h-[69px]">
            <h1 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Connections
            </h1>
            <button 
              onClick={() => setShowConnectionModal(true)}
              className="p-1 hover:bg-[#3C3C3C] rounded transition-colors text-text-primary"
            >
              <Plus size={16} />
            </button>
          </div>
        )}
        
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {activeConnectionId ? (
            sidebarViewMode === 'history' ? (
              <SidebarHistory />
            ) : sidebarViewMode === 'queries' ? (
              <div className="p-4 text-center text-text-muted text-[11px] italic">No queries saved</div>
            ) : (
              <DatabaseExplorer />
            )
          ) : (
            <div className="py-2">
              <div 
                onClick={() => setActiveConnection('test-id')}
                className="px-4 py-2 flex items-center gap-3 text-text-secondary hover:bg-border cursor-pointer group transition-colors"
              >
                <Database size={14} className="group-hover:text-accent" />
                <span className="text-sm">Localhost (SQLite)</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex flex-col gap-2">
          <div 
            onClick={handleOpenHistory}
            className="flex items-center gap-3 text-text-muted hover:text-text-primary cursor-pointer transition-colors px-1 py-1"
          >
            <HistoryIcon size={16} />
            <span className="text-sm">Recent</span>
          </div>
          <div className="flex items-center gap-3 text-text-muted hover:text-text-primary cursor-pointer transition-colors px-1 py-1">
            <Activity size={16} />
            <span className="text-sm">Logs</span>
          </div>
          <div className="flex items-center gap-3 text-text-muted hover:text-text-primary cursor-pointer transition-colors px-1 py-1">
            <Settings size={16} />
            <span className="text-sm">Settings</span>
          </div>
        </div>
      </div>
    </>
  );
};
