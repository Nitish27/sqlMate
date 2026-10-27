import { useRef, useState, type CSSProperties, useEffect, useLayoutEffect, useMemo, type MouseEvent } from 'react';
import { List } from 'react-window';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useDatabaseStore } from '../store/databaseStore';
import { resizeColumnWidth } from '../utils/columnSizing';
import { Copy, Eye, EyeOff, FileJson, ScanSearch } from 'lucide-react';
import { shouldMaskColumn } from '../utils/sensitiveData';
import { SensitiveValue } from './SensitiveValue';
import { needsRawCopyConfirmation, rowsForCopy, serializeResultRows, type ResultCopyFormat } from '../utils/queryResultCopy';
import { headerContentWidthForBody } from '../utils/queryResultsLayout';
import { CellValueInspector, type InspectedCell } from './CellValueInspector';

interface QueryResultsTableProps {
  columns: string[];
  data: any[][];
  onReachBottom?: () => void;
  isLoadingMore?: boolean;
  selectedRowIndex?: number | null;
  selectedRowIndices?: number[];
  onSelectRow?: (index: number, event: MouseEvent<HTMLDivElement>) => void;
  onContextSelectRow?: (index: number) => void;
}

const COLUMN_WIDTH = 150;
const MIN_COLUMN_WIDTH = 60;
const INDEX_COLUMN_WIDTH = 48;

export const QueryResultsTable = ({ 
  columns, 
  data, 
  onReachBottom, 
  isLoadingMore,
  selectedRowIndex,
  selectedRowIndices = [],
  onSelectRow,
  onContextSelectRow,
}: QueryResultsTableProps) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>(() => columns.map(() => COLUMN_WIDTH));
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [maskOverrides, setMaskOverrides] = useState<Set<string>>(() => new Set());
  const contextTargetRef = useRef<{ rowIndex: number; columnIndex: number | null } | null>(null);
  const [contextTarget, setContextTarget] = useState<{ rowIndex: number; columnIndex: number | null } | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [inspectedCell, setInspectedCell] = useState<InspectedCell | null>(null);
  const maskedColumnSet = useMemo(
    () => new Set(columns.filter(name => shouldMaskColumn(name, maskOverrides))),
    [columns, maskOverrides]
  );
  const resizingColumnRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const dataTableAppearance = useDatabaseStore((state) => state.appearanceSettings.dataTable);
  const selectedRowSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices]);
  const showLineNumbers = dataTableAppearance.showLineNumbersInQueryResults;
  const rowHeight = useMemo(
    () => Math.max(32, Math.round(dataTableAppearance.fontSize + (dataTableAppearance.rowPadding * 2) + 8)),
    [dataTableAppearance.fontSize, dataTableAppearance.rowPadding]
  );
  const headerHeight = useMemo(
    () => Math.max(34, Math.round(dataTableAppearance.fontSize + (dataTableAppearance.rowPadding * 2) + 10)),
    [dataTableAppearance.fontSize, dataTableAppearance.rowPadding]
  );
  const cellTextStyle = useMemo<CSSProperties>(() => ({
    fontFamily: dataTableAppearance.fontFamily,
    fontSize: `${dataTableAppearance.fontSize}px`,
    paddingTop: `${dataTableAppearance.rowPadding}px`,
    paddingBottom: `${dataTableAppearance.rowPadding}px`,
  }), [dataTableAppearance.fontFamily, dataTableAppearance.fontSize, dataTableAppearance.rowPadding]);
  const indexTextStyle = useMemo<CSSProperties>(() => ({
    fontFamily: dataTableAppearance.fontFamily,
    fontSize: `${Math.max(dataTableAppearance.fontSize - 2, 10)}px`,
  }), [dataTableAppearance.fontFamily, dataTableAppearance.fontSize]);

  useEffect(() => {
    setColumnWidths(previousWidths => columns.map((_, index) => previousWidths[index] || COLUMN_WIDTH));
  }, [columns]);

  useEffect(() => {
    setMaskOverrides(new Set());
  }, [columns]);

  useEffect(() => {
    if (!copyNotice) return;
    const timeout = window.setTimeout(() => setCopyNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  const toggleColumnMask = (name: string) => {
    setMaskOverrides(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const isColumnMasked = (name: string) => maskedColumnSet.has(name);

  const writeCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(successMessage);
    } catch {
      setCopyNotice('Could not copy to clipboard. Check clipboard permissions.');
    }
  };

  const confirmRawCopy = (names: string[]) => !needsRawCopyConfirmation(
    names, names.filter(name => maskedColumnSet.has(name))
  ) || window.confirm('These results may contain secrets. Copy their raw values to the clipboard?');

  const copyRows = (rowIndex: number, format: ResultCopyFormat) => {
    const rows = rowsForCopy(data, rowIndex, selectedRowIndices);
    if (rows.length === 0 || !confirmRawCopy(columns)) return;
    void writeCopy(serializeResultRows(columns, rows, format), `Copied ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}.`);
  };

  const copyCell = () => {
    if (!contextTarget || contextTarget.columnIndex === null) return;
    const name = columns[contextTarget.columnIndex];
    if (!name || !confirmRawCopy([name])) return;
    const value = data[contextTarget.rowIndex]?.[contextTarget.columnIndex];
    void writeCopy(value == null ? 'NULL' : String(value), 'Copied cell.');
  };

  const inspectCell = (rowIndex: number, columnIndex: number) => {
    const column = columns[columnIndex];
    const row = data[rowIndex];
    if (column === undefined || !row) return;
    setInspectedCell({ column, value: row[columnIndex], masked: isColumnMasked(column) });
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rowElement = target.closest<HTMLElement>('[data-result-row]');
    if (!rowElement) {
      contextTargetRef.current = null;
      return;
    }
    const columnElement = target.closest<HTMLElement>('[data-result-column]');
    const columnIndex = columnElement?.dataset.resultColumn;
    contextTargetRef.current = {
      rowIndex: Number(rowElement.dataset.resultRow),
      columnIndex: columnIndex === undefined ? null : Number(columnIndex),
    };
  };

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const resizeState = resizingColumnRef.current;
      if (!resizeState) return;

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = requestAnimationFrame(() => {
        const nextWidth = resizeColumnWidth(
          resizeState.startWidth,
          event.clientX - resizeState.startX,
          MIN_COLUMN_WIDTH
        );
        setColumnWidths(previousWidths => {
          const nextWidths = [...previousWidths];
          nextWidths[resizeState.index] = nextWidth;
          return nextWidths;
        });
      });
    };

    const handleMouseUp = () => {
      resizingColumnRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const handleResizeStart = (index: number, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizingColumnRef.current = {
      index,
      startX: event.clientX,
      startWidth: columnWidths[index] || COLUMN_WIDTH
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const formatValue = (value: any, columnName: string) => {
    if (value === null) return <span className="text-text-muted italic opacity-40">NULL</span>;
    if (isColumnMasked(columnName)) {
      return <SensitiveValue columnName={columnName} value={value} />;
    }
    if (typeof value === 'boolean') return <span className="text-blue-400 font-medium">{value ? 'true' : 'false'}</span>;
    return <span className="truncate text-text-primary">{String(value)}</span>;
  };

  const totalWidth = (showLineNumbers ? INDEX_COLUMN_WIDTH : 0)
    + columnWidths.reduce((total, width) => total + width, 0);

  useLayoutEffect(() => {
    const list = resultsRef.current?.querySelector<HTMLDivElement>('.react-window-list');
    if (!list) return;

    const measureScrollbar = () => setScrollbarWidth(Math.max(0, list.offsetWidth - list.clientWidth));
    const syncHeader = () => {
      if (headerRef.current) headerRef.current.scrollLeft = list.scrollLeft;
    };
    measureScrollbar();
    syncHeader();
    list.addEventListener('scroll', syncHeader, { passive: true });
    const observer = new ResizeObserver(measureScrollbar);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', syncHeader);
      observer.disconnect();
    };
  }, [data.length, rowHeight, totalWidth]);

  useLayoutEffect(() => {
    const list = resultsRef.current?.querySelector<HTMLDivElement>('.react-window-list');
    if (list && headerRef.current) headerRef.current.scrollLeft = list.scrollLeft;
  }, [scrollbarWidth, totalWidth]);

  const Row = ({ index, style }: { index: number; style: CSSProperties }) => {
    const row = data[index];
    if (!row) return null;
    const isSelected = selectedRowSet.has(index);
    const isActive = selectedRowIndex === index;

    return (
      <div 
        data-result-row={index}
        style={{
          ...style,
          width: totalWidth,
          minWidth: '100%',
          backgroundColor: isSelected
            ? `${dataTableAppearance.statusColors.selectionCursor}${isActive ? '2b' : '22'}`
            : undefined,
          boxShadow: isActive ? `inset 0 0 0 1px ${dataTableAppearance.statusColors.selectionCursor}80` : undefined,
        }}
        className={`flex border-b border-[#2C2C2C] hover:bg-accent/5 transition-colors group cursor-default ${
          isSelected ? 'after:absolute after:left-0 after:top-0 after:bottom-0 after:w-1 after:bg-accent z-10' : ''
        }`}
        onClick={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-result-column]');
          if (cell && !cell.contains(document.activeElement)) cell.focus();
          else if (!cell) resultsRef.current?.focus();
          onSelectRow?.(index, event);
        }}
      >
        {showLineNumbers && (
          <div 
            className={`sticky left-0 z-10 shrink-0 border-r border-[#3C3C3C] text-text-muted flex items-center justify-center group-hover:bg-accent/10 shadow-[2px_0_5px_rgba(0,0,0,0.2)] ${
              isSelected ? 'text-accent font-bold' : 'bg-[#1e1e1e]'
            }`}
            style={{
              width: INDEX_COLUMN_WIDTH,
              ...indexTextStyle,
              color: isSelected ? dataTableAppearance.statusColors.selectionCursor : dataTableAppearance.statusColors.rowNumbers,
              backgroundColor: isSelected ? `${dataTableAppearance.statusColors.selectionCursor}22` : undefined,
            }}
          >
            {index + 1}
          </div>
        )}
        {columns.map((name, i) => (
          <div 
            key={i} 
            data-result-column={i}
            tabIndex={0}
            onDoubleClick={() => inspectCell(index, i)}
            onKeyDown={event => {
              if (event.target === event.currentTarget && event.key === ' ') {
                event.preventDefault();
                inspectCell(index, i);
              }
            }}
            title="Space or double-click to inspect"
            className={`shrink-0 px-3 border-r border-[#3C3C3C] flex items-center truncate focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              isSelected ? 'text-text-primary' : 'text-text-primary'
            }`}
            style={{ width: columnWidths[i] || COLUMN_WIDTH, ...cellTextStyle }}
          >
            {formatValue(row[i], name)}
          </div>
        ))}
      </div>
    );
  };

  if (columns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        No results to display
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] overflow-hidden">
      {/* Header */}
      <div className="relative shrink-0">
        <div ref={headerRef} className="overflow-hidden bg-[#2C2C2C] border-b border-[#3C3C3C]">
          <div className="flex" style={{ width: headerContentWidthForBody(totalWidth, scrollbarWidth), minWidth: '100%' }}>
            {showLineNumbers && <div className="shrink-0" style={{ width: INDEX_COLUMN_WIDTH, height: headerHeight }} />}
            {columns.map((name, index) => (
              <div
                key={`${name}-${index}`}
                className="shrink-0 px-3 border-r border-[#3C3C3C] flex items-center font-semibold text-text-secondary truncate relative group"
                style={{ width: columnWidths[index] || COLUMN_WIDTH, height: headerHeight, ...cellTextStyle }}
              >
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  aria-label={`${isColumnMasked(name) ? 'Show' : 'Mask'} ${name} column values`}
                  title={isColumnMasked(name) ? 'Show column values' : 'Mask column values'}
                  className={`shrink-0 ml-1 text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${!isColumnMasked(name) ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : ''}`}
                  onClick={() => toggleColumnMask(name)}
                >
                  {isColumnMasked(name) ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <div
                  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-transparent hover:bg-[#007acc] transition-colors"
                  onMouseDown={(event) => handleResizeStart(index, event)}
                  style={{ transform: 'translateX(50%)' }}
                />
              </div>
            ))}
          </div>
        </div>
        {showLineNumbers && (
          <div
            className="absolute left-0 top-0 z-20 bg-[#2C2C2C] border-r border-[#3C3C3C] flex items-center justify-center text-text-muted pointer-events-none"
            style={{ width: INDEX_COLUMN_WIDTH, height: headerHeight, ...indexTextStyle, color: dataTableAppearance.statusColors.rowNumbers }}
          >
            #
          </div>
        )}
      </div>

      {/* Body with Virtualization */}
      <ContextMenu.Root onOpenChange={(open) => {
        if (!open) return;
        const target = contextTargetRef.current;
        setContextTarget(target);
        if (target && !selectedRowSet.has(target.rowIndex)) onContextSelectRow?.(target.rowIndex);
      }}>
      <ContextMenu.Trigger asChild>
      <div
        ref={resultsRef}
        role="region"
        aria-label="Query results"
        tabIndex={0}
        className="flex-1 relative min-h-0 bg-[#1e1e1e]"
        onContextMenuCapture={handleContextMenu}
        onCopy={(event) => {
          const selectedText = window.getSelection()?.toString();
          if (!selectedText || !needsRawCopyConfirmation(columns, [...maskedColumnSet])) return;
          event.preventDefault();
          if (window.confirm('These results may contain secrets. Copy the selected text to the clipboard?')) {
            event.clipboardData.setData('text/plain', selectedText);
          }
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c'
            && selectedRowIndex != null && !window.getSelection()?.toString()) {
            event.preventDefault();
            copyRows(selectedRowIndex, 'plain');
          }
        }}
      >
        <List
          rowCount={data.length}
          rowHeight={rowHeight}
          rowComponent={Row as any}
          rowProps={{}}
          onRowsRendered={({ stopIndex }: any) => {
            if (onReachBottom && stopIndex >= data.length - 20) {
              onReachBottom();
            }
          }}
          className="react-window-list overflow-auto"
          style={{ width: '100%', height: '100%' }}
        />
        
        {isLoadingMore && (
          <div className="absolute bottom-4 right-4 bg-accent/80 text-white px-3 py-1 rounded-full text-[10px] animate-pulse flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping"></span>
            Loading more...
          </div>
        )}
        {copyNotice && (
          <div role="status" className="absolute bottom-4 left-4 z-20 rounded border border-border bg-sidebar px-3 py-1.5 text-xs text-text-primary shadow-lg">
            {copyNotice}
          </div>
        )}
      </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[100] min-w-[210px] rounded-md border border-[#454545] bg-[#252526] p-1 text-xs text-text-secondary shadow-xl">
          <ContextMenu.Item
            disabled={!contextTarget || contextTarget.columnIndex === null}
            onSelect={() => contextTarget?.columnIndex != null && inspectCell(contextTarget.rowIndex, contextTarget.columnIndex)}
            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-[#094771] focus:text-white data-[disabled]:opacity-40"
          >
            <ScanSearch size={14} /> Inspect value <span className="ml-auto text-[10px] text-text-muted">Space</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <ContextMenu.Item
            disabled={!contextTarget || contextTarget.columnIndex === null}
            onSelect={copyCell}
            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-[#094771] focus:text-white data-[disabled]:opacity-40"
          >
            <Copy size={14} /> Copy Cell
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-[#454545]" />
          <ContextMenu.Item
            disabled={!contextTarget}
            onSelect={() => contextTarget && copyRows(contextTarget.rowIndex, 'plain')}
            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-[#094771] focus:text-white data-[disabled]:opacity-40"
          >
            <Copy size={14} /> Copy {contextTarget && selectedRowIndices.length > 1 && selectedRowIndices.includes(contextTarget.rowIndex) ? 'Rows' : 'Row'}
            <span className="ml-auto text-[10px] text-text-muted">{navigator.platform.startsWith('Mac') ? '⌘C' : 'Ctrl+C'}</span>
          </ContextMenu.Item>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger
              disabled={!contextTarget}
              className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none focus:bg-[#094771] focus:text-white data-[disabled]:opacity-40"
            >
              <FileJson size={14} /> Copy Rows As <span className="ml-auto">›</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="z-[101] min-w-[180px] rounded-md border border-[#454545] bg-[#252526] p-1 text-xs text-text-secondary shadow-xl">
                {([
                  ['csv', 'CSV'],
                  ['csv-with-headers', 'CSV with headers'],
                  ['json', 'JSON'],
                  ['markdown', 'Markdown table'],
                ] as const).map(([format, label]) => (
                  <ContextMenu.Item
                    key={format}
                    onSelect={() => contextTarget && copyRows(contextTarget.rowIndex, format)}
                    className="cursor-default rounded-sm px-2 py-1.5 outline-none focus:bg-[#094771] focus:text-white"
                  >{label}</ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        </ContextMenu.Content>
      </ContextMenu.Portal>
      </ContextMenu.Root>
      {inspectedCell && <CellValueInspector cell={inspectedCell} onClose={() => setInspectedCell(null)} />}
    </div>
  );
};
