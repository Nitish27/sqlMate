import { useDatabaseStore } from '../store/databaseStore';
import { Server, X, Plug } from 'lucide-react';

const getShortName = (name: string) => {
  if (!name) return "";
  if (name.length <= 5) return name; // "LOCAL", "PROD", etc. fit perfectly
  
  const words = name.trim().split(/[\s_-]+/);
  if (words.length > 1 && words[0].length > 0 && words[1].length > 0) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export const ConnectionRail = () => {
  const { 
    openConnectionIds, 
    selectedConnectionId, 
    selectConnection, 
    closeConnectionFromRail,
    savedConnections,
    setShowConnectionSelector,
    showConnectionName
  } = useDatabaseStore();

  return (
    <div className="w-14 bg-[#1e1e1e] border-r border-[#1e1e1e] flex flex-col items-center py-4 gap-4 z-40 h-full shrink-0">
      {/* Top: Connection Switcher Trigger */}
      <button
        onClick={() => setShowConnectionSelector(true)}
        className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#2C2C2C] text-text-muted hover:bg-[#3C3C3C] hover:text-white transition-all mb-2 shadow-lg group relative"
        title="Open Connection (⌘O)"
      >
        <Plug size={18} className="rotate-45 group-hover:rotate-0 transition-transform duration-300" />
        <div className="absolute inset-0 rounded-lg border border-white/5 group-hover:border-accent/50 transition-colors" />
      </button>

      <div className="w-8 h-[1px] bg-[#333] mb-2" />

      <div className="flex-1 flex flex-col items-center gap-4 w-full overflow-y-auto no-scrollbar">
        {openConnectionIds.map((id) => {
          const conn = savedConnections.find(c => c.id === id);
          if (!conn) return null;
          
          const isActive = id === selectedConnectionId;
          
          return (
            <div key={id} className="relative group">
              <button
                onClick={() => selectConnection(id)}
                className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center transition-all duration-200 relative ${
                  isActive 
                    ? 'bg-accent text-white shadow-[0_0_15px_rgba(0,122,204,0.3)]' 
                    : 'bg-[#2C2C2C] text-text-muted hover:bg-[#3C3C3C] hover:text-text-primary'
                }`}
                title={conn.name}
              >
                <Server size={18} />
                
                {/* Optional labels based on settings */}
                <div className="mt-0.5 flex flex-col items-center pointer-events-none leading-tight overflow-hidden px-0.5 pb-0.5">
                  {showConnectionName && (
                    <span className="text-[7px] font-bold truncate w-full text-center uppercase opacity-80 tracking-wider">
                      {getShortName(conn.name)}
                    </span>
                  )}
                </div>
                
                {/* Active Indicator bar */}
                {isActive && (
                  <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-r-full shadow-[0_0_8px_var(--accent)]" />
                )}
              </button>
              
              {/* Close button on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeConnectionFromRail(id);
                }}
                className="absolute -top-1 -right-1 w-4 h-4 bg-[#444] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 scale-75 shadow-lg"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
