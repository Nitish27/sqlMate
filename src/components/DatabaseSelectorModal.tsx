import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, Check, Database, Loader2, Plus, Search, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDatabaseStore } from '../store/databaseStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { invokeWithExecutionPolicy } from '../utils/executionPolicy';
import { filterDatabases, moveDatabaseSelection } from '../utils/databasePicker';
import { parseRowDraftContext } from '../utils/rowDrafts';
import { cn } from '../utils/cn';

export const DatabaseSelectorModal = () => {
  const showDatabaseSelector = useDatabaseStore(state => state.showDatabaseSelector);
  const setShowDatabaseSelector = useDatabaseStore(state => state.setShowDatabaseSelector);
  const activeConnectionId = useDatabaseStore(state => state.activeConnectionId);
  const activeDatabase = useDatabaseStore(state => state.activeDatabase);
  const setActiveDatabase = useDatabaseStore(state => state.setActiveDatabase);
  const setDatabases = useDatabaseStore(state => state.setDatabases);
  const savedConnections = useDatabaseStore(state => state.savedConnections);
  const drafts = useRecoveryStore(state => state.drafts);

  const [databases, setListedDatabases] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredDatabases = filterDatabases(databases, search);
  const selectedDatabase = filteredDatabases[selectedIndex];
  const canCreateDatabase = !['Sqlite', 'DuckDb'].includes(savedConnections.find(connection => connection.id === activeConnectionId)?.type || '');

  useEffect(() => {
    if (!showDatabaseSelector || !activeConnectionId) return;

    let current = true;
    setSearch('');
    setSelectedIndex(0);
    setIsCreating(false);
    setNewDbName('');
    setError(null);
    setListedDatabases([]);
    setIsLoading(true);

    invoke<string[]>('get_databases', { connectionId: activeConnectionId })
      .then(result => {
        if (!current) return;
        setListedDatabases(result);
        setDatabases(result);
        setSelectedIndex(Math.max(0, result.indexOf(activeDatabase || '')));
      })
      .catch(cause => {
        if (current) setError(`Could not load databases: ${String(cause)}`);
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });

    return () => { current = false; };
  }, [showDatabaseSelector, activeConnectionId, activeDatabase, setDatabases]);

  useEffect(() => {
    if (showDatabaseSelector && !isCreating && !isLoading) {
      listRef.current?.querySelector(`[data-picker-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [showDatabaseSelector, isCreating, isLoading, selectedIndex, search, databases]);

  const handleClose = () => {
    if (!isSubmitting) setShowDatabaseSelector(false);
  };

  const confirmSwitchAway = () => {
    const hasDrafts = drafts.some(draft => {
      const context = parseRowDraftContext(draft.context);
      return draft.change_count > 0 && context?.[0] === activeConnectionId && context[1] === activeDatabase;
    });
    return !hasDrafts || window.confirm('Switching databases will close this connection\'s table tabs. Pending row edits are preserved as drafts, but must be reviewed when you return. Switch anyway?');
  };

  const handleSelect = async (database: string) => {
    if (isSubmitting || !activeConnectionId) return;
    if (database === activeDatabase) {
      handleClose();
      return;
    }

    if (!confirmSwitchAway()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await setActiveDatabase(database);
      setShowDatabaseSelector(false);
    } catch (cause) {
      setError(`Could not open ${database}: ${String(cause)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    const name = newDbName.trim();
    if (!name || !activeConnectionId || isSubmitting || !canCreateDatabase) return;
    if (databases.some(database => database.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError('A database with this name already exists.');
      return;
    }
    if (!confirmSwitchAway()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await invokeWithExecutionPolicy('create_database', activeConnectionId, activeDatabase || '',
        { kind: 'create_database', payload: name }, { dbName: name });
      const updated = await invoke<string[]>('get_databases', { connectionId: activeConnectionId });
      setDatabases(updated);
      await setActiveDatabase(name);
      useDatabaseStore.getState().triggerRefresh(true);
      setShowDatabaseSelector(false);
    } catch (cause) {
      setError(`Could not create database: ${String(cause)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handleClose();
      return;
    }
    if (isCreating) {
      if (event.key === 'Enter' && event.target === inputRef.current) {
        event.preventDefault();
        void handleCreate();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(index => moveDatabaseSelection(index, filteredDatabases.length, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && event.target === inputRef.current && selectedDatabase) {
      event.preventDefault();
      void handleSelect(selectedDatabase);
    }
  };

  if (!showDatabaseSelector || !activeConnectionId) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={event => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="database-picker-title" onKeyDown={handleKeyDown}
        className="flex h-[min(72vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-strong bg-surface text-text-primary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-strong px-4 py-3">
          <h2 id="database-picker-title" className="flex items-center gap-2 text-sm font-semibold">
            <Database size={16} className="text-accent" />
            {isCreating ? 'New Database' : 'Open Database'}
          </h2>
          <button type="button" onClick={handleClose} disabled={isSubmitting} aria-label="Close database picker"
            className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-border-strong p-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input ref={inputRef} autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="none"
              aria-label={isCreating ? 'New database name' : 'Search databases'}
              value={isCreating ? newDbName : search}
              onChange={event => {
                if (isCreating) setNewDbName(event.target.value);
                else {
                  setSearch(event.target.value);
                  setSelectedIndex(0);
                }
                setError(null);
              }}
              placeholder={isCreating ? 'Database name...' : 'Search for database...'}
              disabled={isSubmitting}
              className="w-full rounded-md border border-border-strong bg-background py-2 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-50" />
          </div>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
        </div>}

        {isCreating ? (
          <div className="flex-1 px-4 py-5 text-sm text-text-secondary">
            Create a database in the current connection. Write protection may require confirmation.
          </div>
        ) : (
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1 custom-scrollbar" aria-label="Databases">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />Loading databases...</div>
            ) : filteredDatabases.length ? filteredDatabases.map((database, index) => (
              <button key={database} type="button" data-picker-index={index} onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => void handleSelect(database)} disabled={isSubmitting}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleSelect(database);
                  }
                }}
                aria-current={database === activeDatabase ? 'true' : undefined}
                aria-pressed={index === selectedIndex}
                className={cn('flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors disabled:opacity-50',
                  index === selectedIndex ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary')}>
                <Database size={16} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{database}</span>
                {database === activeDatabase && <Check size={16} aria-label="Current database" />}
              </button>
            )) : (
              <div className="px-4 py-12 text-center text-sm text-text-muted">
                {error ? 'Database list unavailable.' : 'No databases found.'}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border-strong bg-background px-3 py-2">
          <button type="button" onClick={isCreating ? () => { setIsCreating(false); setError(null); inputRef.current?.focus(); } : handleClose}
            disabled={isSubmitting} className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover disabled:opacity-50">
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {!isCreating && canCreateDatabase && <button type="button" onClick={() => { setIsCreating(true); setNewDbName(''); setError(null); inputRef.current?.focus(); }}
              className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover">
              <Plus size={13} /> New...
            </button>}
            <button type="button" onClick={() => void (isCreating ? handleCreate() : selectedDatabase && handleSelect(selectedDatabase))}
              disabled={isSubmitting || (isCreating ? !newDbName.trim() : isLoading || !selectedDatabase)}
              className="flex min-w-20 items-center justify-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">
              {isSubmitting && <Loader2 size={13} className="animate-spin" />}
              {isCreating ? 'Create' : 'Open'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
