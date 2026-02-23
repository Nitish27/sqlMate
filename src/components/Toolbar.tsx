import { useState, useEffect } from 'react';
import { RefreshCw, Layout, Sidebar as SidebarIcon, Terminal, Save, RotateCcw, ChevronRight, Database, Server, Check, Search, X, Key, Loader2, Upload, Download } from 'lucide-react';
import { useDatabaseStore, SavedConnection } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';

interface ToolbarProps {
  onRefresh?: () => void;
  onCommit?: () => void;
  onDiscard?: () => void;
  pendingChangesCount?: number;
}

export const Toolbar = ({ 
  onRefresh, 
  onCommit, 
  onDiscard, 
  pendingChangesCount = 0 
}: ToolbarProps) => {
  const { 
    activeConnectionId, 
    activeDatabase, 
    activeTable, 
    savedConnections, 
    setActiveConnection, 
    setActiveDatabase,
    databases,
    setDatabases,
    safeMode,
    setSafeMode,
    activePanels,
    togglePanel,
    setShowConnectionModal,
    setShowDatabaseSelector,
    setShowImportDialog,
    setShowExportDialog,
    openTab
  } = useDatabaseStore();

  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [dbDropdownOpen, setDbDropdownOpen] = useState(false);
  const [dbSearch, setDbSearch] = useState('');
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{
    visible: boolean;
    connection: SavedConnection | null;
    password: string;
  }>({ visible: false, connection: null, password: '' });
  
  const connection = savedConnections.find(c => c.id === activeConnectionId);

  // Handle switching to a different saved connection
  const handleSwitchConnection = (conn: SavedConnection) => {
    if (conn.id === activeConnectionId) {
      setConnDropdownOpen(false);
      return;
    }
    setSwitchError(null);
    if (conn.type === 'Sqlite') {
      performConnect(conn, null);
    } else {
      setConnDropdownOpen(false);
      setPasswordPrompt({ visible: true, connection: conn, password: '' });
    }
  };

  const performConnect = async (conn: SavedConnection, password: string | null) => {
    setSwitchingId(conn.id);
    setSwitchError(null);
    setPasswordPrompt({ visible: false, connection: null, password: '' });
    setConnDropdownOpen(false);
    try {
      const config = {
        id: conn.id,
        name: conn.name,
        db_type: conn.type,
        host: conn.host || null,
        port: conn.port || null,
        username: conn.username || null,
        database: conn.database || null,
        ssl_enabled: conn.ssl_enabled || false,
        ssl_mode: conn.ssl_mode || 'prefer',
        ssl_ca_path: conn.ssl_ca_path || null,
        ssl_cert_path: conn.ssl_cert_path || null,
        ssl_key_path: conn.ssl_key_path || null,
        ssh_enabled: conn.ssh_enabled || false,
        ssh_host: conn.ssh_host || null,
        ssh_port: conn.ssh_port || null,
        ssh_username: conn.ssh_username || null,
        ssh_auth_method: conn.ssh_auth_method || 'password',
        ssh_password: null,
        ssh_private_key_path: conn.ssh_private_key_path || null,
        environment: conn.environment || 'local',
        color_tag: conn.color || 'blue',
      };
      await invoke('connect', { config, password });
      setActiveConnection(conn.id);
    } catch (err: any) {
      console.error('Switch connection failed:', err);
      setSwitchError(`Failed: ${err.toString()}`);
    } finally {
      setSwitchingId(null);
    }
  };

  // Fetch databases when connection is active
  useEffect(() => {
    if (activeConnectionId) {
      invoke<string[]>('get_databases', { connectionId: activeConnectionId })
        .then(dbs => {
          setDatabases(dbs);
          if (!activeDatabase && dbs.length > 0) {
            // Auto-select first database if none selected
            setActiveDatabase(dbs[0]);
          }
        })
        .catch(err => console.error('Failed to fetch databases:', err));
    }
  }, [activeConnectionId, activeDatabase, setDatabases, setActiveDatabase]);

  const filteredDatabases = databases.filter(db => 
    db.toLowerCase().includes(dbSearch.toLowerCase())
  );

  return (
    <div className="h-10 bg-[#2C2C2C] border-b border-[#1e1e1e] flex items-center justify-between px-2 text-[#cccccc] select-none z-50">
      {/* Left side: Action Controls */}
      <div className="flex items-center gap-0.5">
        <button 
          onClick={onRefresh}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors"
          title="Refresh (⌘+R)"
        >
          <RefreshCw size={14} />
        </button>
        <button 
          onClick={() => {
            if (activeConnectionId) {
              openTab({
                type: 'query',
                title: 'SQL Query',
                connectionId: activeConnectionId,
                query: ''
              });
            }
          }}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors group relative"
          title="SQL Terminal (⌘E)"
        >
          <Terminal size={14} />
        </button>
        <button 
          onClick={() => setShowDatabaseSelector(true)}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors group relative"
          title="Open Database (⌘K)"
        >
          <Database size={14} />
        </button>

        <div className="w-[1px] h-4 bg-[#3C3C3C] mx-1" />

        <button 
          onClick={() => setShowImportDialog(true)}
          disabled={!activeConnectionId}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Import Data"
        >
          <Upload size={14} />
        </button>
        <button 
          onClick={() => setShowExportDialog(true)}
          disabled={!activeConnectionId}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Export Data"
        >
          <Download size={14} />
        </button>

        <div className="w-[1px] h-4 bg-[#3C3C3C] mx-1" />

        <button 
          onClick={onDiscard}
          disabled={pendingChangesCount === 0}
          className="p-1.5 hover:bg-[#3C3C3C] rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Discard changes"
        >
          <RotateCcw size={14} />
        </button>
        <button 
          onClick={onCommit}
          disabled={pendingChangesCount === 0}
          className={`p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors group relative ${pendingChangesCount > 0 ? 'text-accent' : 'disabled:opacity-30'}`}
          title="Commit changes"
        >
          <Save size={14} />
        </button>

        {/* Safe Mode Switcher */}
        <button 
          onClick={() => {
            const modes: ('Silent' | 'Alert' | 'Safe')[] = ['Silent', 'Alert', 'Safe'];
            const next = modes[(modes.indexOf(safeMode) + 1) % modes.length];
            setSafeMode(next);
          }}
          className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${
            safeMode === 'Silent' ? 'border-transparent text-text-muted hover:border-[#444]' :
            safeMode === 'Alert' ? 'border-yellow-600/50 text-yellow-500 bg-yellow-500/5' :
            'border-red-600/50 text-red-500 bg-red-500/5'
          }`}
          title={`Safe Mode: ${safeMode}`}
        >
          {safeMode.toUpperCase()}
        </button>
      </div>

      {/* Center: Status Bar / Breadcrumbs */}
      <div className="flex-1 flex justify-center max-w-[60%]">
        <div className="flex items-center h-7 px-1 bg-[#1e1e1e] border border-[#3C3C3C] rounded-md text-[11px] font-medium shadow-sm">
          
          {/* Connection Switcher */}
          <div className="relative h-full flex items-center">
            <button 
              onClick={() => {
                setConnDropdownOpen(!connDropdownOpen);
                setDbDropdownOpen(false);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 h-full rounded hover:bg-[#2C2C2C] transition-colors ${connDropdownOpen ? 'bg-[#2C2C2C]' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full bg-${connection?.color || 'blue'}-500 shadow-[0_0_5px_rgba(0,122,204,0.5)]`} />
              <span className="text-text-primary uppercase tracking-tight font-bold opacity-60">LOCAL</span>
              <span className="text-text-muted">|</span>
              <div className="flex items-center gap-1 text-text-secondary">
                <Server size={12} className="opacity-70" />
                <span className="max-w-[120px] truncate">{connection?.name || 'No Connection'}</span>
              </div>
            </button>

            {connDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">Switch Connection</div>
                  {savedConnections.map(conn => (
                    <button
                      key={conn.id}
                      disabled={switchingId === conn.id}
                      onClick={() => handleSwitchConnection(conn)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-white text-left text-text-secondary transition-colors disabled:opacity-50"
                    >
                      <div className={`w-2 h-2 rounded-full bg-${conn.color}-500`} />
                      <span className="flex-1 truncate">{conn.name}</span>
                      {switchingId === conn.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : conn.id === activeConnectionId ? (
                        <Check size={12} className="text-accent group-hover:text-white" />
                      ) : null}
                    </button>
                  ))}
                  <div className="border-t border-[#3C3C3C] my-1" />
                  <button 
                    onClick={() => {
                      setShowConnectionModal(true);
                      setConnDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-white text-left text-text-secondary transition-colors italic"
                  >
                    <Server size={12} />
                    New Connection...
                  </button>
                </div>
              </div>
            )}
          </div>
          
          {activeDatabase && (
            <>
              <ChevronRight size={12} className="text-text-muted mx-0.5 opacity-50" />
              <div className="relative h-full flex items-center">
                <button 
                  onClick={() => {
                    setDbDropdownOpen(!dbDropdownOpen);
                    setConnDropdownOpen(false);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 h-full rounded hover:bg-[#2C2C2C] transition-colors text-text-secondary ${dbDropdownOpen ? 'bg-[#2C2C2C]' : ''}`}
                >
                  <Database size={12} className="opacity-70" />
                  <span className="max-w-[120px] truncate group-hover:text-text-primary transition-colors">{activeDatabase}</span>
                </button>

                {dbDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-1 duration-100">
                    <div className="p-2 border-b border-[#3C3C3C]">
                      <div className="relative">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                          autoFocus
                          value={dbSearch}
                          onChange={(e) => setDbSearch(e.target.value)}
                          placeholder="Search database..."
                          className="w-full bg-[#1e1e1e] border border-[#3C3C3C] rounded px-7 py-1 text-[11px] focus:outline-none focus:border-accent/50"
                        />
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {filteredDatabases.length > 0 ? (
                        filteredDatabases.map(db => (
                          <button
                            key={db}
                            onClick={() => {
                              setActiveDatabase(db);
                              setDbDropdownOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent hover:text-white text-left text-text-secondary transition-colors"
                          >
                            <Database size={12} className="opacity-50" />
                            <span className="flex-1 truncate">{db}</span>
                            {db === activeDatabase && <Check size={12} />}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-[10px] text-text-muted italic text-center">No databases found</div>
                      )}
                    </div>
                    <div className="p-2 border-t border-[#3C3C3C] bg-[#252526]">
                      <button className="text-[10px] text-accent hover:underline">Manage Databases...</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTable && (
            <>
              <ChevronRight size={12} className="text-text-muted mx-0.5 opacity-50" />
              <div className="flex items-center gap-1 px-2 py-1 h-full rounded hover:bg-[#2C2C2C] transition-colors text-accent">
                <Layout size={12} />
                <span className="font-semibold uppercase tracking-wider">{activeTable}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right side: Panel Toggles */}
      <div className="flex items-center gap-0.5">
        <button 
          onClick={() => togglePanel('sidebar')}
          className={`p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors ${activePanels.sidebar ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Sidebar"
        >
          <SidebarIcon size={14} />
        </button>
        <button 
          onClick={() => togglePanel('right')}
          className={`p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors ${activePanels.right ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Right Panel"
        >
          <Layout size={14} className="rotate-180" />
        </button>
        <button 
          onClick={() => togglePanel('console')}
          className={`p-1.5 hover:bg-[#3C3C3C] rounded-md transition-colors ${activePanels.console ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Console"
        >
          <Terminal size={14} />
        </button>
      </div>

      {/* Password Prompt Modal for Switch Connection */}
      {passwordPrompt.visible && passwordPrompt.connection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl w-[380px] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-[#333]">
              <div className="flex items-center gap-2">
                <Key size={14} className="text-accent" />
                <span className="text-sm font-semibold text-white">Enter Password</span>
              </div>
              <button 
                onClick={() => setPasswordPrompt({ visible: false, connection: null, password: '' })}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[12px] text-text-muted">
                Enter password for <span className="text-white font-medium">{passwordPrompt.connection.name}</span>
              </p>
              {switchError && (
                <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-[11px]">
                  {switchError}
                </div>
              )}
              <input 
                type="password"
                autoFocus
                placeholder="Password"
                value={passwordPrompt.password}
                onChange={(e) => setPasswordPrompt(prev => ({ ...prev, password: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && passwordPrompt.connection) {
                    performConnect(passwordPrompt.connection, passwordPrompt.password || null);
                  }
                }}
                className="w-full bg-[#252525] border border-[#333] rounded px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div className="p-4 bg-[#1a1a1a] border-t border-[#333] flex justify-end gap-3">
              <button 
                onClick={() => setPasswordPrompt({ visible: false, connection: null, password: '' })}
                className="px-4 py-1.5 text-xs text-gray-400 hover:bg-[#2a2a2a] rounded transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (passwordPrompt.connection) {
                    performConnect(passwordPrompt.connection, passwordPrompt.password || null);
                  }
                }}
                className="px-6 py-1.5 text-xs bg-accent text-white font-bold rounded hover:bg-accent/90 transition-all"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
