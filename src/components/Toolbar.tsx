import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Layout, Sidebar as SidebarIcon, Terminal, Save, RotateCcw, ChevronRight, Database, Server, Check, Search, X, Key, Loader2, Upload, Download, GitCompareArrows, GitCompare } from 'lucide-react';
import { useDatabaseStore, SavedConnection } from '../store/databaseStore';
import { invoke } from '@tauri-apps/api/core';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { ThemeSettings } from './ThemeSettings';
import { needsCredentialPrompt, type CredentialStatus } from '../utils/connectionCredentials';
import { connectionIdentity, requiresProtectionDowngradeConfirmation, safetyModeDescription, type SafetyMode } from '../utils/connectionClarity';

interface ToolbarProps {
  onRefresh?: () => void;
  onCheckForUpdates?: () => void;
  isCheckingForUpdates?: boolean;
  onCommit?: () => void;
  onDiscard?: () => void;
  pendingChangesCount?: number;
  onCompareSchema?: () => void;
  onCompareData?: () => void;
}

export const Toolbar = ({ 
  onRefresh, 
  onCheckForUpdates,
  isCheckingForUpdates = false,
  onCommit, 
  onDiscard, 
  pendingChangesCount = 0,
  onCompareSchema,
  onCompareData,
}: ToolbarProps) => {
  const { 
    activeConnectionId, 
    activeDatabase, 
    activeTable, 
    savedConnections, 
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
    openTab,
    openConnectionIds,
    selectConnection,
    connect
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
    sshPassword: string;
    remember: boolean;
  }>({ visible: false, connection: null, password: '', sshPassword: '', remember: false });
  
  const connDropdownRef = useRef<HTMLDivElement>(null);
  const dbDropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(connDropdownRef, () => setConnDropdownOpen(false), connDropdownOpen);
  useOutsideClick(dbDropdownRef, () => setDbDropdownOpen(false), dbDropdownOpen);
  
  const connection = savedConnections.find(c => c.id === activeConnectionId);
  const connectionDetails = connection ? connectionIdentity(connection) : null;

  // Handle switching to a different saved connection
  const handleSwitchConnection = async (conn: SavedConnection) => {
    if (conn.id === activeConnectionId) {
      setConnDropdownOpen(false);
      return;
    }
    if (openConnectionIds.includes(conn.id)) {
      selectConnection(conn.id);
      setConnDropdownOpen(false);
      return;
    }
    setSwitchError(null);
    try {
      const status = conn.rememberCredentials && conn.type !== 'Sqlite'
        ? await invoke<CredentialStatus>('credential_status', { connectionId: conn.id }) : null;
      if (!needsCredentialPrompt(conn, status)) await performConnect(conn);
      else setPasswordPrompt({ visible: true, connection: conn, password: '', sshPassword: '', remember: Boolean(conn.rememberCredentials) });
    } catch (err) {
      setSwitchError(`Could not check saved credentials: ${String(err)}`);
      setPasswordPrompt({ visible: true, connection: conn, password: '', sshPassword: '', remember: Boolean(conn.rememberCredentials) });
    }
  };

  const performConnect = async (conn: SavedConnection, credentials?: { password?: string; sshPassword?: string; remember?: boolean }) => {
    setSwitchingId(conn.id);
    setSwitchError(null);
    try {
      await connect(conn, credentials);
      // store.connect handles setShowConnectionSelector(false) and selection state
      setPasswordPrompt({ visible: false, connection: null, password: '', sshPassword: '', remember: false });
      setConnDropdownOpen(false);
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
            setActiveDatabase(dbs[0]).catch(err => console.error('Failed to select database:', err));
          }
        })
        .catch(err => console.error('Failed to fetch databases:', err));
    }
  }, [activeConnectionId, activeDatabase, setDatabases, setActiveDatabase]);

  const filteredDatabases = databases.filter(db => 
    db.toLowerCase().includes(dbSearch.toLowerCase())
  );

  return (
    <div className="h-10 bg-surface border-b border-border flex items-center justify-between px-2 text-text-primary select-none z-50">
      {/* Left side: Action Controls */}
      <div className="flex items-center gap-0.5">
        <button 
          onClick={onRefresh}
          className="p-1.5 hover:bg-hover rounded-md transition-colors"
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
          className="p-1.5 hover:bg-hover rounded-md transition-colors group relative"
          title="SQL Terminal (⌘E)"
        >
          <Terminal size={14} />
        </button>
        <button 
          onClick={() => setShowDatabaseSelector(true)}
          className="p-1.5 hover:bg-hover rounded-md transition-colors group relative"
          title="Open Database (⌘K)"
        >
          <Database size={14} />
        </button>

        <div className="w-[1px] h-4 bg-border-strong mx-1" />

        <button 
          onClick={() => setShowImportDialog(true)}
          disabled={!activeConnectionId}
          className="p-1.5 hover:bg-hover rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Import Data"
        >
          <Upload size={14} />
        </button>
        <button 
          onClick={() => setShowExportDialog(true)}
          disabled={!activeConnectionId}
          className="p-1.5 hover:bg-hover rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Export Data"
        >
          <Download size={14} />
        </button>
        <button
          onClick={onCompareSchema}
          disabled={!activeConnectionId}
          className="p-1.5 hover:bg-hover rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="Compare schemas across open connections"
          aria-label="Compare schemas"
        >
          <GitCompareArrows size={14} />
        </button>
        <button onClick={onCompareData} disabled={!activeConnectionId} className="p-1.5 hover:bg-hover rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors" title="Compare table data across open connections" aria-label="Compare table data"><GitCompare size={14} /></button>

        <div className="w-[1px] h-4 bg-border-strong mx-1" />

        <button 
          onClick={onDiscard}
          disabled={pendingChangesCount === 0}
          className="p-1.5 hover:bg-hover rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors group relative"
          title="Discard changes"
        >
          <RotateCcw size={14} />
        </button>
        <button 
          onClick={onCommit}
          disabled={pendingChangesCount === 0}
          className={`p-1.5 hover:bg-hover rounded-md transition-colors group relative ${pendingChangesCount > 0 ? 'text-accent' : 'disabled:opacity-30'}`}
          title="Commit changes"
        >
          <Save size={14} />
        </button>

        {/* Connection-scoped write protection */}
        <select
          value={safeMode}
          onChange={async (event) => {
            const next = event.target.value as SafetyMode;
            if (requiresProtectionDowngradeConfirmation(safeMode, next)
              && !window.confirm(`Lower protection for ${connectionDetails?.description || 'this connection'}?\n\n${safetyModeDescription(next)}`)) {
              event.target.value = safeMode;
              return;
            }
            try {
              await setSafeMode(next);
            } catch (error) {
              event.target.value = safeMode;
              window.alert(`Could not change write protection: ${error}`);
            }
          }}
          disabled={!activeConnectionId}
          aria-label={`Write protection for ${connection?.name || 'current connection'}`}
          className={`ml-1 max-w-24 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${
            safeMode === 'Silent' ? 'border-transparent text-text-muted hover:border-[#444]' :
            safeMode === 'Alert' ? 'border-yellow-600/50 text-yellow-500 bg-yellow-500/5' :
            'border-red-600/50 text-red-500 bg-red-500/5'
          }`}
          title={safetyModeDescription(safeMode)}
        >
          <option value="Silent">SILENT</option>
          <option value="Alert">ALERT</option>
          <option value="Safe">SAFE</option>
        </select>
      </div>

      {/* Center: Status Bar / Breadcrumbs */}
      <div className="flex-1 flex justify-center max-w-[60%]">
        <div className="flex items-center h-7 px-1 bg-background border border-border-strong rounded-md text-[11px] font-medium shadow-sm">
          
          {/* Connection Switcher */}
          <div ref={connDropdownRef} className="relative h-full flex items-center">
            <button 
              onClick={() => {
                setConnDropdownOpen(!connDropdownOpen);
                setDbDropdownOpen(false);
              }}
              title={connectionDetails?.description || 'No connection selected'}
              className={`flex items-center gap-1.5 px-2 py-1 h-full rounded hover:bg-surface transition-colors ${connDropdownOpen ? 'bg-surface' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full bg-${connection?.color || 'blue'}-500 shadow-[0_0_5px_rgba(0,122,204,0.5)]`} />
              <span className={`uppercase tracking-tight font-bold ${connectionDetails?.environment === 'PRODUCTION' ? 'text-amber-400' : 'text-text-secondary'}`}>{connectionDetails?.environment || 'NO CONNECTION'}</span>
              <span className="text-text-muted">|</span>
              <div className="flex items-center gap-1 text-text-secondary">
                <Server size={12} className="opacity-70" />
                <span className="max-w-[120px] truncate">{connection?.name || 'No Connection'}</span>
              </div>
            </button>

            {connDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-border-strong rounded-md shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
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
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{conn.name}</span>
                        <span className="block truncate text-[10px] opacity-70">{connectionIdentity(conn).environment} | {connectionIdentity(conn).target}</span>
                      </span>
                      {switchingId === conn.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : conn.id === activeConnectionId ? (
                        <Check size={12} className="text-accent group-hover:text-white" />
                      ) : null}
                    </button>
                  ))}
                  {switchError && <div role="alert" className="mx-2 my-1 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-400">{switchError}</div>}
                  <div className="border-t border-border-strong my-1" />
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
              <div ref={dbDropdownRef} className="relative h-full flex items-center">
                <button 
                  onClick={() => {
                    setDbDropdownOpen(!dbDropdownOpen);
                    setConnDropdownOpen(false);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 h-full rounded hover:bg-surface transition-colors text-text-secondary ${dbDropdownOpen ? 'bg-surface' : ''}`}
                >
                  <Database size={12} className="opacity-70" />
                  <span className="max-w-[120px] truncate group-hover:text-text-primary transition-colors">{activeDatabase}</span>
                </button>

                {dbDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-surface border border-border-strong rounded-md shadow-xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-1 duration-100">
                    <div className="p-2 border-b border-border-strong">
                      <div className="relative">
                        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                          autoFocus
                          value={dbSearch}
                          onChange={(e) => setDbSearch(e.target.value)}
                          placeholder="Search database..."
                          className="w-full bg-background border border-border-strong rounded px-7 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent/50"
                        />
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {filteredDatabases.length > 0 ? (
                        filteredDatabases.map(db => (
                          <button
                            key={db}
                            onClick={async () => {
                              try {
                                await setActiveDatabase(db);
                                setDbDropdownOpen(false);
                              } catch (error) {
                                window.alert(`Could not switch database: ${error}`);
                              }
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
                    <div className="p-2 border-t border-border-strong bg-sidebar">
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
              <div className="flex items-center gap-1 px-2 py-1 h-full rounded hover:bg-surface transition-colors text-accent">
                <Layout size={12} />
                <span className="font-semibold uppercase tracking-wider">{activeTable}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right side: Panel Toggles */}
      <div className="flex items-center gap-0.5">
        <ThemeSettings displayMode="toolbar" defaultScope="sqlEditor" />
        <button
          onClick={onCheckForUpdates}
          disabled={isCheckingForUpdates}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
          title="Check for updates"
        >
          <RefreshCw size={14} className={isCheckingForUpdates ? 'animate-spin' : ''} />
        </button>
        <div className="w-[1px] h-4 bg-border-strong mx-1" />
        <button 
          onClick={() => togglePanel('sidebar')}
          className={`p-1.5 hover:bg-hover rounded-md transition-colors ${activePanels.sidebar ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Sidebar"
        >
          <SidebarIcon size={14} />
        </button>
        <button 
          onClick={() => togglePanel('right')}
          className={`p-1.5 hover:bg-hover rounded-md transition-colors ${activePanels.right ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Right Panel"
        >
          <Layout size={14} className="rotate-180" />
        </button>
        <button 
          onClick={() => togglePanel('console')}
          className={`p-1.5 hover:bg-hover rounded-md transition-colors ${activePanels.console ? 'text-accent' : 'text-text-muted'}`}
          title="Toggle Console"
        >
          <Terminal size={14} />
        </button>
      </div>

      {/* Password Prompt Modal for Switch Connection */}
      {passwordPrompt.visible && passwordPrompt.connection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-background border border-border rounded-lg shadow-2xl w-[380px] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Key size={14} className="text-accent" />
                <span className="text-sm font-semibold text-text-primary">Enter Password</span>
              </div>
              <button 
                onClick={() => setPasswordPrompt({ visible: false, connection: null, password: '', sshPassword: '', remember: false })}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[12px] text-text-muted">
                Enter password for <span className="text-text-primary font-medium">{passwordPrompt.connection.name}</span>
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
                    performConnect(passwordPrompt.connection, { password: passwordPrompt.password, sshPassword: passwordPrompt.sshPassword, remember: passwordPrompt.remember });
                  }
                }}
                className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              {passwordPrompt.connection.ssh_enabled && passwordPrompt.connection.ssh_auth_method !== 'key' && (
                <input type="password" aria-label="SSH password" placeholder="SSH password" value={passwordPrompt.sshPassword} onChange={(e) => setPasswordPrompt(prev => ({ ...prev, sshPassword: e.target.value }))} className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none" />
              )}
              <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={passwordPrompt.remember} onChange={(e) => setPasswordPrompt(prev => ({ ...prev, remember: e.target.checked }))} /> Remember passwords in OS keychain</label>
            </div>
            <div className="p-4 bg-surface border-t border-border flex justify-end gap-3">
              <button 
                onClick={() => setPasswordPrompt({ visible: false, connection: null, password: '', sshPassword: '', remember: false })}
                className="px-4 py-1.5 text-xs text-text-secondary hover:bg-hover rounded transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (passwordPrompt.connection) {
                    performConnect(passwordPrompt.connection, { password: passwordPrompt.password, sshPassword: passwordPrompt.sshPassword, remember: passwordPrompt.remember });
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
