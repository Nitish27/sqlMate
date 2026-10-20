import { useState } from 'react';
import { Bookmark, Pencil, Search, Trash2 } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { filterSavedQueries } from '../utils/savedQueries';
import { connectionTargetFingerprint } from '../utils/connectionTarget';

export function SidebarSavedQueries() {
  const { savedQueries, savedConnections, savedQueryStatus, savedQueryError, selectedConnectionId, openTab, renameSavedQuery, deleteSavedQuery } = useDatabaseStore();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visible = selectedConnectionId ? filterSavedQueries(savedQueries, selectedConnectionId, search) : [];
  const connection = savedConnections.find(saved => saved.id === selectedConnectionId);

  return <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
    <div className="border-b border-border p-2">
      <label className="relative block">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search saved queries..."
          aria-label="Search saved queries"
          className="w-full rounded border border-border-strong bg-surface py-1.5 pl-8 pr-2 text-[11px] text-text-primary outline-none focus:border-accent"
        />
      </label>
    </div>
    {savedQueryError && <p role="status" className="border-b border-amber-500/20 bg-amber-500/10 p-2 text-[11px] text-amber-200">{savedQueryError}</p>}
    <div className="min-h-0 flex-1 overflow-y-auto py-2 custom-scrollbar">
      {savedQueryStatus === 'loading' ? <p className="px-4 py-3 text-xs text-text-muted">Loading saved queries...</p>
        : visible.length === 0 ? <div className="px-4 py-8 text-center text-xs text-text-muted">
          <Bookmark size={18} className="mx-auto mb-2 opacity-50" />
          {search ? 'No saved queries match your search.' : 'No saved queries for this connection yet. Save one from a SQL tab.'}
        </div> : visible.map(query => <div key={query.id} className="group border-b border-border/50 px-3 py-2 hover:bg-surface">
          {editingId === query.id ? <form onSubmit={event => {
            event.preventDefault();
            if (draftName.trim()) renameSavedQuery(query.id, draftName);
            setEditingId(null);
          }} className="flex gap-1">
            <input autoFocus aria-label="Query name" maxLength={120} value={draftName} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditingId(null); }} className="min-w-0 flex-1 rounded border border-accent bg-background px-2 py-1 text-xs text-text-primary outline-none" />
            <button type="submit" className="rounded bg-accent px-2 text-xs text-white">Save</button>
          </form> : deletingId === query.id ? <div className="space-y-2 text-[11px] text-text-secondary">
            <p>Delete “{query.name}” from this library?</p>
            <div className="flex gap-2"><button onClick={() => setDeletingId(null)} className="rounded border border-border px-2 py-1">Cancel</button><button onClick={() => { deleteSavedQuery(query.id); setDeletingId(null); }} className="rounded bg-red-700 px-2 py-1 text-white">Delete</button></div>
          </div> : <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (connection && query.targetFingerprint !== connectionTargetFingerprint(connection)
                    && !window.confirm('This connection now points to a different database target. Open this saved SQL for review anyway? It will not run automatically.')) return;
                  openTab({ type: 'query', title: query.name, query: query.sql, savedQueryId: query.id, connectionId: query.connectionId, database: query.database });
                }}
                title={`Open ${query.name} in a new SQL tab`}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-text-primary hover:text-accent"
              >{query.name}</button>
              <button onClick={() => { setEditingId(query.id); setDraftName(query.name); }} aria-label={`Rename ${query.name}`} title="Rename" className="rounded p-1 text-text-muted opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100"><Pencil size={12} /></button>
              <button onClick={() => setDeletingId(query.id)} aria-label={`Delete ${query.name}`} title="Delete" className="rounded p-1 text-text-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"><Trash2 size={12} /></button>
            </div>
            {connection && query.targetFingerprint !== connectionTargetFingerprint(connection)
              ? <p className="mt-0.5 text-[10px] text-amber-300">Connection target changed · review before running</p>
              : query.database && <p className="mt-0.5 truncate text-[10px] text-text-muted">{query.database}</p>}
            <p className="mt-1 line-clamp-2 break-all font-mono text-[10px] text-text-muted">{query.sql.slice(0, 160)}</p>
          </>}
        </div>)}
    </div>
  </div>;
}
