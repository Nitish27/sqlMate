import React, { useState, useMemo } from 'react';
import { useDatabaseStore, SavedConnection } from '../store/databaseStore';
import { X, Search, Monitor, Key, Loader2, Server } from 'lucide-react';
import { cn } from '../utils/cn';

export const ConnectionSelectorModal = () => {
  const { 
    showConnectionSelector, 
    setShowConnectionSelector, 
    savedConnections, 
    connect,
    setShowConnectionModal
  } = useDatabaseStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [passwordPrompt, setPasswordPrompt] = useState<{
    visible: boolean;
    connection: SavedConnection | null;
    password: string;
  }>({ visible: false, connection: null, password: '' });

  const filteredConnections = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return savedConnections.filter(c => 
      c.name.toLowerCase().includes(term) || 
      c.host?.toLowerCase().includes(term) ||
      c.database?.toLowerCase().includes(term) ||
      c.type.toLowerCase().includes(term)
    );
  }, [savedConnections, searchTerm]);

  // Reset selection when search changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm]);

  if (!showConnectionSelector && !passwordPrompt.visible) return null;

  const handleOpen = async (conn: SavedConnection, password: string | null = null) => {
    setConnectingId(conn.id);
    setError(null);
    try {
      if (conn.type !== 'Sqlite' && password === null) {
        setConnectingId(null);
        setPasswordPrompt({ visible: true, connection: conn, password: '' });
        return;
      }
      
      await connect(conn, password);
      // store.connect handles setShowConnectionSelector(false)
      setPasswordPrompt({ visible: false, connection: null, password: '' });
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setConnectingId(null);
    }
  };

  const handleNew = () => {
    setShowConnectionSelector(false);
    setShowConnectionModal(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (passwordPrompt.visible) return;
    
    if (e.key === 'ArrowDown') {
      setSelectedIndex(prev => Math.min(prev + 1, filteredConnections.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter' && filteredConnections.length > 0) {
      handleOpen(filteredConnections[selectedIndex]);
    } else if (e.key === 'Escape') {
      setShowConnectionSelector(false);
    }
  };

  return (
    <>
      {showConnectionSelector && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConnectionSelector(false);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div 
            className="bg-[#2D2D2D] border border-[#444] rounded-xl shadow-2xl w-[500px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
            onKeyDown={onKeyDown}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c] bg-[#252525]">
              <span className="text-sm font-semibold text-text-primary">Open Connection</span>
              <button 
                onClick={() => setShowConnectionSelector(false)}
                className="text-text-muted hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="p-3 bg-[#252525] border-b border-[#3c3c3c]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search for connection..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#1e1e1e] border border-accent/30 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:border-accent transition-all placeholder:text-text-muted/50"
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="mx-4 mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-[11px]">
                {error}
              </div>
            )}

            {/* Connection List */}
            <div className="flex-1 max-h-[400px] overflow-y-auto bg-[#1e1e1e] p-1 custom-scrollbar">
              {filteredConnections.length > 0 ? (
                filteredConnections.map((conn, index) => {
                  const isActive = index === selectedIndex;
                  const isConnecting = connectingId === conn.id;
                  
                  return (
                    <div
                      key={conn.id}
                      onClick={() => !isConnecting && handleOpen(conn)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 rounded-lg cursor-default transition-all duration-100 mx-1 mb-1",
                        isActive ? "bg-accent text-white shadow-lg" : "hover:bg-[#2C2C2C] text-text-secondary"
                      )}
                    >
                      {/* DB Type Avatar */}
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold uppercase",
                        isActive ? "bg-white/20" : "bg-white/5 text-text-muted"
                      )}>
                        {isConnecting ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          conn.type === 'Postgres' ? 'Pg' : conn.type === 'MySql' ? 'Ms' : 'Sl'
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "text-[13px] font-semibold truncate",
                          isActive ? "text-white" : "text-text-primary"
                        )}>
                          {conn.name} <span className={cn(
                            "text-[10px] ml-1 px-1 rounded",
                            isActive ? "bg-white/20 text-white" : "bg-[#252525] text-green-500"
                          )}>
                            (local)
                          </span>
                        </div>
                        <div className={cn(
                          "text-[11px] truncate opacity-70",
                          isActive ? "text-white" : "text-text-muted"
                        )}>
                          {conn.host || 'localhost'}{conn.port ? `:${conn.port}` : ''} {conn.database ? `(${conn.database})` : ''}
                        </div>
                      </div>

                      {isActive && <div className="text-[10px] font-bold opacity-60">RETURN</div>}
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted italic gap-2 opacity-50">
                  <Monitor size={32} strokeWidth={1} />
                  <span className="text-xs">No connections found</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-[#252525] border-t border-[#3c3c3c] flex justify-between items-center">
              <button 
                onClick={() => setShowConnectionSelector(false)}
                className="px-4 py-1.5 text-xs text-text-secondary hover:bg-[#333] rounded-md transition-all active:scale-95"
              >
                Cancel
              </button>
              
              <div className="flex gap-2">
                <button 
                  onClick={handleNew}
                  className="px-4 py-1.5 text-xs text-text-primary bg-[#3c3c3c] hover:bg-[#444] border border-[#555] rounded-md transition-all active:scale-95 flex items-center gap-1.5"
                >
                  New...
                </button>
                <button 
                  onClick={() => filteredConnections.length > 0 && handleOpen(filteredConnections[selectedIndex])}
                  disabled={filteredConnections.length === 0 || connectingId !== null}
                  className="px-6 py-1.5 text-xs bg-accent text-white font-bold rounded-md hover:bg-accent/90 transition-all active:scale-95 shadow-lg shadow-accent/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {connectingId !== null ? <Loader2 size={12} className="animate-spin" /> : "Open"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Prompt Modal */}
      {passwordPrompt.visible && passwordPrompt.connection && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPasswordPrompt({ visible: false, connection: null, password: '' });
              setShowConnectionSelector(true);
            }
          }}
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-[110] flex items-center justify-center animate-in fade-in duration-200"
        >
          <div className="bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl w-[400px] animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#333] bg-[#252525]">
              <div className="flex items-center gap-2 text-accent">
                <Key size={16} />
                <span className="text-sm font-bold text-white uppercase tracking-tight">Database Login</span>
              </div>
              <button 
                onClick={() => {
                  setPasswordPrompt({ visible: false, connection: null, password: '' });
                  setShowConnectionSelector(true);
                }}
                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/5 rounded"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center text-accent">
                  <Server size={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{passwordPrompt.connection.name}</div>
                  <div className="text-[11px] text-text-muted truncate">
                    {passwordPrompt.connection.host || 'localhost'} · {passwordPrompt.connection.database || 'default'}
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-[11px] animate-in shake-1">
                  {error}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider ml-1">Password</div>
                <input 
                  type="password"
                  autoFocus
                  placeholder="Enter password"
                  value={passwordPrompt.password}
                  onChange={(e) => setPasswordPrompt(prev => ({ ...prev, password: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && passwordPrompt.connection) {
                      handleOpen(passwordPrompt.connection, passwordPrompt.password);
                    } else if (e.key === 'Escape') {
                      setPasswordPrompt({ visible: false, connection: null, password: '' });
                      setShowConnectionSelector(true);
                    }
                  }}
                  className="w-full bg-[#1e1e1e] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none transition-all placeholder:text-text-muted/30"
                />
              </div>
              
              <div className="flex items-center gap-2 px-1">
                <input type="checkbox" id="save-pw" className="rounded bg-[#333] border-white/10 text-accent focus:ring-0" />
                <label htmlFor="save-pw" className="text-[11px] text-text-muted hover:text-text-secondary cursor-pointer select-none">Remember password in keychain</label>
              </div>
            </div>

            <div className="p-4 bg-[#252525] border-t border-[#333] flex justify-end gap-3">
              <button 
                onClick={() => {
                  setPasswordPrompt({ visible: false, connection: null, password: '' });
                  setShowConnectionSelector(true);
                }}
                className="px-4 py-1.5 text-xs text-text-secondary hover:bg-white/5 rounded-lg transition-colors"
                disabled={connectingId !== null}
              >
                Back
              </button>
              <button 
                onClick={() => {
                  if (passwordPrompt.connection) {
                    handleOpen(passwordPrompt.connection, passwordPrompt.password);
                  }
                }}
                disabled={connectingId !== null}
                className="px-8 py-2 text-xs bg-accent text-white font-bold rounded-lg hover:bg-accent/90 transition-all active:scale-95 shadow-lg shadow-accent/20 flex items-center gap-2"
              >
                {connectingId !== null ? <Loader2 size={12} className="animate-spin" /> : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
