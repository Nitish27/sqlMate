import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Database, Terminal, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { useDatabaseStore } from '../store/databaseStore';

const cn = (...inputs: any[]) => twMerge(clsx(inputs));

export const ConnectionModal = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
  const [selectedType, setSelectedType] = useState<'Postgres' | 'MySql' | 'Sqlite'>('Postgres');
  const [name, setName] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('5432');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  
  // Advanced Metadata
  const [color, setColor] = useState('blue');
  const [tag, setTag] = useState<string>('local');

  // SSH Fields
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('');
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>('password');
  const [sshPass, setSshPass] = useState('');
  const [sshKey, setSshKey] = useState('');

  // SSL Fields
  const [sslEnabled, setSslEnabled] = useState(false);
  const [sslMode, setSslMode] = useState('prefer');
  const [sslCA, setSslCA] = useState('');
  const [sslCert, setSslCert] = useState('');
  const [sslKey, setSslKey] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [importUrl, setImportUrl] = useState('');

  const { setActiveConnection, addConnection, prefilledConfig, setPrefilledConfig, connectionModalMode, setConnectionModalMode } = useDatabaseStore();
  const [testStatus, setTestStatus] = useState<'success' | 'error' | null>(null);

  const resetForm = () => {
    setSelectedType('Postgres');
    setName('');
    setHost('127.0.0.1');
    setPort('5432');
    setUser('');
    setPassword('');
    setDatabase('');
    setColor('blue');
    setTag('local');
    setSshEnabled(false);
    setSshHost('');
    setSshPort('22');
    setSshUser('');
    setSshAuth('password');
    setSshPass('');
    setSshKey('');
    setSslEnabled(false);
    setSslMode('prefer');
    setSslCA('');
    setSslCert('');
    setSslKey('');
    setLoading(false);
    setError(null);
    setShowImportUrl(false);
    setImportUrl('');
    setTestStatus(null);
  };

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  // Sync with connectionModalMode from store
  useEffect(() => {
    if (open && connectionModalMode === 'url') {
      setShowImportUrl(true);
      setConnectionModalMode('manual');
    }
  }, [open, connectionModalMode, setConnectionModalMode]);

  // Sync with prefilledConfig from store
  useEffect(() => {
    if (prefilledConfig && open) {
      if (prefilledConfig.db_type) setSelectedType(prefilledConfig.db_type);
      if (prefilledConfig.host) setHost(prefilledConfig.host);
      if (prefilledConfig.port) setPort(prefilledConfig.port.toString());
      if (prefilledConfig.username) setUser(prefilledConfig.username);
      if (prefilledConfig.password) setPassword(prefilledConfig.password);
      if (prefilledConfig.database) setDatabase(prefilledConfig.database);
      if (prefilledConfig.ssl_enabled) setSslEnabled(true);
      
      // Clear after consuming
      setPrefilledConfig(null);
    }
  }, [prefilledConfig, open, setPrefilledConfig]);

  const getConfig = () => ({
    id: uuidv4(),
    name: name || 'Untitled Connection',
    db_type: selectedType,
    host: selectedType === 'Sqlite' ? null : host,
    port: selectedType === 'Sqlite' ? null : parseInt(port),
    username: selectedType === 'Sqlite' ? null : user,
    database: database,
    ssl_enabled: sslEnabled,
    ssl_mode: sslMode,
    ssl_ca_path: sslCA || null,
    ssl_cert_path: sslCert || null,
    ssl_key_path: sslKey || null,
    ssh_enabled: sshEnabled,
    ssh_host: sshHost || null,
    ssh_port: sshEnabled ? parseInt(sshPort) : null,
    ssh_username: sshUser || null,
    ssh_auth_method: sshAuth,
    ssh_password: sshPass || null,
    ssh_private_key_path: sshKey || null,
    environment: tag,
    color_tag: color,
  });

  const handleUrlImport = async () => {
    const { parseConnectionUrl } = await import('../utils/urlParser');
    const parsed = parseConnectionUrl(importUrl);
    if (!parsed) {
      setError("Invalid connection URL format");
      return;
    }

    // Apply parsed values
    if (parsed.db_type) setSelectedType(parsed.db_type);
    if (parsed.host) setHost(parsed.host);
    if (parsed.port) setPort(parsed.port.toString());
    if (parsed.username) setUser(parsed.username);
    if (parsed.password) setPassword(parsed.password);
    if (parsed.database) setDatabase(parsed.database);
    if (parsed.ssl_enabled) setSslEnabled(true);

    setShowImportUrl(false);
    setImportUrl('');
    setError(null);
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setTestStatus(null);
    setError(null);
    try {
      await invoke('test_connection', { config: getConfig(), password: password || null });
      setTestStatus('success');
    } catch (err: any) {
      console.error(err);
      setTestStatus('error');
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    setTestStatus(null);
    try {
      const config = getConfig();
      await invoke('connect', { config, password: password || null });
      
      // Add to saved connections (convert null to undefined for type compatibility)
      addConnection({
        id: config.id,
        name: config.name,
        type: config.db_type,
        host: config.host || undefined,
        port: config.port || undefined,
        username: config.username || undefined,
        database: config.database || undefined,
        ssl_enabled: config.ssl_enabled,
        ssl_mode: config.ssl_mode,
        ssl_ca_path: sslCA || undefined,
        ssl_cert_path: sslCert || undefined,
        ssl_key_path: sslKey || undefined,
        ssh_enabled: config.ssh_enabled,
        ssh_host: config.ssh_host || undefined,
        ssh_port: config.ssh_port || undefined,
        ssh_username: config.ssh_username || undefined,
        ssh_auth_method: config.ssh_auth_method,
        ssh_password: undefined, // Don't persist passwords
        ssh_private_key_path: sshKey || undefined,
        environment: tag as any,
        color: color,
      });

      setActiveConnection(config.id);
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  const pickFile = async (setter: (val: string) => void) => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
    });
    if (selected && typeof selected === 'string') {
      setter(selected);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[600px] max-h-[90vh] bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl z-50 focus:outline-none animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[#333] shrink-0">
             <div className="flex items-center gap-2">
               <div className={cn("w-3 h-3 rounded-sm shadow-sm", {
                 'bg-gray-400': color === 'gray',
                 'bg-blue-500': color === 'blue',
                 'bg-orange-500': color === 'orange',
                 'bg-green-500': color === 'green',
                 'bg-red-500': color === 'red',
                 'bg-purple-500': color === 'purple',
               })} />
               <Dialog.Title className="text-sm font-semibold text-white">
                 {selectedType} Connection
               </Dialog.Title>
             </div>
             <Dialog.Close className="text-gray-400 hover:text-white transition-colors">
               <X size={16} />
             </Dialog.Close>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Sidebar with DB types */}
            <div className="w-44 bg-[#1a1a1a] border-r border-[#333] p-3 flex flex-col gap-1">
               <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-2">Drivers</h3>
               {[
                 { id: 'Postgres', name: 'PostgreSQL', icon: Database },
                 { id: 'MySql', name: 'MySQL', icon: Database },
                 { id: 'Sqlite', name: 'SQLite', icon: Terminal },
               ].map((type) => (
                 <button
                   key={type.id}
                   onClick={() => {
                     setSelectedType(type.id as any);
                     if (type.id === 'Postgres') setPort('5432');
                     if (type.id === 'MySql') setPort('3306');
                   }}
                   className={cn(
                     "flex items-center gap-2 px-3 py-1.5 rounded text-[13px] transition-all",
                     selectedType === type.id ? "bg-[#333] text-white shadow-sm" : "text-gray-400 hover:bg-[#252525]"
                   )}
                 >
                   <type.icon size={13} />
                   {type.name}
                 </button>
               ))}

               <div className="mt-auto pt-4 flex flex-col gap-2">
                 <button
                   onClick={() => {
                     setShowImportUrl(!showImportUrl);
                     setError(null);
                   }}
                   className={cn(
                     "flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-bold transition-all",
                     showImportUrl ? "bg-accent/20 text-accent" : "text-gray-500 hover:text-gray-300"
                   )}
                 >
                   Import from URL
                 </button>
                 <div className="border-t border-[#333] pt-2">
                   <button className="w-full text-left px-3 py-1 text-[11px] text-gray-500 hover:text-gray-300">New Group</button>
                 </div>
               </div>
            </div>

            {/* Form Area or URL Import Area */}
            <div className="flex-1 flex flex-col overflow-y-auto bg-[#1e1e1e]">
              {showImportUrl ? (
                <div className="p-8 flex flex-col gap-6 animate-in slide-in-from-right-4 duration-300">
                  <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-white">Import from URL</h2>
                    <p className="text-xs text-text-muted leading-relaxed">
                      Paste a standard database connection string (e.g., <code className="text-accent/80">postgres://user:pass@host:port/db</code>). 
                      The form will be automatically populated based on the URL provided.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-left block">Connection URL</label>
                      <textarea 
                        className="w-full h-32 bg-[#1a1a1a] border border-[#333] rounded-lg p-3 text-[13px] text-white focus:outline-none focus:border-accent/40 focus:bg-[#252526] transition-all overflow-hidden resize-none font-mono"
                        placeholder="postgres://user:password@localhost:5432/mydb"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        autoFocus
                      />
                    </div>

                    {error && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded animate-in slide-in-from-top-1">
                        {error}
                      </div>
                    )}

                    <div className="flex justify-end gap-3 mt-4">
                      <button 
                        onClick={() => {
                          setShowImportUrl(false);
                          setError(null);
                        }}
                        className="px-4 py-2 text-xs text-gray-400 hover:bg-[#2a2a2a] rounded transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleUrlImport}
                        disabled={!importUrl.trim()}
                        className="px-6 py-2 text-xs bg-accent text-white font-bold rounded hover:bg-accent/90 transition-all shadow-lg disabled:opacity-50"
                      >
                        Import Connection
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 space-y-5 animate-in fade-in duration-300">
                  {error && (
                    <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded animate-in slide-in-from-top-1">
                      {error}
                    </div>
                  )}
                  {testStatus === 'success' && (
                    <div className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 p-2 rounded animate-in slide-in-from-top-1">
                      Connection Test Successful!
                    </div>
                  )}
                  
                  {/* Visual Metadata Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Name</label>
                      <input 
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none transition-all"
                        placeholder="My Database"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Status color / Tag</label>
                      <div className="flex items-center gap-2 h-[34px]">
                        <div className="flex gap-1.5 bg-[#252525] p-1 rounded border border-[#333]">
                          {['gray', 'blue', 'orange', 'green', 'red', 'purple'].map((c) => (
                            <button
                              key={c}
                              onClick={() => setColor(c)}
                              className={cn(
                                "w-4 h-4 rounded-sm transition-transform hover:scale-110",
                                {
                                  'bg-gray-400': c === 'gray',
                                  'bg-blue-500': c === 'blue',
                                  'bg-orange-500': c === 'orange',
                                  'bg-green-500': c === 'green',
                                  'bg-red-500': c === 'red',
                                  'bg-purple-500': c === 'purple',
                                  'ring-1 ring-white ring-offset-1 ring-offset-[#252525]': color === c
                                }
                              )}
                            />
                          ))}
                        </div>
                        <select 
                          value={tag}
                          onChange={(e) => setTag(e.target.value)}
                          className="bg-[#252525] border border-[#333] rounded px-2 py-1.5 text-xs text-white focus:outline-none appearance-none flex-1"
                        >
                          <option value="local">local</option>
                          <option value="test">test</option>
                          <option value="dev">dev</option>
                          <option value="staging">staging</option>
                          <option value="production">production</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Connection Core Fields */}
                  {selectedType !== 'Sqlite' ? (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Host/Socket</label>
                          <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="127.0.0.1" value={host} onChange={(e) => setHost(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Port</label>
                          <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="5432" value={port} onChange={(e) => setPort(e.target.value)} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">User</label>
                          <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" value={user} onChange={(e) => setUser(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Password</label>
                          <input type="password" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Database</label>
                        <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="postgres" value={database} onChange={(e) => setDatabase(e.target.value)} />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Database File Path</label>
                      <div className="flex gap-2">
                        <input className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="/path/to/db.sqlite" value={database} onChange={(e) => setDatabase(e.target.value)} />
                        <button onClick={() => pickFile(setDatabase)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Open...</button>
                      </div>
                    </div>
                  )}

                  {/* Over SSH Section */}
                  {selectedType !== 'Sqlite' && (
                    <div className="space-y-3 pt-2">
                      <button 
                        onClick={() => setSshEnabled(!sshEnabled)}
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-bold uppercase transition-colors px-3 py-1 rounded-full border",
                          sshEnabled ? "bg-blue-500/10 border-blue-500/50 text-blue-400" : "bg-transparent border-[#333] text-gray-500 hover:text-gray-300"
                        )}
                      >
                        {sshEnabled ? "SSH Enabled" : "Over SSH"}
                      </button>

                      {sshEnabled && (
                        <div className="p-4 bg-[#1a1a1a] border border-[#333] rounded-md space-y-4 animate-in slide-in-from-top-2">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Host</label>
                              <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Port</label>
                              <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH User</label>
                              <input className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Auth</label>
                              <select value={sshAuth} onChange={(e) => setSshAuth(e.target.value as any)} className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white outline-none">
                                <option value="password">Password</option>
                                <option value="key">Private Key</option>
                              </select>
                            </div>
                          </div>
                          {sshAuth === 'password' ? (
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Password</label>
                              <input type="password" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshPass} onChange={(e) => setSshPass(e.target.value)} />
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Private Key</label>
                              <div className="flex gap-2">
                                <input className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
                                <button onClick={() => pickFile(setSshKey)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Key...</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SSL Mode Settings */}
                  {selectedType !== 'Sqlite' && (
                    <div className="space-y-3 pt-2">
                      <button 
                        onClick={() => setSslEnabled(!sslEnabled)}
                        className={cn(
                          "flex items-center gap-2 text-[11px] font-bold uppercase transition-colors px-3 py-1 rounded-full border",
                          sslEnabled ? "bg-purple-500/10 border-purple-500/50 text-purple-400" : "bg-transparent border-[#333] text-gray-500 hover:text-gray-300"
                        )}
                      >
                        {sslEnabled ? "SSL Enabled" : "Settings (SSL)"}
                      </button>

                      {sslEnabled && (
                        <div className="p-4 bg-[#1a1a1a] border border-[#333] rounded-md space-y-4 animate-in slide-in-from-top-2">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSL Mode</label>
                            <select value={sslMode} onChange={(e) => setSslMode(e.target.value)} className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white outline-none">
                              <option value="disable">Disable</option>
                              <option value="prefer">Preferred</option>
                              <option value="require">Required</option>
                              <option value="verify-ca">Verify-CA</option>
                              <option value="verify-full">Verify-Full</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">CA Cert</label>
                              <div className="flex gap-2">
                                <input className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslCA} onChange={(e) => setSslCA(e.target.value)} />
                                <button onClick={() => pickFile(setSslCA)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">CA...</button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Client Cert</label>
                                <div className="flex gap-2">
                                  <input className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslCert} onChange={(e) => setSslCert(e.target.value)} />
                                  <button onClick={() => pickFile(setSslCert)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Cert...</button>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Client Key</label>
                                <div className="flex gap-2">
                                  <input className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslKey} onChange={(e) => setSslKey(e.target.value)} />
                                  <button onClick={() => pickFile(setSslKey)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Key...</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-[#1a1a1a] border-t border-[#333] flex items-center justify-between">
            <button 
              onClick={handleTestConnection}
              className="px-4 py-1.5 text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-2" 
              disabled={loading}
            >
              {loading && testStatus === null ? <Loader2 size={12} className="animate-spin" /> : null}
              Test Connection
            </button>
            <div className="flex items-center gap-3">
               <Dialog.Close className="px-4 py-1.5 text-xs text-gray-400 hover:bg-[#2a2a2a] rounded transition-colors" disabled={loading}>Cancel</Dialog.Close>
               <button 
                onClick={handleConnect}
                disabled={loading}
                className="px-6 py-1.5 text-xs bg-accent text-white font-bold rounded hover:bg-accent/90 transition-all shadow-lg flex items-center gap-2"
               >
                 {loading && <Loader2 size={12} className="animate-spin" />}
                 {loading ? 'Connecting...' : 'Connect'}
               </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
