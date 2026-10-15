import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Database, Terminal, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { useDatabaseStore } from '../store/databaseStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { parseRowDraftContext } from '../utils/rowDrafts';
import { connectionTargetChanged } from '../utils/connectionTarget';
import { connectionIdentity, safetyModeDescription } from '../utils/connectionClarity';
import { aiAccessAfterEnvironmentChange, effectiveAiAccess } from '../utils/aiConnectionPolicy';

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

  const [loading, setLoading] = useState<'test' | 'connect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [previouslyRemembered, setPreviouslyRemembered] = useState(false);
  const [safetyMode, setSafetyMode] = useState<'Silent' | 'Alert' | 'Safe'>('Silent');
  const [safetyModeTouched, setSafetyModeTouched] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);

  const { setActiveConnection, addConnection, updateConnection, savedConnections, tabs, prefilledConfig, setPrefilledConfig, connectionModalMode, setConnectionModalMode } = useDatabaseStore();
  const drafts = useRecoveryStore(state => state.drafts);
  const [testStatus, setTestStatus] = useState<{ result: 'success' | 'error'; fingerprint: string; target: string; message?: string } | null>(null);
  const testFingerprint = JSON.stringify([editingId, selectedType, tag, host, port, user, password, database, rememberCredentials, sshEnabled, sshHost, sshPort, sshUser, sshAuth, sshPass, sshKey, sslEnabled, sslMode, sslCA, sslCert, sslKey]);
  const currentTestStatus = testStatus?.fingerprint === testFingerprint ? testStatus : null;
  const identity = connectionIdentity({ name, type: selectedType, environment: tag, host, port: Number(port), database });
  const previousEnvironment = editingId ? savedConnections.find(connection => connection.id === editingId)?.environment : undefined;
  const pendingProductionTransition = Boolean(editingId && previousEnvironment !== 'production' && tag === 'production');

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
    setLoading(null);
    setEditingId(null);
    setRememberCredentials(false);
    setPreviouslyRemembered(false);
    setSafetyMode('Silent');
    setSafetyModeTouched(false);
    setAiEnabled(true);
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
      setEditingId(prefilledConfig.id || null);
      setSelectedType(prefilledConfig.db_type || 'Postgres');
      setName(prefilledConfig.name || '');
      setHost(prefilledConfig.host || '127.0.0.1');
      setPort(String(prefilledConfig.port || (prefilledConfig.db_type === 'MySql' ? 3306 : 5432)));
      setUser(prefilledConfig.username || '');
      setDatabase(prefilledConfig.database || '');
      setColor(prefilledConfig.color_tag || 'blue');
      setTag(prefilledConfig.environment || 'local');
      setSshEnabled(Boolean(prefilledConfig.ssh_enabled));
      setSshHost(prefilledConfig.ssh_host || '');
      setSshPort(String(prefilledConfig.ssh_port || 22));
      setSshUser(prefilledConfig.ssh_username || '');
      setSshAuth(prefilledConfig.ssh_auth_method || 'password');
      setSshKey(prefilledConfig.ssh_private_key_path || '');
      setSslEnabled(Boolean(prefilledConfig.ssl_enabled));
      setSslMode(prefilledConfig.ssl_mode || 'prefer');
      setSslCA(prefilledConfig.ssl_ca_path || '');
      setSslCert(prefilledConfig.ssl_cert_path || '');
      setSslKey(prefilledConfig.ssl_key_path || '');
      setRememberCredentials(Boolean(prefilledConfig.rememberCredentials));
      setPreviouslyRemembered(Boolean(prefilledConfig.rememberCredentials));
      setSafetyMode(prefilledConfig.safety_mode || 'Silent');
      setAiEnabled(effectiveAiAccess(prefilledConfig.environment || 'local', prefilledConfig.ai_enabled));
      
      // Clear after consuming
      setPrefilledConfig(null);
    }
  }, [prefilledConfig, open, setPrefilledConfig]);

  const getConfig = () => ({
    id: editingId || uuidv4(),
    name: name || 'Untitled Connection',
    db_type: selectedType,
    host: selectedType === 'Sqlite' ? null : host,
    port: selectedType === 'Sqlite' ? null : parseInt(port),
    username: selectedType === 'Sqlite' ? null : user,
    database: database,
    ssl_enabled: selectedType !== 'Sqlite' && sslEnabled,
    ssl_mode: sslMode,
    ssl_ca_path: sslCA || null,
    ssl_cert_path: sslCert || null,
    ssl_key_path: sslKey || null,
    ssh_enabled: selectedType !== 'Sqlite' && sshEnabled,
    ssh_host: selectedType !== 'Sqlite' && sshEnabled ? sshHost || null : null,
    ssh_port: selectedType !== 'Sqlite' && sshEnabled ? parseInt(sshPort) : null,
    ssh_username: selectedType !== 'Sqlite' && sshEnabled ? sshUser || null : null,
    ssh_auth_method: sshAuth,
    ssh_password: selectedType !== 'Sqlite' && sshEnabled ? sshPass || null : null,
    ssh_private_key_path: selectedType !== 'Sqlite' && sshEnabled ? sshKey || null : null,
    environment: tag,
    color_tag: color,
    safety_mode: safetyMode,
    ai_enabled: aiEnabled,
  });

  const validateForm = (): string | null => {
    if (!database.trim()) return selectedType === 'Sqlite' ? 'Choose a database file.' : 'Enter a database name.';
    if (selectedType !== 'Sqlite') {
      if (!host.trim()) return 'Enter a database host.';
      if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return 'Enter a valid database port (1-65535).';
      if (!user.trim()) return 'Enter a database user.';
      if (sshEnabled) {
        if (!sshHost.trim() || !sshUser.trim()) return 'Enter an SSH host and user.';
        if (!Number.isInteger(Number(sshPort)) || Number(sshPort) < 1 || Number(sshPort) > 65535) return 'Enter a valid SSH port (1-65535).';
        if (sshAuth === 'key' && !sshKey.trim()) return 'Choose an SSH private key.';
      }
      if (sslEnabled && Boolean(sslCert) !== Boolean(sslKey)) return 'Choose both a client certificate and private key.';
      if (sslEnabled && sshEnabled && sslMode === 'verify-full') return 'Verify-full is not supported over SSH forwarding. Use verify-ca or connect directly.';
    }
    return null;
  };

  const targetCandidate = (previous: typeof savedConnections[number]) => ({
    ...previous, type: selectedType, host, port: Number(port), username: user,
    database, ssh_enabled: selectedType !== 'Sqlite' && sshEnabled,
    ssh_host: sshHost, ssh_port: Number(sshPort), ssh_username: sshUser,
    ssh_auth_method: sshAuth, ssh_private_key_path: sshKey,
  });

  const canSaveMetadataOnly = (previous: typeof savedConnections[number] | undefined): boolean => {
    if (!previous || password || sshPass || connectionTargetChanged(previous, targetCandidate(previous))) return false;
    if (Boolean(previous.rememberCredentials) !== (selectedType !== 'Sqlite' && rememberCredentials)) return false;
    if (Boolean(previous.ssl_enabled) !== (selectedType !== 'Sqlite' && sslEnabled)) return false;
    if (!sslEnabled || selectedType === 'Sqlite') return true;
    return (previous.ssl_mode || 'prefer') === sslMode
      && (previous.ssl_ca_path || '') === sslCA
      && (previous.ssl_cert_path || '') === sslCert
      && (previous.ssl_key_path || '') === sslKey;
  };

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
    setSslEnabled(Boolean(parsed.ssl_enabled));
    if (parsed.ssl_mode) setSslMode(parsed.ssl_mode);

    setShowImportUrl(false);
    setImportUrl('');
    setError(null);
  };

  const handleTestConnection = async () => {
    const validationError = validateForm();
    if (validationError) { setError(validationError); return; }
    setLoading('test');
    setTestStatus(null);
    setError(null);
    const fingerprint = testFingerprint;
    const target = identity.target;
    try {
      const shouldRemember = selectedType !== 'Sqlite' && rememberCredentials;
      await invoke('test_connection', { config: getConfig(), password: editingId && shouldRemember && !password ? null : password, rememberCredentials: shouldRemember });
      setTestStatus({ result: 'success', fingerprint, target });
    } catch (err: any) {
      console.error(err);
      setTestStatus({ result: 'error', fingerprint, target, message: String(err) });
    } finally {
      setLoading(null);
    }
  };

  const handleConnect = async () => {
    const validationError = validateForm();
    if (validationError) { setError(validationError); return; }
    const previous = editingId ? savedConnections.find(connection => connection.id === editingId) : null;
    if (previous) {
      const hasWorkspace = tabs.some(tab => tab.connectionId === editingId)
        || drafts.some(draft => parseRowDraftContext(draft.context)?.[0] === editingId);
      if (hasWorkspace && connectionTargetChanged(previous, targetCandidate(previous))) {
        setError('This connection has open tabs or pending row edits. Close its tabs and resolve drafts before changing its database target.');
        return;
      }
    }
    setLoading('connect');
    setError(null);
    setTestStatus(null);
    try {
      const config = getConfig();
      const shouldRemember = selectedType !== 'Sqlite' && rememberCredentials;
      const savedConnection = {
        id: config.id,
        name: config.name,
        type: config.db_type,
        host: config.host || undefined,
        port: config.port || undefined,
        username: config.username || undefined,
        database: config.database || undefined,
        ssl_enabled: config.ssl_enabled,
        ssl_mode: config.ssl_mode,
        ssl_ca_path: selectedType !== 'Sqlite' ? sslCA || undefined : undefined,
        ssl_cert_path: selectedType !== 'Sqlite' ? sslCert || undefined : undefined,
        ssl_key_path: selectedType !== 'Sqlite' ? sslKey || undefined : undefined,
        ssh_enabled: config.ssh_enabled,
        ssh_host: config.ssh_host || undefined,
        ssh_port: config.ssh_port || undefined,
        ssh_username: config.ssh_username || undefined,
        ssh_auth_method: config.ssh_auth_method,
        ssh_private_key_path: selectedType !== 'Sqlite' ? sshKey || undefined : undefined,
        environment: tag as 'local' | 'test' | 'dev' | 'staging' | 'production',
        color: color,
        safetyMode,
        aiEnabled,
        rememberCredentials: shouldRemember,
      };
      if (previous && canSaveMetadataOnly(previous)) {
        if (useDatabaseStore.getState().openConnectionIds.includes(previous.id)
          && safetyMode !== (previous.safetyMode || 'Silent')) {
          await invoke('set_connection_safety_mode', { connectionId: previous.id, mode: safetyMode });
        }
        if (useDatabaseStore.getState().openConnectionIds.includes(previous.id)) {
          savedConnection.aiEnabled = await invoke<boolean>('set_connection_ai_metadata', {
            connectionId: previous.id, environment: tag, aiEnabled,
          });
        }
        updateConnection(previous.id, savedConnection);
        onOpenChange(false);
        return;
      }
      await invoke('connect', {
        config,
        password: editingId && shouldRemember && !password ? null : password,
        rememberCredentials: shouldRemember,
        clearCredentials: editingId && previouslyRemembered && !shouldRemember,
      });
      if (editingId) updateConnection(editingId, savedConnection);
      else addConnection(savedConnection);

      setActiveConnection(config.id);
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      if (editingId && String(err).includes('CREDENTIAL_STORAGE_FAILED')) {
        await useDatabaseStore.getState().closeConnectionFromRail(editingId, true);
      }
      setError(err.toString());
    } finally {
      setLoading(null);
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
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(650px,calc(100vw-2rem))] h-[600px] max-h-[90vh] bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl z-50 focus:outline-none animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col">
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
                 {editingId ? 'Edit' : 'New'} {selectedType} Connection
               </Dialog.Title>
             </div>
             <Dialog.Close aria-label="Close connection form" className="text-gray-400 hover:text-white transition-colors">
               <X size={16} />
             </Dialog.Close>
          </div>

          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            {/* Sidebar with DB types */}
            <div className="w-full sm:w-44 shrink-0 bg-[#1a1a1a] border-b sm:border-b-0 sm:border-r border-[#333] p-3 flex flex-row sm:flex-col gap-1 overflow-x-auto">
               <h3 className="hidden sm:block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 px-2">Drivers</h3>
               {[
                 { id: 'Postgres', name: 'PostgreSQL', icon: Database },
                 { id: 'MySql', name: 'MySQL', icon: Database },
                 { id: 'Sqlite', name: 'SQLite', icon: Terminal },
               ].map((type) => (
                 <button
                   key={type.id}
                   aria-pressed={selectedType === type.id}
                   onClick={() => {
                     if ((selectedType === 'Sqlite') !== (type.id === 'Sqlite')) setDatabase('');
                     setSelectedType(type.id as any);
                     if (type.id === 'Postgres') setPort('5432');
                     if (type.id === 'MySql') setPort('3306');
                   }}
                   className={cn(
                     "flex shrink-0 items-center gap-2 px-3 py-1.5 rounded text-[13px] transition-all",
                     selectedType === type.id ? "bg-[#333] text-white shadow-sm" : "text-gray-400 hover:bg-[#252525]"
                   )}
                 >
                   <type.icon size={13} />
                   {type.name}
                 </button>
               ))}

               <div className="sm:mt-auto sm:pt-4 flex flex-col gap-2 shrink-0">
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
                      <label htmlFor="connection-url" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-left block">Connection URL</label>
                      <textarea 
                        id="connection-url"
                        className="w-full h-32 bg-[#1a1a1a] border border-[#333] rounded-lg p-3 text-[13px] text-white focus:outline-none focus:border-accent/40 focus:bg-[#252526] transition-all overflow-hidden resize-none font-mono"
                        placeholder="postgres://user:password@localhost:5432/mydb"
                        value={importUrl}
                        onChange={(e) => setImportUrl(e.target.value)}
                        autoFocus
                      />
                    </div>

                    {error && (
                      <div role="alert" className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded animate-in slide-in-from-top-1">
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
                    <div role="alert" className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded animate-in slide-in-from-top-1">
                      {error}
                    </div>
                  )}
                  {currentTestStatus?.result === 'error' && (
                    <div role="alert" className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded">
                      Could not connect to {currentTestStatus.target}: {currentTestStatus.message}
                    </div>
                  )}
                  {currentTestStatus?.result === 'success' && (
                    <div role="status" className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 p-2 rounded animate-in slide-in-from-top-1">
                      Test passed for {currentTestStatus.target}. This did not save or open the connection.
                    </div>
                  )}
                  <div className="rounded border border-[#333] bg-[#242424] px-3 py-2 text-[11px] text-gray-300" aria-label="Connection target preview">
                    <span className="font-semibold text-white">{identity.environment}</span>
                    <span className="mx-2 text-gray-500">|</span>
                    <span className="break-all">{identity.target}</span>
                    <p className="mt-1 text-gray-500">Environment is a label you choose, not a verification of the server.</p>
                  </div>
                  
                  {/* Visual Metadata Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="connection-name" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Name</label>
                      <input 
                        id="connection-name"
                        className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none transition-all"
                        placeholder="My Database"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="connection-environment" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Environment / Color</label>
                      <div className="flex items-center gap-2 h-[34px]">
                        <div className="flex gap-1.5 bg-[#252525] p-1 rounded border border-[#333]">
                          {['gray', 'blue', 'orange', 'green', 'red', 'purple'].map((c) => (
                            <button
                              key={c}
                              aria-label={`${c} connection color`}
                              aria-pressed={color === c}
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
                          id="connection-environment"
                          value={tag}
                          onChange={(e) => {
                            setAiEnabled(current => aiAccessAfterEnvironmentChange(tag, e.target.value, current));
                            setTag(e.target.value);
                            if (!editingId && !safetyModeTouched) setSafetyMode(e.target.value === 'production' ? 'Alert' : 'Silent');
                          }}
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
                  {editingId && previouslyRemembered && (!rememberCredentials || selectedType === 'Sqlite') && (
                    <p className="text-[11px] text-amber-300">Saved keychain passwords will be removed. For server connections, re-enter passwords before connecting.</p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="space-y-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                      Write protection
                      <select value={safetyMode} onChange={(e) => { setSafetyMode(e.target.value as typeof safetyMode); setSafetyModeTouched(true); }} className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white normal-case">
                        <option value="Silent">Silent - no confirmation</option>
                        <option value="Alert">Alert - confirm queries and changes</option>
                        <option value="Safe">Safe - read-only SELECT</option>
                      </select>
                      <span className="block text-[11px] font-normal normal-case tracking-normal text-gray-500">{safetyModeDescription(safetyMode)}</span>
                    </label>
                    {selectedType !== 'Sqlite' && (
                      <label className="flex items-center gap-2 self-end min-h-[34px] text-xs text-gray-300 normal-case">
                        <input type="checkbox" checked={rememberCredentials} onChange={(e) => setRememberCredentials(e.target.checked)} />
                        Remember passwords in OS keychain
                      </label>
                    )}
                  </div>
                  <label className="flex items-start gap-2 rounded border border-[#333] bg-[#252525] px-3 py-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      disabled={pendingProductionTransition}
                      onChange={(event) => setAiEnabled(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Allow AI assistance for this connection
                      <span className="block mt-1 text-[11px] text-gray-500">
                        {pendingProductionTransition
                          ? 'Save the production tag first, then reopen this connection to explicitly enable AI.'
                          : 'AI may send schema details and prompts when you use it. Production connections require explicit opt-in.'}
                      </span>
                    </span>
                  </label>

                  {/* Connection Core Fields */}
                  {selectedType !== 'Sqlite' ? (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1.5">
                          <label htmlFor="connection-host" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Host</label>
                          <input id="connection-host" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="127.0.0.1" value={host} onChange={(e) => setHost(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="connection-port" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Port</label>
                          <input id="connection-port" inputMode="numeric" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="5432" value={port} onChange={(e) => setPort(e.target.value)} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label htmlFor="connection-user" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">User</label>
                          <input id="connection-user" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" value={user} onChange={(e) => setUser(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="connection-password" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Password</label>
                          <input id="connection-password" type="password" autoComplete="new-password" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="connection-database" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Database</label>
                        <input id="connection-database" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="postgres" value={database} onChange={(e) => setDatabase(e.target.value)} />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <label htmlFor="connection-file" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Database File Path</label>
                      <div className="flex gap-2">
                        <input id="connection-file" className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-sm text-white focus:border-blue-500" placeholder="/path/to/db.sqlite" value={database} onChange={(e) => setDatabase(e.target.value)} />
                        <button onClick={() => pickFile(setDatabase)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Open...</button>
                      </div>
                    </div>
                  )}

                  {/* Over SSH Section */}
                  {selectedType !== 'Sqlite' && (
                    <div className="space-y-3 pt-2">
                      <button 
                        onClick={() => setSshEnabled(!sshEnabled)}
                        aria-expanded={sshEnabled}
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
                              <label htmlFor="ssh-host" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Host</label>
                              <input id="ssh-host" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label htmlFor="ssh-port" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Port</label>
                              <input id="ssh-port" inputMode="numeric" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label htmlFor="ssh-user" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH User</label>
                              <input id="ssh-user" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label htmlFor="ssh-auth" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Auth</label>
                              <select id="ssh-auth" value={sshAuth} onChange={(e) => setSshAuth(e.target.value as any)} className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white outline-none">
                                <option value="password">Password</option>
                                <option value="key">Private Key</option>
                              </select>
                            </div>
                          </div>
                          {sshAuth === 'password' ? (
                            <div className="space-y-1.5">
                              <label htmlFor="ssh-password" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSH Password</label>
                              <input id="ssh-password" type="password" autoComplete="new-password" className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshPass} onChange={(e) => setSshPass(e.target.value)} />
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label htmlFor="ssh-key" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Private Key</label>
                              <div className="flex gap-2">
                                <input id="ssh-key" className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-xs text-white" value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
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
                        aria-expanded={sslEnabled}
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
                            <label htmlFor="ssl-mode" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">SSL Mode</label>
                            <select id="ssl-mode" value={sslMode} onChange={(e) => setSslMode(e.target.value)} className="w-full bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white outline-none">
                              <option value="disable">Disable</option>
                              <option value="prefer">Preferred</option>
                              <option value="require">Required</option>
                              <option value="verify-ca">Verify-CA</option>
                              <option value="verify-full">Verify-Full</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            <div className="space-y-1.5">
                              <label htmlFor="ssl-ca" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">CA Cert</label>
                              <div className="flex gap-2">
                                <input id="ssl-ca" className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslCA} onChange={(e) => setSslCA(e.target.value)} />
                                <button onClick={() => pickFile(setSslCA)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">CA...</button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <label htmlFor="ssl-cert" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Client Cert</label>
                                <div className="flex gap-2">
                                  <input id="ssl-cert" className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslCert} onChange={(e) => setSslCert(e.target.value)} />
                                  <button onClick={() => pickFile(setSslCert)} className="px-3 py-1.5 bg-[#333] text-xs text-gray-300 rounded hover:bg-[#444]">Cert...</button>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <label htmlFor="ssl-key" className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Client Key</label>
                                <div className="flex gap-2">
                                  <input id="ssl-key" className="flex-1 bg-[#252525] border border-[#333] rounded px-3 py-1.5 text-[11px] text-white" value={sslKey} onChange={(e) => setSslKey(e.target.value)} />
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
          <div className="p-4 bg-[#1a1a1a] border-t border-[#333] flex flex-wrap items-center justify-between gap-2">
            <div>
              <button
                onClick={handleTestConnection}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                disabled={Boolean(loading) || showImportUrl}
              >
                {loading === 'test' ? <Loader2 size={12} className="animate-spin" /> : null}
                {loading === 'test' ? 'Testing...' : 'Test Connection'}
              </button>
              <span className="block px-4 text-[10px] text-gray-500">Tests only; does not save.</span>
            </div>
            <div className="flex items-center gap-3">
               <Dialog.Close className="px-4 py-1.5 text-xs text-gray-400 hover:bg-[#2a2a2a] rounded transition-colors" disabled={Boolean(loading)}>Cancel</Dialog.Close>
               <button 
                onClick={handleConnect}
                disabled={Boolean(loading) || showImportUrl}
                className="px-6 py-1.5 text-xs bg-accent text-white font-bold rounded hover:bg-accent/90 transition-all shadow-lg flex items-center gap-2"
               >
                 {loading === 'connect' && <Loader2 size={12} className="animate-spin" />}
                 {loading === 'connect' ? 'Connecting...' : editingId ? (canSaveMetadataOnly(savedConnections.find(connection => connection.id === editingId)) ? 'Save Changes' : 'Save & Reconnect') : 'Save & Connect'}
               </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
