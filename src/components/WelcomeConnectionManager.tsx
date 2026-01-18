import { useState, useEffect, useRef } from 'react';
import { Search, Plus, ExternalLink } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';

export const WelcomeConnectionManager = () => {
  const { savedConnections, setActiveConnection, setShowConnectionModal } = useDatabaseStore();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredConnections = savedConnections.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 bg-[#1e1e1e] flex flex-col min-w-0">
      {/* Header with Search */}
      <div className="h-14 flex items-center px-6 border-b border-black/10 gap-4">
        <div className="flex-1 relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-accent transition-colors" />
          <input 
            ref={inputRef}
            type="text"
            placeholder="Search for connection... (⌘F)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 bg-[#1a1a1a] border border-white/5 rounded-md pl-9 pr-3 text-[12px] focus:outline-none focus:border-accent/40 focus:bg-[#252526] transition-all"
          />
        </div>
        <button 
          onClick={() => setShowConnectionModal(true)}
          className="p-1.5 hover:bg-[#2C2C2C] rounded-md text-text-muted hover:text-white transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
        {filteredConnections.length > 0 ? (
          filteredConnections.map((conn) => (
            <div 
              key={conn.id}
              onDoubleClick={() => setActiveConnection(conn.id)}
              className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[#2C2C2C] cursor-default border border-transparent hover:border-white/5 transition-all group"
            >
              {/* Type Badge */}
              <div className={`w-10 h-10 rounded-full bg-opacity-10 bg-${conn.color}-500 flex items-center justify-center text-[12px] font-bold text-${conn.color}-500`}>
                {conn.type.substring(0, 2)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary group-hover:text-white truncate">
                    {conn.name}
                  </span>
                  <span className="px-1.5 py-0.5 bg-[#00d1b2]/10 text-[#00d1b2] text-[9px] font-bold rounded uppercase tracking-wider">
                    local
                  </span>
                </div>
                <div className="text-[11px] text-text-muted flex items-center gap-2 mt-0.5">
                  <span className="truncate">127.0.0.1 : {conn.type.toLowerCase()}</span>
                </div>
              </div>

              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1 px-2 text-[10px] bg-[#3C3C3C] text-text-muted hover:text-white rounded border border-white/5 flex items-center gap-1.5">
                  Connect <ExternalLink size={10} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full opacity-30 select-none">
            <Search size={48} strokeWidth={1} />
            <p className="text-sm mt-4">No connections found matching your search</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-6 border-t border-black/10 flex items-center gap-6">
        <button 
          onClick={() => setShowConnectionModal(true)}
          className="flex items-center gap-2 text-[12px] text-text-muted hover:text-accent transition-colors group"
        >
          <div className="w-5 h-5 rounded bg-[#2C2C2C] flex items-center justify-center group-hover:bg-accent/20 group-hover:text-accent transition-all">
            <Plus size={12} />
          </div>
          Create a New Connection
        </button>

        <button 
          onClick={() => {
            const { setConnectionModalMode, setShowConnectionModal } = useDatabaseStore.getState();
            setConnectionModalMode('url');
            setShowConnectionModal(true);
          }}
          className="flex items-center gap-2 text-[12px] text-text-muted hover:text-accent transition-colors group"
        >
          <div className="w-5 h-5 rounded bg-[#2C2C2C] flex items-center justify-center group-hover:bg-accent/20 group-hover:text-accent transition-all">
            <ExternalLink size={12} />
          </div>
          Import from URL
        </button>
      </div>
    </div>
  );
};
