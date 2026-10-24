import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeftRight, Database, GitCompareArrows, Loader2, Search, X } from 'lucide-react';
import { useDatabaseStore, type SavedConnection } from '../store/databaseStore';
import { comparableTargets, compareSchemas, type ColumnDiff, type SchemaDiff, type SchemaSnapshot, type TableDiff } from '../utils/schemaCompare';

interface ComparisonResult {
  sourceId: string;
  targetId: string;
  source: SchemaSnapshot;
  target: SchemaSnapshot;
  diff: SchemaDiff;
}

function statusLabel(status: TableDiff['status']) {
  if (status === 'source-only') return 'Only in source';
  if (status === 'target-only') return 'Only in target';
  if (status === 'changed') return 'Changed';
  return 'No checked drift';
}

function statusTone(status: TableDiff['status']) {
  if (status === 'source-only') return 'text-amber-300 bg-amber-400/10 border-amber-400/25';
  if (status === 'target-only') return 'text-sky-300 bg-sky-400/10 border-sky-400/25';
  if (status === 'changed') return 'text-orange-300 bg-orange-400/10 border-orange-400/25';
  return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25';
}

function ColumnDefinition({ column, changedFields }: {
  column?: ColumnDiff['source'];
  changedFields: ColumnDiff['changedFields'];
}) {
  if (!column) return <span className="text-text-muted">Not present</span>;
  const changed = (field: ColumnDiff['changedFields'][number]) => changedFields.includes(field) ? 'text-orange-300' : 'text-text-secondary';
  return (
    <div className="space-y-1 font-mono text-[11px] break-words">
      <div className={changed('data_type')}>{column.data_type || '(no type)'}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span className={changed('is_nullable')}>{column.is_nullable ? 'NULL' : 'NOT NULL'}</span>
        {column.is_primary_key && <span className={changed('is_primary_key')}>PRIMARY KEY</span>}
        {!column.is_primary_key && changedFields.includes('is_primary_key') && <span className={changed('is_primary_key')}>not a key</span>}
      </div>
      <div className={changed('default_value')}>Default: {column.default_value ?? 'none'}</div>
    </div>
  );
}

function connectionLabel(connection: SavedConnection, database: string | null | undefined) {
  return `${connection.name} · ${connection.environment || 'unlabeled'} · ${database || connection.database || 'default database'}`;
}

function statusTextTone(status: TableDiff['status']) {
  if (status === 'source-only') return 'text-amber-300';
  if (status === 'target-only') return 'text-sky-300';
  if (status === 'changed') return 'text-orange-300';
  return 'text-emerald-300';
}

export function SchemaCompareDialog({ onClose }: { onClose: () => void }) {
  const activeConnectionId = useDatabaseStore(state => state.activeConnectionId);
  const openConnectionIds = useDatabaseStore(state => state.openConnectionIds);
  const savedConnections = useDatabaseStore(state => state.savedConnections);
  const activeDatabases = useDatabaseStore(state => state.activeDatabases);
  const [sourceId, setSourceId] = useState(activeConnectionId || openConnectionIds[0] || '');
  const [targetId, setTargetId] = useState(() => {
    const source = savedConnections.find(connection => connection.id === activeConnectionId);
    return comparableTargets(source, savedConnections, openConnectionIds)[0]?.id || '';
  });
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showMatching, setShowMatching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const openConnections = savedConnections.filter(connection => openConnectionIds.includes(connection.id));
  const sourceConnection = openConnections.find(connection => connection.id === sourceId);
  const targets = comparableTargets(sourceConnection, savedConnections, openConnectionIds);
  const targetConnection = targets.find(connection => connection.id === targetId);

  const clearComparison = () => {
    requestId.current += 1;
    setResult(null);
    setSelectedKey(null);
    setError(null);
    setLoading(false);
  };

  const compare = async () => {
    if (!sourceConnection || !targetConnection || loading) return;
    const currentRequest = ++requestId.current;
    const sourceDatabase = activeDatabases[sourceId];
    const targetDatabase = activeDatabases[targetId];
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [source, target] = await Promise.all([
        invoke<SchemaSnapshot>('get_schema_snapshot', { connectionId: sourceId }),
        invoke<SchemaSnapshot>('get_schema_snapshot', { connectionId: targetId }),
      ]);
      if (currentRequest !== requestId.current) return;
      const state = useDatabaseStore.getState();
      if (!state.openConnectionIds.includes(sourceId) || !state.openConnectionIds.includes(targetId)
        || state.activeDatabases[sourceId] !== sourceDatabase
        || state.activeDatabases[targetId] !== targetDatabase) {
        throw new Error('A connection or selected database changed during comparison. Run it again.');
      }
      const diff = compareSchemas(source, target);
      setResult({ sourceId, targetId, source, target, diff });
      setSelectedKey(diff.tables.find(table => table.status !== 'unchanged')?.key ?? null);
    } catch (cause) {
      if (currentRequest === requestId.current) setError(String(cause));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  const visibleTables = result?.diff.tables.filter(table => {
    if (!showMatching && table.status === 'unchanged') return false;
    return `${table.schema || ''}.${table.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }) ?? [];
  const selectedTable = visibleTables.find(table => table.key === selectedKey) ?? visibleTables[0];
  const sourceLabel = result ? savedConnections.find(connection => connection.id === result.sourceId)?.name : sourceConnection?.name;
  const targetLabel = result ? savedConnections.find(connection => connection.id === result.targetId)?.name : targetConnection?.name;

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(850px,calc(100vh-32px))] w-[min(1140px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent"><GitCompareArrows size={18} /></span>
              <div>
                <Dialog.Title className="text-base font-semibold">Schema Compare</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-text-muted">Compare table names, column types, nullability, defaults, and primary keys. No rows or writes.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary" aria-label="Close schema compare"><X size={17} /></Dialog.Close>
          </div>

          <div className="shrink-0 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-1 text-xs font-medium text-text-secondary">
                <span className="mb-1.5 block">Source</span>
                <select value={sourceId} onChange={event => {
                  const nextId = event.target.value;
                  const next = openConnections.find(connection => connection.id === nextId);
                  setSourceId(nextId);
                  setTargetId(comparableTargets(next, savedConnections, openConnectionIds)[0]?.id || '');
                  clearComparison();
                }} className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary focus:border-accent focus:outline-none">
                  {openConnections.map(connection => <option key={connection.id} value={connection.id}>{connectionLabel(connection, activeDatabases[connection.id])}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => {
                if (!targetConnection) return;
                setSourceId(targetId);
                setTargetId(sourceId);
                clearComparison();
              }} disabled={!targetConnection} aria-label="Swap source and target" title="Swap direction" className="mb-0.5 rounded-md border border-border-strong p-2.5 text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-40"><ArrowLeftRight size={15} /></button>
              <label className="min-w-[220px] flex-1 text-xs font-medium text-text-secondary">
                <span className="mb-1.5 block">Target</span>
                <select value={targetConnection ? targetId : ''} onChange={event => { setTargetId(event.target.value); clearComparison(); }} disabled={!targets.length} className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-40">
                  {!targets.length && <option value="">No open {sourceConnection?.type || 'matching'} connection</option>}
                  {targets.map(connection => <option key={connection.id} value={connection.id}>{connectionLabel(connection, activeDatabases[connection.id])}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void compare()} disabled={!sourceConnection || !targetConnection || loading} className="mb-0.5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <GitCompareArrows size={15} />}
                {loading ? 'Comparing...' : 'Compare'}
              </button>
            </div>
            {!targets.length && <p className="mt-2 text-xs text-amber-300">Open another {sourceConnection?.type || 'same-engine'} connection first, then return here to compare.</p>}
          </div>

          {error && <p role="alert" className="mx-5 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {!result ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-text-muted">
              <Database size={34} strokeWidth={1.3} className="text-accent/70" />
              <p className="text-sm text-text-secondary">{loading ? 'Reading schema metadata from both connections...' : 'Select two connections and compare their schemas.'}</p>
              <p className="max-w-md text-xs">Only table and column definitions are compared. Changes are never applied from this view.</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-border px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="min-w-0 break-all text-text-secondary"><span className="font-semibold text-text-primary">{sourceLabel}</span> / {result.source.database} <span className="mx-2 text-text-muted">→</span> <span className="font-semibold text-text-primary">{targetLabel}</span> / {result.target.database}</p>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Read-only</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-amber-300">{result.diff.summary.sourceOnly} only in source</span>
                  <span className="rounded-md border border-sky-400/20 bg-sky-400/5 px-2.5 py-1.5 text-sky-300">{result.diff.summary.targetOnly} only in target</span>
                  <span className="rounded-md border border-orange-400/20 bg-orange-400/5 px-2.5 py-1.5 text-orange-300">{result.diff.summary.changed} changed</span>
                  <span className="rounded-md border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1.5 text-emerald-300">{result.diff.summary.unchanged} with no checked drift</span>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="flex min-h-[180px] w-full shrink-0 flex-col border-b border-border bg-surface md:min-h-0 md:w-[300px] md:border-b-0 md:border-r" aria-label="Compared tables">
                  <div className="space-y-2 border-b border-border p-3">
                    <label className="flex items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 text-text-muted focus-within:border-accent"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a table" aria-label="Find a compared table" className="h-8 w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" /></label>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary"><input type="checkbox" checked={showMatching} onChange={event => setShowMatching(event.target.checked)} className="accent-accent" /> Show matching tables</label>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {visibleTables.map(table => <button key={table.key} type="button" onClick={() => setSelectedKey(table.key)} aria-current={selectedTable?.key === table.key ? 'true' : undefined} className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${selectedTable?.key === table.key ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-hover'}`}>
                      <span className="min-w-0 truncate font-mono" title={table.schema ? `${table.schema}.${table.name}` : table.name}>{table.schema && <span className="text-text-muted">{table.schema}.</span>}{table.name}</span>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium ${statusTone(table.status)}`}>{statusLabel(table.status)}</span>
                    </button>)}
                    {!visibleTables.length && <p className="px-2 py-8 text-center text-xs text-text-muted">{result.diff.tables.length === result.diff.summary.unchanged && !showMatching ? 'No differences in checked fields. Show matching tables to browse.' : 'No tables match this filter.'}</p>}
                  </div>
                </aside>
                <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5" aria-label="Table difference details">
                  {selectedTable ? (
                    <>
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0"><h3 className="break-all font-mono text-sm font-semibold">{selectedTable.schema && <span className="text-text-muted">{selectedTable.schema}.</span>}{selectedTable.name}</h3><p className="mt-1 text-xs text-text-muted">{selectedTable.columns.filter(column => column.status !== 'unchanged').length} column differences</p></div>
                        <span className={`rounded border px-2 py-1 text-[10px] font-medium ${statusTone(selectedTable.status)}`}>{statusLabel(selectedTable.status)}</span>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-border-strong">
                        <table className="w-full min-w-[560px] table-fixed text-left text-xs">
                          <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-muted"><tr><th className="w-[24%] px-3 py-2.5 font-medium">Column</th><th className="w-[38%] px-3 py-2.5 font-medium">Source</th><th className="w-[38%] px-3 py-2.5 font-medium">Target</th></tr></thead>
                          <tbody className="divide-y divide-border">
                            {selectedTable.columns.map(column => <tr key={column.name} className={column.status === 'unchanged' ? 'opacity-55' : 'bg-orange-400/[0.03]'}><td className="px-3 py-3 align-top"><span className="break-all font-mono text-text-primary">{column.name}</span>{column.status !== 'unchanged' && <span className={`mt-1 block text-[10px] ${statusTextTone(column.status)}`}>{statusLabel(column.status)}</span>}</td><td className="px-3 py-3 align-top"><ColumnDefinition column={column.source} changedFields={column.changedFields} /></td><td className="px-3 py-3 align-top"><ColumnDefinition column={column.target} changedFields={column.changedFields} /></td></tr>)}
                            {!selectedTable.columns.length && <tr><td colSpan={3} className="px-3 py-8 text-center text-text-muted">No columns were returned for this table.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 text-[11px] text-text-muted">Column order, indexes, foreign keys, and data are not compared in this first version.</p>
                    </>
                  ) : <div className="flex h-full items-center justify-center text-center text-xs text-text-muted">Choose a table to inspect its columns.</div>}
                </section>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
