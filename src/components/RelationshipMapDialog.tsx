import { useEffect, useRef, useState, type PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, GitFork, Loader2, Maximize2, Minus, Plus, Search, X } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import type { SchemaSnapshot } from '../utils/schemaCompare';
import {
  buildRelationshipMap, canOpenRelationshipNode, resolveRelationshipFocus,
  relationshipContextAvailable,
  type Relationship, type RelationshipGraph, type RelationshipNode,
} from '../utils/relationshipMap';

const CARD_WIDTH = 240;
const CARD_HEIGHT = 142;
const BOARD_WIDTH = 1260;

interface Position { x: number; y: number }
interface Layout { height: number; positions: Map<string, Position> }

function layoutGraph(graph: RelationshipGraph): Layout {
  const incoming = graph.nodes.filter(node => node.direction === 'incoming' || node.direction === 'both');
  const outgoing = graph.nodes.filter(node => node.direction === 'outgoing');
  const rows = Math.max(incoming.length, outgoing.length, 1);
  const height = Math.max(560, rows * 166 + 240);
  const positions = new Map<string, Position>();
  positions.set(graph.centerKey, { x: 510, y: height / 2 - CARD_HEIGHT / 2 });
  const start = height / 2 - (rows - 1) * 166 / 2 - CARD_HEIGHT / 2;
  incoming.forEach((node, index) => positions.set(node.key, { x: 65, y: start + index * 166 }));
  outgoing.forEach((node, index) => positions.set(node.key, { x: 955, y: start + index * 166 }));
  return { height, positions };
}

function connectionLine(source: Position, target: Position) {
  if (source.x === target.x && source.y === target.y) {
    const x = source.x + CARD_WIDTH;
    const y = source.y + CARD_HEIGHT / 2;
    return `M ${x} ${y - 20} C ${x + 110} ${y - 145}, ${x + 110} ${y + 145}, ${x} ${y + 20}`;
  }
  const forward = source.x < target.x;
  const x1 = forward ? source.x + CARD_WIDTH : source.x;
  const x2 = forward ? target.x : target.x + CARD_WIDTH;
  const y1 = source.y + CARD_HEIGHT / 2;
  const y2 = target.y + CARD_HEIGHT / 2;
  const bend = Math.max(90, Math.abs(x2 - x1) * 0.48);
  return `M ${x1} ${y1} C ${x1 + (forward ? bend : -bend)} ${y1}, ${x2 - (forward ? bend : -bend)} ${y2}, ${x2} ${y2}`;
}

function tableLabel(schema: string | null, name: string) {
  return schema ? `${schema}.${name}` : name;
}

function fitView(layout: Layout, viewport: HTMLDivElement) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const scale = Math.max(0.6, Math.min(1, (width - 40) / BOARD_WIDTH, (height - 30) / layout.height));
  return { x: (width - BOARD_WIDTH * scale) / 2, y: (height - layout.height * scale) / 2, scale };
}

function RelationshipCard({ node, center, matched, engine, onOpen }: {
  node: RelationshipNode;
  center: boolean;
  matched: boolean;
  engine: SchemaSnapshot['engine'];
  onOpen: (node: RelationshipNode) => void;
}) {
  const canOpen = canOpenRelationshipNode(node, engine);
  const description = node.missing ? 'Referenced table is not visible in this database'
    : canOpen ? `Open ${tableLabel(node.schema, node.name)}`
      : 'This schema cannot be opened by the current table browser';
  return (
    <button
      type="button"
      data-node="true"
      disabled={!canOpen}
      onClick={() => onOpen(node)}
      title={description}
      aria-label={`${tableLabel(node.schema, node.name)}. ${description}`}
      className={`absolute h-[142px] w-[240px] overflow-hidden rounded-xl border text-left shadow-xl transition-[border-color,opacity] ${center ? 'border-accent bg-[#192d3b]' : 'border-border-strong bg-surface'} ${matched ? 'ring-2 ring-accent' : ''} ${canOpen ? 'hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent' : 'cursor-default'} `}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="min-w-0 truncate font-mono text-xs font-semibold text-text-primary" title={tableLabel(node.schema, node.name)}>{tableLabel(node.schema, node.name)}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${center ? 'bg-accent/20 text-accent' : node.missing ? 'bg-amber-400/10 text-amber-300' : 'bg-[#3b3b3b] text-text-muted'}`}>{center ? 'Focus' : node.missing ? 'Missing' : node.direction}</span>
      </div>
      <div className="space-y-1.5 px-3 py-2 text-[10px] text-text-secondary">
        {node.table?.columns.slice(0, 4).map(column => (
          <div key={column.name} className="flex min-w-0 justify-between gap-3 font-mono">
            <span className="truncate">{column.is_primary_key ? 'PK ' : ''}{column.name}</span>
            <span className="max-w-[90px] truncate text-text-muted" title={column.data_type}>{column.data_type || 'untyped'}</span>
          </div>
        ))}
        {node.table && node.table.columns.length > 4 && <span className="text-text-muted">+{node.table.columns.length - 4} more columns</span>}
        {node.missing && <span className="text-amber-300">Not in the selected database</span>}
      </div>
    </button>
  );
}

export function RelationshipMapDialog({ connectionId, database, tableName, onClose, onOpenTable }: {
  connectionId: string;
  database: string;
  tableName: string;
  onClose: () => void;
  onOpenTable: (node: RelationshipNode) => void;
}) {
  const [graph, setGraph] = useState<RelationshipGraph | null>(null);
  const [engine, setEngine] = useState<SchemaSnapshot['engine']>('Sqlite');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const loadedDatabase = useRef<string | null | undefined>(undefined);
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const expectedDatabase = useDatabaseStore.getState().activeDatabases[connectionId];
    loadedDatabase.current = expectedDatabase;
    setLoading(true);
    setGraph(null);
    setError(null);
    void Promise.all([
      invoke<SchemaSnapshot>('get_schema_snapshot', { connectionId }),
      invoke<Relationship[]>('get_relationships', { connectionId }),
    ]).then(([snapshot, relationships]) => {
      if (cancelled) return;
      const state = useDatabaseStore.getState();
      if (!relationshipContextAvailable(state, connectionId, expectedDatabase)) {
        throw new Error('The connection or database changed while loading. Close and reopen the map.');
      }
      const focus = resolveRelationshipFocus(snapshot, tableName);
      setEngine(snapshot.engine);
      setGraph(buildRelationshipMap(snapshot, relationships, focus));
    }).catch(cause => {
      if (!cancelled) setError(String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [connectionId, database, tableName]);

  const layout = graph ? layoutGraph(graph) : null;
  useEffect(() => {
    if (!graph || !layout || !viewport.current) return;
    setView(fitView(layout, viewport.current));
  }, [graph]);

  const zoom = (factor: number) => {
    const width = viewport.current?.clientWidth ?? 800;
    const height = viewport.current?.clientHeight ?? 500;
    setView(previous => {
      const scale = Math.max(0.45, Math.min(1.8, previous.scale * factor));
      const ratio = scale / previous.scale;
      return { scale, x: width / 2 - (width / 2 - previous.x) * ratio, y: height / 2 - (height / 2 - previous.y) * ratio };
    });
  };

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setView(previous => ({ ...previous, x: start.originX + event.clientX - start.x, y: start.originY + event.clientY - start.y }));
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const matches = graph?.nodes.filter(node => tableLabel(node.schema, node.name).toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const focusMatch = () => {
    const first = matches[0];
    const position = first && layout?.positions.get(first.key);
    if (!position || !viewport.current) return;
    setView(previous => ({ ...previous,
      x: viewport.current!.clientWidth / 2 - (position.x + CARD_WIDTH / 2) * previous.scale,
      y: viewport.current!.clientHeight / 2 - (position.y + CARD_HEIGHT / 2) * previous.scale,
    }));
  };

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(900px,calc(100vh-28px))] w-[min(1250px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-background text-text-primary shadow-2xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg border border-accent/25 bg-accent/10 p-2 text-accent"><GitFork size={18} /></span>
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold">Relationship Map</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-text-muted">Metadata-only links around <span className="font-mono text-text-secondary">{tableName}</span>. Opening a table uses the normal table view.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary" aria-label="Close relationship map"><X size={17} /></Dialog.Close>
          </header>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-2.5">
            <label className="flex min-w-[200px] max-w-[340px] flex-1 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-text-muted focus-within:border-accent"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') focusMatch(); }} placeholder="Find a related table" aria-label="Find a related table" className="h-9 w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" /></label>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              {graph && <span>{graph.nodes.length} tables / {graph.edges.length} declared links</span>}
              {search.trim() && <button type="button" onClick={focusMatch} disabled={!matches.length} className="rounded border border-border-strong px-2 py-1.5 text-accent hover:bg-hover disabled:opacity-40">Jump to match ({matches.length})</button>}
              <div className="flex items-center rounded-md border border-border-strong bg-surface">
                <button type="button" onClick={() => zoom(0.8)} className="p-2 hover:bg-hover" aria-label="Zoom out"><Minus size={14} /></button>
                <span className="w-10 text-center">{Math.round(view.scale * 100)}%</span>
                <button type="button" onClick={() => zoom(1.25)} className="p-2 hover:bg-hover" aria-label="Zoom in"><Plus size={14} /></button>
                <button type="button" onClick={() => { if (layout && viewport.current) setView(fitView(layout, viewport.current)); }} className="border-l border-border-strong p-2 hover:bg-hover" aria-label="Fit map"><Maximize2 size={14} /></button>
              </div>
            </div>
          </div>

          {error && <p role="alert" className="mx-5 mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {loading || !graph || !layout ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-text-muted">
              {loading ? <Loader2 size={30} className="animate-spin text-accent" /> : <GitFork size={30} className="text-accent/60" />}
              <p className="text-sm">{loading ? 'Reading table and foreign-key metadata...' : 'No map available.'}</p>
              {error && <button type="button" onClick={onClose} className="rounded border border-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-hover">Close</button>}
            </div>
          ) : (
            <>
              <div ref={viewport} role="region" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(#383838_1px,transparent_1px)] [background-size:22px_22px] touch-none cursor-grab active:cursor-grabbing" aria-label="Relationship diagram. Drag empty space to pan; use zoom controls above.">
                <div className="absolute left-0 top-0" style={{ width: BOARD_WIDTH, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
                  <svg width={BOARD_WIDTH} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
                    <defs><marker id="relationship-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#5b91af" /></marker></defs>
                    {graph.edges.map((edge, index) => {
                      const source = layout.positions.get(edge.sourceKey);
                      const target = layout.positions.get(edge.targetKey);
                      if (!source || !target) return null;
                      return <path key={`${edge.relationship.name}-${index}`} d={connectionLine(source, target)} fill="none" stroke={selectedEdge === index ? '#38bdf8' : '#5b91af'} strokeWidth={selectedEdge === index ? 3 : 1.8} markerEnd="url(#relationship-arrow)" className="pointer-events-none" />;
                    })}
                  </svg>
                  {graph.nodes.map(node => {
                    const position = layout.positions.get(node.key);
                    if (!position) return null;
                    return <div key={node.key} className={search.trim() && !tableLabel(node.schema, node.name).toLowerCase().includes(search.trim().toLowerCase()) ? 'opacity-35' : ''} style={{ position: 'absolute', left: position.x, top: position.y }}>
                      <RelationshipCard node={node} center={node.key === graph.centerKey} matched={!!search.trim() && tableLabel(node.schema, node.name).toLowerCase().includes(search.trim().toLowerCase())} engine={engine} onOpen={selected => {
                        if (!relationshipContextAvailable(useDatabaseStore.getState(), connectionId, loadedDatabase.current)) {
                          setGraph(null);
                          setError('The connection or database changed. Close and reopen the map.');
                          return;
                        }
                        onOpenTable(selected);
                      }} />
                    </div>;
                  })}
                </div>
                {!graph.edges.length && <div role="status" className="absolute bottom-4 left-1/2 w-[min(420px,calc(100%-32px))] -translate-x-1/2 rounded-lg border border-border-strong bg-surface/95 px-4 py-3 text-center text-xs text-text-secondary shadow-lg">No declared foreign keys link this table within the selected database. sqlMate does not guess relationships from column names.</div>}
                <span className="absolute bottom-3 right-3 rounded bg-surface/90 px-2 py-1 text-[10px] text-text-muted">Drag to pan / select a table to open it</span>
              </div>
              {!!graph.edges.length && <section className="h-[156px] shrink-0 overflow-y-auto border-t border-border bg-surface px-5 py-3" aria-label="Declared relationships">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Declared relationships</h3>
                <div className="grid gap-1.5 md:grid-cols-2">
                  {graph.edges.map((edge, index) => <button key={`${edge.relationship.name}-${index}`} type="button" onMouseEnter={() => setSelectedEdge(index)} onMouseLeave={() => setSelectedEdge(null)} onFocus={() => setSelectedEdge(index)} onBlur={() => setSelectedEdge(null)} onClick={() => {
                    const position = layout.positions.get(edge.sourceKey === graph.centerKey ? edge.targetKey : edge.sourceKey);
                    if (position && viewport.current) setView(previous => ({ ...previous, x: viewport.current!.clientWidth / 2 - (position.x + CARD_WIDTH / 2) * previous.scale, y: viewport.current!.clientHeight / 2 - (position.y + CARD_HEIGHT / 2) * previous.scale }));
                  }} className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-[11px] hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <span className="min-w-0 truncate font-mono text-text-secondary" title={tableLabel(edge.relationship.source_schema, edge.relationship.source_table)}>{tableLabel(edge.relationship.source_schema, edge.relationship.source_table)}({edge.relationship.source_columns.join(', ')})</span>
                    <ArrowRight size={13} className="shrink-0 text-accent" />
                    <span className="min-w-0 truncate font-mono text-text-primary" title={tableLabel(edge.relationship.target_schema, edge.relationship.target_table)}>{tableLabel(edge.relationship.target_schema, edge.relationship.target_table)}({edge.relationship.target_columns.join(', ') || 'key'})</span>
                  </button>)}
                </div>
              </section>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
