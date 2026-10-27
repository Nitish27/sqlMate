import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bookmark, Database, History, Layout, Loader2, Search, Server, Terminal, X } from 'lucide-react';
import { useDatabaseStore, type SidebarItem } from '../store/databaseStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { buildQuickOpenItems, resolveQuickOpenTarget, searchQuickOpenItems, type QuickOpenItem } from '../utils/quickOpen';
import { connectionTargetFingerprint } from '../utils/connectionTarget';
import { parseRowDraftContext } from '../utils/rowDrafts';
import { cn } from '../utils/cn';

interface QuickOpenModalProps {
  open: boolean;
  onClose: () => void;
}

interface QuickOpenMetadata {
  connectionId: string;
  database: string | null;
  databases: string[];
  items: SidebarItem[];
}

const itemIcons = {
  connection: Server,
  database: Database,
  table: Layout,
  tab: Terminal,
  saved: Bookmark,
  history: History,
};

export function QuickOpenModal({ open, onClose }: QuickOpenModalProps) {
  const state = useDatabaseStore();
  const drafts = useRecoveryStore(recovery => recovery.drafts);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metadata, setMetadata] = useState<QuickOpenMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeConnectionId = state.activeConnectionId;
  const activeDatabase = state.activeDatabase;

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedIndex(0);
    setMetadata(null);
    setError(null);
    setLoading(false);
    if (!activeConnectionId) return;

    let current = true;
    setLoading(true);
    Promise.allSettled([
      invoke<string[]>('get_databases', { connectionId: activeConnectionId }),
      invoke<SidebarItem[]>('get_sidebar_items', { connectionId: activeConnectionId }),
    ]).then(([databases, items]) => {
      if (!current) return;
      setMetadata({
        connectionId: activeConnectionId,
        database: activeDatabase,
        databases: databases.status === 'fulfilled' ? databases.value : [],
        items: items.status === 'fulfilled' ? items.value : [],
      });
      if (databases.status === 'rejected' || items.status === 'rejected') {
        setError('Some database objects could not be loaded. Other quick-open items are still available.');
      }
      setLoading(false);
    });
    return () => { current = false; };
  }, [open, activeConnectionId, activeDatabase]);

  const currentMetadata = metadata?.connectionId === activeConnectionId && metadata.database === activeDatabase ? metadata : null;
  const indexState = useMemo(() => ({
    ...state,
    databases: currentMetadata?.databases || [],
    sidebarItems: activeConnectionId ? { [activeConnectionId]: currentMetadata?.items || [] } : {},
  }), [state, currentMetadata, activeConnectionId]);
  const items = useMemo(() => buildQuickOpenItems(indexState), [indexState]);
  const results = useMemo(() => searchQuickOpenItems(items, search), [items, search]);
  const activeIndex = Math.min(selectedIndex, results.length - 1);

  const handleOpen = async (item: QuickOpenItem) => {
    if (busy) return;
    const currentState = useDatabaseStore.getState();
    const target = resolveQuickOpenTarget(item, {
      ...currentState,
      databases: currentMetadata?.databases || [],
      sidebarItems: currentState.activeConnectionId ? { [currentState.activeConnectionId]: currentMetadata?.items || [] } : {},
    });
    if (!target) {
      setError('That item is no longer available in this connection. Search again.');
      return;
    }

    const connection = currentState.savedConnections.find(saved => saved.id === target.connectionId);
    if (!connection) return;
    if (target.kind === 'saved') {
      const query = currentState.savedQueries.find(saved => saved.id === target.targetId);
      if (!query) return;
      if (query.targetFingerprint !== connectionTargetFingerprint(connection)
        && !window.confirm('This connection now points to a different database target. Open this saved SQL for review anyway? It will not run automatically.')) return;
    }
    if (target.kind === 'database' && target.database !== currentState.activeDatabase) {
      const hasDrafts = drafts.some(draft => {
        const context = parseRowDraftContext(draft.context);
        return draft.change_count > 0 && context?.[0] === target.connectionId && context[1] === currentState.activeDatabase;
      });
      if (hasDrafts && !window.confirm('Switching databases will close this connection\'s table tabs. Pending row edits are preserved as drafts, but must be reviewed when you return. Switch anyway?')) return;
    }

    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'connection') {
        currentState.selectConnection(target.connectionId);
      } else if (target.kind === 'database') {
        await currentState.setActiveDatabase(target.targetId);
      } else if (target.kind === 'table') {
        currentState.openTab({ type: 'table', title: target.title, tableName: target.targetId,
          connectionId: target.connectionId, database: target.database, viewMode: 'data' });
      } else if (target.kind === 'tab') {
        if (currentState.activeConnectionId !== target.connectionId) currentState.selectConnection(target.connectionId);
        useDatabaseStore.getState().setActiveTabId(target.targetId);
      } else if (target.kind === 'saved') {
        const query = currentState.savedQueries.find(saved => saved.id === target.targetId);
        if (!query) return;
        if (currentState.activeConnectionId !== target.connectionId) currentState.selectConnection(target.connectionId);
        useDatabaseStore.getState().openTab({ type: 'query', title: query.name, query: query.sql,
          savedQueryId: query.id, connectionId: query.connectionId, database: query.database });
      } else {
        const history = currentState.queryHistory.find(entry => entry.id === target.targetId);
        if (!history) return;
        if (currentState.activeConnectionId !== target.connectionId) currentState.selectConnection(target.connectionId);
        useDatabaseStore.getState().openTab({ type: 'query', title: 'Query', query: history.sql,
          connectionId: history.connectionId, database: history.database });
      }
      onClose();
    } catch (cause) {
      setError(`Could not open ${target.title}: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div role="dialog" aria-modal="true" aria-labelledby="quick-open-title" className="flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Search size={17} className="shrink-0 text-accent" />
        <h2 id="quick-open-title" className="sr-only">Quick Open</h2>
        <input
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          role="combobox"
          aria-label="Quick Open"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={activeIndex >= 0 ? `quick-open-option-${activeIndex}` : undefined}
          value={search}
          onChange={event => { setSearch(event.target.value); setSelectedIndex(0); }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex(index => Math.min(index + 1, results.length - 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex(index => Math.max(index - 1, 0)); }
            else if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); void handleOpen(results[activeIndex]); }
          }}
          placeholder="Find tables, databases, tabs, saved SQL..."
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        {loading && <Loader2 size={15} className="animate-spin text-text-muted" aria-label="Loading database objects" />}
        <button type="button" onClick={onClose} aria-label="Close Quick Open" className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"><X size={16} /></button>
      </div>
      {error && <p role="alert" className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}</p>}
      <div id="quick-open-results" role="listbox" aria-label="Quick Open results" className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        {results.length === 0 ? <div className="px-4 py-10 text-center text-xs text-text-muted">
          {loading ? 'Loading database objects...' : search ? 'No matching items. Try a different name or SQL keyword.' : 'No open items yet. Open a connection to get started.'}
        </div> : results.map((item, index) => {
          const Icon = itemIcons[item.kind];
          return <button
            type="button"
            role="option"
            id={`quick-open-option-${index}`}
            aria-selected={index === activeIndex}
            key={item.id}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => void handleOpen(item)}
            disabled={busy}
            className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
              index === activeIndex ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-hover')}
          >
            <Icon size={16} className={cn('shrink-0', index === activeIndex ? 'text-accent' : 'text-text-muted')} />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="block truncate text-[10px] text-text-muted">{item.detail}</span></span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-muted">{item.kind}</span>
          </button>;
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-background px-4 py-2 text-[10px] text-text-muted">
        <span>Arrow keys to move &nbsp; Enter to open &nbsp; Esc to close</span>
        <button type="button" onClick={() => { onClose(); state.setShowConnectionSelector(true); }} className="text-accent hover:underline">Open another connection</button>
      </div>
    </div>
  </div>;
}
