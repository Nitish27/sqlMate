import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, Loader2, Search, X } from 'lucide-react';
import { useDatabaseStore, type FilterConfig, type SortConfig } from '../store/databaseStore';
import { isSensitiveColumn } from '../utils/sensitiveData';
import { profileSample, sampleCoverage, type ColumnProfile } from '../utils/dataProfiler';

interface SampleResult {
  columns: string[];
  rows: unknown[][];
  has_more?: boolean;
  execution_time_ms: number;
}

export function DataProfilerDialog({ connectionId, database, tableName, filters, sortConfig, primaryKeys, fallbackColumns, onClose }: {
  connectionId: string;
  database: string;
  tableName: string;
  filters: FilterConfig[];
  sortConfig?: SortConfig;
  primaryKeys: string[];
  fallbackColumns: string[];
  onClose: () => void;
}) {
  const [sampleSize, setSampleSize] = useState(100);
  const [sample, setSample] = useState<SampleResult | null>(null);
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const activeFilters = filters.filter(filter => filter.enabled);

  useEffect(() => () => { requestId.current += 1; }, []);

  const load = async (limit = sampleSize) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setSample(null);
    try {
      const result = await invoke<SampleResult>('get_table_data', {
        connectionId, tableName, limit, offset: 0, filters: activeFilters,
        sortColumn: sortConfig?.column ?? null,
        sortDirection: sortConfig?.direction ?? 'ASC',
        primaryKeys, seekAfter: null,
      });
      if (id !== requestId.current) return;
      const state = useDatabaseStore.getState();
      if (!state.openConnectionIds.includes(connectionId) || state.activeDatabases[connectionId] !== database) {
        throw new Error('The connection or database changed. Reopen the profiler for the current table.');
      }
      if (!Array.isArray(result.columns) || !Array.isArray(result.rows) || result.rows.some(row => !Array.isArray(row))) {
        throw new Error('The database returned an invalid sample.');
      }
      setProfiles(profileSample(result.columns.length ? result.columns : fallbackColumns, result.rows));
      setSample(result);
    } catch (cause) {
      if (id === requestId.current) setError(String(cause));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const visible = profiles.filter(profile => profile.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(830px,calc(100vh-28px))] w-[min(1080px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent"><BarChart3 size={18} /></span>
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold">Data Profiler</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-text-muted">Read-only column statistics for <span className="font-mono text-text-secondary">{tableName}</span>. No writes or full-table count.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary" aria-label="Close data profiler"><X size={17} /></Dialog.Close>
          </header>

          <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border bg-surface px-5 py-3">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">Rows to sample
              <select value={sampleSize} onChange={event => { requestId.current += 1; setLoading(false); setSample(null); setProfiles([]); setError(null); setSampleSize(Number(event.target.value)); }} className="h-9 rounded-md border border-border-strong bg-background px-3 text-text-primary outline-none focus:border-accent">
                <option value={100}>100 rows</option><option value={500}>500 rows</option><option value={1000}>1,000 rows</option>
              </select>
            </label>
            <button type="button" onClick={() => void load()} disabled={loading} className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {loading && <Loader2 size={14} className="animate-spin" />}{sample ? 'Refresh profile' : 'Profile sample'}
            </button>
            <span className="pb-1 text-xs text-text-muted">{activeFilters.length ? `${activeFilters.length} active filter${activeFilters.length === 1 ? '' : 's'} applied` : 'No filters applied'} · {sortConfig?.column ? 'Current sort' : primaryKeys.length ? 'Primary-key order' : 'Database-return order'}</span>
          </div>

          {sample && <div className="shrink-0 border-b border-border px-5 py-3 text-xs text-text-secondary">
            <span className="font-semibold text-text-primary">{sample.rows.length} sampled rows · {profiles.length} columns · {sample.execution_time_ms}ms</span>
            <p className="mt-1">{sampleCoverage(sample.rows.length, sample.has_more === true, sampleSize)}{!sortConfig?.column && primaryKeys.length === 0 ? ' Row order is not guaranteed without a primary key or sort.' : ''} Pending row edits are not included.</p>
          </div>}

          <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
            {error && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">{error}</div>}
            {loading && <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" /> Reading bounded sample...</div>}
            {!loading && !sample && !error && <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-text-secondary"><BarChart3 size={32} className="text-accent" /><p className="max-w-md text-sm">Profile up to 1,000 returned rows. Statistics describe only the returned sample, not the whole table.</p></div>}
            {sample && <>
              <label className="mb-4 flex max-w-xs items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-text-muted focus-within:border-accent"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a column" aria-label="Find a column" className="h-9 w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" /></label>
              {visible.length === 0 && <p className="text-sm text-text-muted">No columns match your search.</p>}
              <div className="grid gap-3 md:grid-cols-2">
                {visible.map(profile => {
                  const nullPercent = sample.rows.length ? Math.round(profile.nullCount / sample.rows.length * 100) : 0;
                  const sensitive = isSensitiveColumn(profile.name);
                  return <section key={profile.name} className="min-w-0 rounded-lg border border-border-strong bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="truncate font-mono text-sm font-semibold" title={profile.name}>{profile.name}</h3>{sensitive && <span className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-500">Values hidden</span>}</div>
                    <div className="grid grid-cols-3 gap-2 text-xs"><div><span className="block text-text-muted">Non-null</span><strong className="font-medium">{sample.rows.length - profile.nullCount}</strong></div><div><span className="block text-text-muted">Null</span><strong className="font-medium">{profile.nullCount} ({nullPercent}%)</strong></div><div><span className="block text-text-muted">Distinct</span><strong className="font-medium">{profile.distinctCount}</strong></div></div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full bg-accent" style={{ width: `${100 - nullPercent}%` }} /></div>
                    {profile.numericRange && <p className="mt-3 text-xs text-text-secondary">Numeric range <span className="font-mono text-text-primary">{profile.numericRange.min} to {profile.numericRange.max}</span></p>}
                    {profile.commonValues.length > 0 && <div className="mt-3 border-t border-border pt-3 text-xs"><span className="text-text-muted">Common values</span><div className="mt-2 space-y-1">{profile.commonValues.map((item, index) => <div key={index} className="flex min-w-0 justify-between gap-2"><span className="truncate font-mono" title={item.value}>{item.value || '(empty string)'}</span><span className="shrink-0 text-text-muted">{item.count}×</span></div>)}</div></div>}
                  </section>;
                })}
              </div>
            </>}
          </div>
          <footer className="shrink-0 border-t border-border bg-surface px-5 py-2.5 text-[11px] text-text-muted">Sample statistics only · Read-only · Sensitive values are not displayed</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
