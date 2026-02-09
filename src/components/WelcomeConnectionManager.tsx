import { useState, useEffect, useRef } from 'react';
import { Search, Plus, ExternalLink, MoreHorizontal, Pencil, Trash2, Loader2, X, Key } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDatabaseStore, SavedConnection } from '../store/databaseStore';

export const WelcomeConnectionManager = () => {
  const { 
    savedConnections, 
    setActiveConnection, 
    setShowConnectionModal,
    setPrefilledConfig,
    removeConnection
  } = useDatabaseStore();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Password prompt state
  const [passwordPrompt, setPasswordPrompt] = useState<{
    visible: boolean;
    connection: SavedConnection | null;
    password: string;
  }>({ visible: false, connection: null, password: '' });
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    connection: SavedConnection | null;
  }>({ visible: false, x: 0, y: 0, connection: null });

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

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    if (contextMenu.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.visible]);

  const filteredConnections = savedConnections.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.type.toLowerCase().includes(search.toLowerCase())
  );

  // Initiate connection - show password prompt for non-SQLite
  const handleConnect = (conn: SavedConnection) => {
    setError(null);
    if (conn.type === 'Sqlite') {
      // SQLite doesn't need password
      performConnect(conn, null);
    } else {
      // Show password prompt for Postgres/MySQL
      setPasswordPrompt({ visible: true, connection: conn, password: '' });
    }
  };

  // Actually perform the connection
  const performConnect = async (conn: SavedConnection, password: string | null) => {
    setConnectingId(conn.id);
    setError(null);
    setPasswordPrompt({ visible: false, connection: null, password: '' });
    
    try {
      // Build config for backend
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
      
      // Call backend connect with password
      await invoke('connect', { config, password });
      
      // Set active connection in store
      setActiveConnection(conn.id);
    } catch (err: any) {
      console.error('Connection failed:', err);
      setError(`Failed to connect: ${err.toString()}`);
    } finally {
      setConnectingId(null);
    }
  };


  const handleContextMenu = (e: React.MouseEvent, conn: SavedConnection) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      connection: conn
    });
  };

  const handleEdit = () => {
    if (contextMenu.connection) {
      // Pre-fill modal with connection config
      setPrefilledConfig({
        db_type: contextMenu.connection.type,
        host: contextMenu.connection.host,
        port: contextMenu.connection.port,
        username: contextMenu.connection.username,
        database: contextMenu.connection.database,
        ssl_enabled: contextMenu.connection.ssl_enabled,
      });
      setShowConnectionModal(true);
    }
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  const handleDelete = () => {
    if (contextMenu.connection) {
      removeConnection(contextMenu.connection.id);
    }
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  const getConnectionInfo = (conn: SavedConnection) => {
    if (conn.type === 'Sqlite') {
      return conn.database || 'No file selected';
    }
    const host = conn.host || 'localhost';
    const port = conn.port || (conn.type === 'Postgres' ? 5432 : 3306);
    return `${host}:${port}`;
  };


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
              onDoubleClick={() => handleConnect(conn)}
              onContextMenu={(e) => handleContextMenu(e, conn)}
              className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-[#2C2C2C] cursor-default border border-transparent hover:border-white/5 transition-all group"
            >
              {/* Type Badge with color */}
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold"
                style={{
                  backgroundColor: `var(--color-${conn.color || 'blue'}-500, #3b82f6)20`,
                  color: `var(--color-${conn.color || 'blue'}-500, #3b82f6)`
                }}
              >
                {conn.type.substring(0, 2)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary group-hover:text-white truncate">
                    {conn.name}
                  </span>
                  {conn.environment && (
                    <span className="px-1.5 py-0.5 bg-[#00d1b2]/10 text-[#00d1b2] text-[9px] font-bold rounded uppercase tracking-wider">
                      {conn.environment}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-text-muted flex items-center gap-2 mt-0.5">
                  <span className="truncate">{getConnectionInfo(conn)}</span>
                  {conn.database && conn.type !== 'Sqlite' && (
                    <span className="text-text-muted/50">• {conn.database}</span>
                  )}
                </div>
              </div>

              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleContextMenu(e, conn); }}
                  className="p-1 text-text-muted hover:text-white rounded hover:bg-[#3C3C3C]"
                >
                  <MoreHorizontal size={14} />
                </button>
                <button 
                  onClick={() => handleConnect(conn)}
                  disabled={connectingId === conn.id}
                  className="p-1 px-2 text-[10px] bg-[#3C3C3C] text-text-muted hover:text-white rounded border border-white/5 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {connectingId === conn.id ? (
                    <><Loader2 size={10} className="animate-spin" /> Connecting...</>
                  ) : (
                    <>Connect <ExternalLink size={10} /></>
                  )}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full opacity-30 select-none">
            <Search size={48} strokeWidth={1} />
            <p className="text-sm mt-4">
              {savedConnections.length === 0 
                ? 'No saved connections yet. Create one to get started!'
                : 'No connections found matching your search'
              }
            </p>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mb-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded animate-in slide-in-from-top-1">
          {error}
        </div>
      )}

      {/* Password Prompt Modal */}
      {passwordPrompt.visible && passwordPrompt.connection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl w-[380px] animate-in zoom-in-95 duration-200">
            {/* Header */}
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
            
            {/* Content */}
            <div className="p-4 space-y-4">
              <p className="text-[12px] text-text-muted">
                Enter password for <span className="text-white font-medium">{passwordPrompt.connection.name}</span>
              </p>
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
            
            {/* Footer */}
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
      {contextMenu.visible && (
        <div 
          className="fixed z-50 bg-[#252526] border border-[#3C3C3C] rounded-md shadow-xl py-1 min-w-[150px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button 
            onClick={handleEdit}
            className="w-full px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-[#3C3C3C] flex items-center gap-2"
          >
            <Pencil size={12} /> Edit
          </button>
          <div className="h-px bg-[#3C3C3C] my-1" />
          <button 
            onClick={handleDelete}
            className="w-full px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-[#3C3C3C] flex items-center gap-2"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}

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
