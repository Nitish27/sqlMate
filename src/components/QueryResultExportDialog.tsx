import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Download, Loader2, X } from 'lucide-react';
import { serializeQueryResultExport, type QueryExportFormat, type QueryExportScope, type QueryResultExportSnapshot } from '../utils/queryResultExport';

interface Props {
  snapshot: QueryResultExportSnapshot;
  onClose: () => void;
  onRestoreFocus: () => void;
  onSaved: (count: number, format: QueryExportFormat) => void;
}

export function QueryResultExportDialog({ snapshot, onClose, onRestoreFocus, onSaved }: Props) {
  const [format, setFormat] = useState<QueryExportFormat>('csv');
  const [scope, setScope] = useState<QueryExportScope>('loaded');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const count = scope === 'selected' ? snapshot.selectedRows.length : snapshot.rows.length;

  const close = () => { if (!savingRef.current) onClose(); };
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const content = serializeQueryResultExport(snapshot, format, scope);
      const saved = await invoke<boolean>('export_query_results', { format, content });
      if (saved) onSaved(count, format);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}
          onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }}
          onPointerDownOutside={event => { if (savingRef.current) event.preventDefault(); }}
          className="fixed left-1/2 top-1/2 z-[81] flex max-h-[calc(100vh-32px)] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl"
        >
          <header className="flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
            <span className="rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent"><Download size={17} aria-hidden="true" /></span>
            <div className="flex-1">
              <Dialog.Title className="text-sm font-semibold">Export Query Results</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-secondary">Save the rows already loaded. SqlMate won't rerun your SQL.</Dialog.Description>
            </div>
            <Dialog.Close disabled={saving} aria-label="Close export" className="rounded p-1.5 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-40"><X size={16} /></Dialog.Close>
          </header>
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium text-text-secondary">
                <span className="block">Rows</span>
                <select value={scope} disabled={saving} onChange={event => { setScope(event.target.value as QueryExportScope); setError(null); }} className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-text-primary">
                  <option value="loaded">All loaded ({snapshot.rows.length.toLocaleString()})</option>
                  <option value="selected" disabled={!snapshot.selectedRows.length}>Selected ({snapshot.selectedRows.length.toLocaleString()})</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium text-text-secondary">
                <span className="block">File format</span>
                <select value={format} disabled={saving} onChange={event => { setFormat(event.target.value as QueryExportFormat); setError(null); }} className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-text-primary">
                  <option value="csv">CSV with headers</option>
                  <option value="json">JSON</option>
                </select>
              </label>
            </div>
            {snapshot.truncated && (
              <p role="note" className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-text-secondary">
                The query hit the result limit. Only the first {snapshot.rows.length.toLocaleString()} rows were loaded; this file cannot include rows beyond that limit.
              </p>
            )}
            {snapshot.maskedColumnCount > 0 && (
              <p className="text-xs text-text-secondary">
                {snapshot.maskedColumnCount} {snapshot.maskedColumnCount === 1 ? 'column' : 'columns'} will be redacted as <code className="text-text-primary">[MASKED]</code>, even if revealed in the grid.
              </p>
            )}
            <p className="text-xs text-text-muted">{format === 'csv' ? 'CSV uses blank fields for NULL and protects formula-like text in spreadsheets.' : 'JSON preserves NULL and keeps duplicate column names distinct.'}</p>
            {error && <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-text-primary">{error}</p>}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
            <span className="text-xs text-text-muted">{count.toLocaleString()} {count === 1 ? 'row' : 'rows'}</span>
            <div className="flex items-center gap-2">
              <Dialog.Close disabled={saving} className="rounded-md px-3 py-2 text-xs text-text-secondary hover:bg-hover disabled:opacity-40">Cancel</Dialog.Close>
              <button type="button" onClick={() => void save()} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                {saving ? 'Saving...' : 'Save file...'}
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
