import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeftRight, Database, GitCompare, Loader2, X } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { comparableTargets, type SchemaSnapshot } from '../utils/schemaCompare';
import { comparableTables, compareRows, comparisonCoverage, type ComparableTable, type ComparedRow, type ComparisonRows } from '../utils/dataCompare';
import { isSensitiveColumn } from '../utils/sensitiveData';

interface Result {
  source: SchemaSnapshot;
  target: SchemaSnapshot;
  table: ComparableTable;
  sampleSize: number;
  left: ComparisonRows;
  right: ComparisonRows;
  columns: string[];
  rows: ComparedRow[];
}

const tone: Record<ComparedRow['status'], string> = {
  changed: 'text-orange-300 bg-orange-400/10 border-orange-400/25',
  unchanged: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25',
  'source-only': 'text-amber-300 bg-amber-400/10 border-amber-400/25',
  'target-only': 'text-sky-300 bg-sky-400/10 border-sky-400/25',
  'not-checked': 'text-text-secondary bg-surface border-border-strong',
};

const labels: Record<ComparedRow['status'], string> = {
  changed: 'Changed', unchanged: 'Matches', 'source-only': 'Source only',
  'target-only': 'Target only', 'not-checked': 'Not checked',
};

function Value({ value, column }: { value: string | null | undefined; column: string }) {
  if (value === undefined) return <span className="text-text-muted">Not in sample</span>;
  if (value === null) return <span className="italic text-text-muted">NULL</span>;
  if (isSensitiveColumn(column)) return <span className="text-text-muted" aria-label="Sensitive value hidden">Hidden</span>;
  return <span className="break-all font-mono">{value}</span>;
}

export function DataCompareDialog({ onClose }: { onClose: () => void }) {
  const activeConnectionId = useDatabaseStore(state => state.activeConnectionId);
  const openConnectionIds = useDatabaseStore(state => state.openConnectionIds);
  const savedConnections = useDatabaseStore(state => state.savedConnections);
  const activeDatabases = useDatabaseStore(state => state.activeDatabases);
  const [sourceId, setSourceId] = useState(activeConnectionId || openConnectionIds[0] || '');
  const [targetId, setTargetId] = useState(() => {
    const source = savedConnections.find(connection => connection.id === activeConnectionId);
    return comparableTargets(source, savedConnections, openConnectionIds)[0]?.id || '';
  });
  const [snapshots, setSnapshots] = useState<{ source: SchemaSnapshot; target: SchemaSnapshot } | null>(null);
  const [tableKey, setTableKey] = useState('');
  const [sampleSize, setSampleSize] = useState(100);
  const [result, setResult] = useState<Result | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showMatching, setShowMatching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const openConnections = savedConnections.filter(connection => openConnectionIds.includes(connection.id));
  const sourceConnection = openConnections.find(connection => connection.id === sourceId);
  const targets = comparableTargets(sourceConnection, savedConnections, openConnectionIds);
  const targetConnection = targets.find(connection => connection.id === targetId);
  const tables = snapshots ? comparableTables(snapshots.source, snapshots.target) : [];
  const selectedTable = tables.find(table => table.key === tableKey) ?? tables[0];
  const visibleRows = result?.rows.filter(row => showMatching || row.status !== 'unchanged') ?? [];
  const selectedRow = visibleRows.find(row => row.key === selectedKey) ?? visibleRows[0];
  const sensitiveKey = result?.table.primaryKey.some(isSensitiveColumn) ?? false;
  const rowLabel = (row: ComparedRow) => sensitiveKey ? `Sensitive key · row ${result!.rows.indexOf(row) + 1}` : row.label;

  const clear = (resetSnapshots = false) => {
    requestId.current += 1;
    setLoading(false);
    setError(null);
    setResult(null);
    setSelectedKey(null);
    if (resetSnapshots) { setSnapshots(null); setTableKey(''); }
  };
  const checkContext = (sourceDatabase: string | null | undefined, targetDatabase: string | null | undefined) => {
    const state = useDatabaseStore.getState();
    if (!state.openConnectionIds.includes(sourceId) || !state.openConnectionIds.includes(targetId)
      || state.activeDatabases[sourceId] !== sourceDatabase
      || state.activeDatabases[targetId] !== targetDatabase) {
      throw new Error('A connection or selected database changed. Reload the tables and compare again.');
    }
  };
  const loadTables = async () => {
    if (!sourceConnection || !targetConnection || loading) return;
    const id = ++requestId.current;
    const sourceDatabase = activeDatabases[sourceId];
    const targetDatabase = activeDatabases[targetId];
    setLoading(true); setError(null); setResult(null); setSnapshots(null);
    try {
      const [source, target] = await Promise.all([
        invoke<SchemaSnapshot>('get_schema_snapshot', { connectionId: sourceId }),
        invoke<SchemaSnapshot>('get_schema_snapshot', { connectionId: targetId }),
      ]);
      if (id !== requestId.current) return;
      checkContext(sourceDatabase, targetDatabase);
      setSnapshots({ source, target });
      setTableKey(comparableTables(source, target)[0]?.key ?? '');
    } catch (cause) { if (id === requestId.current) setError(String(cause)); }
    finally { if (id === requestId.current) setLoading(false); }
  };
  const compare = async () => {
    if (!snapshots || !selectedTable || loading) return;
    const id = ++requestId.current;
    const sourceDatabase = activeDatabases[sourceId];
    const targetDatabase = activeDatabases[targetId];
    setLoading(true); setError(null); setResult(null);
    try {
      const args = { schema: selectedTable.schema, table: selectedTable.name, limit: sampleSize };
      const [left, right] = await Promise.all([
        invoke<ComparisonRows>('get_comparison_rows', { connectionId: sourceId, ...args }),
        invoke<ComparisonRows>('get_comparison_rows', { connectionId: targetId, ...args }),
      ]);
      if (id !== requestId.current) return;
      checkContext(sourceDatabase, targetDatabase);
      if (JSON.stringify(left.primary_key) !== JSON.stringify(selectedTable.primaryKey)) {
        throw new Error('The primary key changed while reading. Reload the tables.');
      }
      const compared = compareRows(left, right);
      setResult({ ...snapshots, table: selectedTable, sampleSize, left, right, ...compared });
      setSelectedKey(compared.rows.find(row => row.status !== 'unchanged')?.key ?? null);
    } catch (cause) { if (id === requestId.current) setError(String(cause)); }
    finally { if (id === requestId.current) setLoading(false); }
  };

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[2px]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(850px,calc(100vh-32px))] w-[min(1160px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-start gap-3"><span className="rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent"><GitCompare size={18} /></span><div>
            <Dialog.Title className="text-base font-semibold">Data Compare</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-xs text-text-muted">Read-only comparison of a bounded, primary-key-ordered sample. No writes or synchronization.</Dialog.Description>
          </div></div>
          <Dialog.Close aria-label="Close data compare" className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary"><X size={17} /></Dialog.Close>
        </header>
        <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1 text-xs text-text-secondary"><span className="mb-1 block">Source connection</span><select value={sourceId} onChange={event => { const next = openConnections.find(item => item.id === event.target.value); setSourceId(event.target.value); setTargetId(comparableTargets(next, savedConnections, openConnectionIds)[0]?.id ?? ''); clear(true); }} className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary"><option value="" disabled>Select a connection</option>{openConnections.map(item => <option key={item.id} value={item.id}>{item.name} / {activeDatabases[item.id] || item.database || 'default'}</option>)}</select></label>
            <button type="button" aria-label="Swap source and target" title="Swap direction" disabled={!targetConnection} onClick={() => { setSourceId(targetId); setTargetId(sourceId); clear(true); }} className="mb-0.5 rounded-md border border-border-strong p-2.5 text-text-secondary hover:bg-hover disabled:opacity-40"><ArrowLeftRight size={15} /></button>
            <label className="min-w-[200px] flex-1 text-xs text-text-secondary"><span className="mb-1 block">Target connection</span><select value={targetConnection ? targetId : ''} onChange={event => { setTargetId(event.target.value); clear(true); }} disabled={!targets.length} className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary disabled:opacity-40">{!targets.length && <option value="">No open same-engine connection</option>}{targets.map(item => <option key={item.id} value={item.id}>{item.name} / {activeDatabases[item.id] || item.database || 'default'}</option>)}</select></label>
            <button type="button" onClick={() => void loadTables()} disabled={!targetConnection || loading} className="mb-0.5 h-10 rounded-md border border-accent px-4 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40">Load tables</button>
          </div>
          {snapshots && <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1 text-xs text-text-secondary"><span className="mb-1 block">Table with matching columns and primary key</span><select value={selectedTable?.key ?? ''} onChange={event => { setTableKey(event.target.value); clear(); }} disabled={!tables.length} className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary disabled:opacity-40">{!tables.length && <option value="">No eligible tables</option>}{tables.map(table => <option key={table.key} value={table.key}>{table.schema ? `${table.schema}.` : ''}{table.name}</option>)}</select></label>
            <label className="text-xs text-text-secondary"><span className="mb-1 block">Rows per side</span><select value={sampleSize} onChange={event => { setSampleSize(Number(event.target.value)); clear(); }} className="h-10 rounded-md border border-border-strong bg-surface px-3 text-xs text-text-primary"><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label>
            <button type="button" onClick={() => void compare()} disabled={!selectedTable || loading} className="h-10 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">{loading ? 'Comparing...' : 'Compare rows'}</button>
          </div>}
          {snapshots && !tables.length && <p className="text-xs text-amber-300">No common table has matching column definitions, supported scalar types, and a declared primary key.</p>}
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {!result ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-text-muted">{loading ? <Loader2 size={30} className="animate-spin text-accent" /> : <Database size={30} className="text-accent/70" />}<p className="text-sm">{loading ? 'Reading bounded samples...' : snapshots ? 'Choose an eligible table to compare.' : 'Open two same-engine connections, then load their tables.'}</p><p className="max-w-md text-xs">Only the first selected number of rows on each side are checked. Values can change while the two connections are read.</p></div> : <>
          <div className="shrink-0 border-b border-border px-5 py-3 text-xs text-text-secondary">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><strong className="text-text-primary">{sourceConnection?.name}</strong> / {result.source.database} → <strong className="text-text-primary">{targetConnection?.name}</strong> / {result.target.database}</span><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-emerald-300">Read-only</span></div>
            <p className="mt-2 text-[11px] text-text-muted">{comparisonCoverage(result.left, result.right, result.sampleSize)}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{(['changed', 'source-only', 'target-only', 'not-checked', 'unchanged'] as const).map(status => <span key={status} className={`rounded border px-2 py-1 ${tone[status]}`}>{result.rows.filter(row => row.status === status).length} {labels[status].toLowerCase()}</span>)}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="flex min-h-[160px] w-full shrink-0 flex-col border-b border-border bg-surface md:min-h-0 md:w-[280px] md:border-b-0 md:border-r" aria-label="Compared rows"><label className="flex items-center gap-2 border-b border-border p-3 text-xs text-text-secondary"><input type="checkbox" checked={showMatching} onChange={event => setShowMatching(event.target.checked)} className="accent-accent" /> Show matching rows</label><div className="min-h-0 flex-1 overflow-y-auto p-2">{visibleRows.map(row => <button key={row.key} type="button" onClick={() => setSelectedKey(row.key)} aria-current={selectedRow?.key === row.key ? 'true' : undefined} className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-hover ${selectedRow?.key === row.key ? 'bg-accent/15' : ''}`}><span className="min-w-0 truncate font-mono" title={rowLabel(row)}>{rowLabel(row)}</span><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${tone[row.status]}`}>{labels[row.status]}</span></button>)}{!visibleRows.length && <p className="px-3 py-8 text-center text-xs text-text-muted">No differences in the checked sample. Show matching rows to inspect them.</p>}</div></aside>
            <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5" aria-label="Row difference details">{selectedRow ? <><h3 className="mb-1 break-all font-mono text-sm font-semibold">Primary key: {rowLabel(selectedRow)}</h3><p className="mb-4 text-xs text-text-muted">{selectedRow.status === 'not-checked' ? 'The other sample may contain this key beyond its limit.' : labels[selectedRow.status]}{selectedRow.changedColumns.length ? ` · ${selectedRow.changedColumns.length} changed fields` : ''}</p><div className="overflow-x-auto rounded-lg border border-border-strong"><table className="w-full min-w-[560px] table-fixed text-left text-xs"><thead className="bg-surface text-[10px] uppercase tracking-wide text-text-muted"><tr><th className="w-[24%] px-3 py-2.5">Column</th><th className="w-[38%] px-3 py-2.5">Source</th><th className="w-[38%] px-3 py-2.5">Target</th></tr></thead><tbody className="divide-y divide-border">{result.columns.map((column, index) => <tr key={column} className={selectedRow.changedColumns.includes(column) ? 'bg-orange-400/[0.05]' : ''}><th scope="row" className="break-all px-3 py-3 text-left font-mono font-normal">{column}{isSensitiveColumn(column) && <span className="ml-1 text-[10px] text-text-muted">masked</span>}</th><td className="px-3 py-3 align-top"><Value value={selectedRow.source?.[index]} column={column} /></td><td className="px-3 py-3 align-top"><Value value={selectedRow.target?.[index]} column={column} /></td></tr>)}</tbody></table></div></> : <p className="flex h-full items-center justify-center text-center text-xs text-text-muted">Select a row to inspect its values.</p>}</section>
          </div>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
