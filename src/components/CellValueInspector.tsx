import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, Clipboard, Eye, EyeOff, FileJson, Search, X } from 'lucide-react';
import { formatCellValue, jsonChildPath, JSON_TREE_MAX_CHARACTERS, parseJsonCellValue, searchJsonPaths } from '../utils/cellValueInspector';

export interface InspectedCell {
  column: string;
  value: unknown;
  masked: boolean;
}

interface CellValueInspectorProps {
  cell: InspectedCell;
  onClose: () => void;
}

function JsonTreeNode({ name, value, path, depth, matches, searching }: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  matches: Set<string>;
  searching: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [shown, setShown] = useState(100);
  const structured = value !== null && typeof value === 'object';
  const entries = structured ? Object.entries(value) : [];
  const visibleEntries = searching
    ? entries.filter(([key]) => matches.has(jsonChildPath(path, key)))
    : entries.slice(0, shown);
  const open = searching || expanded;
  const typeLabel = Array.isArray(value) ? `Array (${entries.length} items)` : `Object (${entries.length} keys)`;

  return <div role="treeitem" aria-expanded={structured ? open : undefined} className="min-w-0" style={{ paddingLeft: depth === 0 ? 0 : 18 }}>
    <div className="flex min-w-0 items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-hover">
      {structured ? <button
        type="button"
        onClick={() => setExpanded(previous => !previous)}
        disabled={searching}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
        className="mt-0.5 shrink-0 text-text-muted hover:text-text-primary disabled:opacity-40"
      >{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="w-[13px] shrink-0" />}
      <span className="min-w-0 break-all font-mono text-xs">
        <span className="text-accent">{name}</span><span className="text-text-muted">: </span>
        <span className={structured ? 'text-text-muted' : typeof value === 'string' ? 'text-emerald-300' : 'text-amber-300'}>
          {structured ? typeLabel : formatCellValue(value)}
        </span>
      </span>
    </div>
    {structured && open && <div role="group">
      {visibleEntries.map(([key, child]) => <JsonTreeNode
        key={key}
        name={key}
        value={child}
        path={jsonChildPath(path, key)}
        depth={depth + 1}
        matches={matches}
        searching={searching}
      />)}
      {!searching && entries.length > shown && <button
        type="button"
        onClick={() => setShown(previous => previous + 100)}
        className="ml-7 rounded px-2 py-1.5 text-xs text-accent hover:bg-accent/10"
      >Show next {Math.min(100, entries.length - shown)} of {entries.length}</button>}
    </div>}
  </div>;
}

export function CellValueInspector({ cell, onClose }: CellValueInspectorProps) {
  const [revealed, setRevealed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [view, setView] = useState<'text' | 'tree'>('text');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const raw = useMemo(() => formatCellValue(cell.value), [cell.value]);
  const visible = !cell.masked || revealed || unlocked;
  const json = useMemo(() => visible ? parseJsonCellValue(cell.value) : null, [cell.value, visible]);
  const result = useMemo(() => json && search ? searchJsonPaths(json, search) : null, [json, search]);

  const copyRaw = async () => {
    if (cell.masked && !window.confirm('This value may contain a secret. Copy its raw value to the clipboard?')) return;
    try {
      await navigator.clipboard.writeText(raw);
      setNotice('Value copied.');
    } catch {
      setNotice('Could not copy. Check clipboard permissions.');
    }
  };

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-[2px]" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-[111] flex max-h-[min(700px,calc(100vh-32px))] w-[min(800px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl"
        onCopyCapture={event => {
          if (cell.masked) {
            event.preventDefault();
            setNotice('Use Copy raw to confirm copying a sensitive value.');
          }
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <Dialog.Title className="truncate text-sm font-semibold">Inspect {cell.column}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-text-muted">Read-only view of this cell. Nothing is changed or saved here.</Dialog.Description>
          </div>
          <Dialog.Close aria-label="Close inspector" className="rounded p-1 text-text-muted hover:bg-hover hover:text-text-primary"><X size={17} /></Dialog.Close>
        </header>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5 text-xs">
            <button type="button" onClick={() => setView('text')} aria-pressed={view === 'text'} className={`rounded px-3 py-1.5 ${view === 'text' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}>Full value</button>
            {json && <button type="button" onClick={() => setView('tree')} aria-pressed={view === 'tree'} className={`flex items-center gap-1 rounded px-3 py-1.5 ${view === 'tree' ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}><FileJson size={13} /> JSON tree</button>}
          </div>
          <div className="flex items-center gap-2">
            {cell.masked && !unlocked && <button
              type="button"
              aria-label={`Hold to reveal ${cell.column}`}
              title="Hold to reveal this value"
              onPointerDown={event => { event.preventDefault(); setRevealed(true); }}
              onPointerUp={() => setRevealed(false)}
              onPointerCancel={() => setRevealed(false)}
              onPointerLeave={() => setRevealed(false)}
              onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setRevealed(true); } }}
              onKeyUp={() => setRevealed(false)}
              onBlur={() => setRevealed(false)}
              className="flex items-center gap-1.5 rounded-md border border-amber-400/30 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-400/10"
            ><Eye size={13} /> Hold to reveal</button>}
            {cell.masked && <button
              type="button"
              onClick={() => {
                if (unlocked) {
                  setUnlocked(false);
                  setView('text');
                  setSearch('');
                } else if (window.confirm('Reveal this sensitive value until you close the inspector?')) {
                  setUnlocked(true);
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary hover:bg-hover hover:text-text-primary"
            >{unlocked ? <EyeOff size={13} /> : <Eye size={13} />}{unlocked ? 'Hide value' : 'Reveal for this view'}</button>}
            <button type="button" onClick={() => void copyRaw()} className="flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary hover:bg-hover hover:text-text-primary"><Clipboard size={13} /> {cell.masked ? 'Copy raw...' : 'Copy value'}</button>
          </div>
        </div>

        {visible && view === 'tree' && json && <div className="shrink-0 border-b border-border px-5 py-2.5">
          <label className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3 focus-within:border-accent"><Search size={14} className="text-text-muted" /><input
            value={search}
            onChange={event => setSearch(event.target.value)}
            aria-label="Search JSON keys and values"
            placeholder="Find keys or values"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
          /></label>
          {result && <p className="mt-1.5 text-[11px] text-text-muted">{result.count === 0 ? 'No matches' : `${result.count}${result.capped ? '+' : ''} matching values or keys`}</p>}
        </div>}

        <div data-inspector-value className="min-h-0 max-h-[min(500px,55vh)] flex-auto overflow-auto p-5">
          {!visible ? <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><Eye size={22} className="text-amber-300/70" /><p className="text-sm text-text-primary">Sensitive value hidden</p><p className="text-xs text-text-muted">Hold to peek or reveal it for this view. Raw copying requires confirmation.</p></div>
            : view === 'tree' && json ? <div role="tree" aria-label="JSON value" className={`rounded-lg border border-border bg-surface p-3 ${cell.masked ? 'select-none' : 'select-text'}`}>
              {(!result || result.paths.size > 0) && <JsonTreeNode name={Array.isArray(json) ? 'Array' : 'Object'} value={json} path="" depth={0} matches={result?.paths || new Set()} searching={Boolean(result)} />}
              {result?.count === 0 && <p className="px-2 py-6 text-center text-xs text-text-muted">No JSON keys or values match.</p>}
            </div> : <pre className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text-primary ${cell.masked ? 'select-none' : 'select-text'}`}>{raw}</pre>}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-5 py-2.5 text-[11px] text-text-muted">
          <span>{visible ? `${raw.length.toLocaleString()} characters${json === null && raw.length > JSON_TREE_MAX_CHARACTERS ? ' | JSON tree unavailable for large values' : ''}` : 'Value is masked'}</span>
          <span role="status" className="text-text-secondary">{notice}</span>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
