import { useMemo, useState, useCallback, useRef, useEffect, type CSSProperties } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { ArrowUpRight, ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { UseTableMutationsReturn } from '../hooks/useTableMutations';
import { SortConfig, useDatabaseStore, type ForeignKeyStructure } from '../store/databaseStore';
import { RowContextMenu } from './RowContextMenu';
import { cn } from '../utils/cn';
import { getContextEditColumn, isRepeatedCellPress, parseCellEditorValue, type CellPress } from '../utils/cellEditing';
import { applyStagedRows, rowIdentity } from '../utils/rowMutations';
import { shouldMaskColumn } from '../utils/sensitiveData';
import { SensitiveValue } from './SensitiveValue';
import { filtersForForeignKey } from '../utils/foreignKeyNavigation';

interface DataTableProps {
  columns: string[];
  data: any[][];
  mutations: UseTableMutationsReturn;
  selectedRowIndex?: number | null;
  selectedRowIndices?: number[];
  onRowClick?: (index: number, event: React.MouseEvent<HTMLTableRowElement>) => void;
  sortConfig?: SortConfig;
  onSort?: (column: string) => void;
  hiddenColumns?: string[];
  pkColumns: string[];
  readOnly?: boolean;
  onDuplicateRow: (rowData: any[]) => void;
  foreignKeys?: ForeignKeyStructure[];
  onFollowForeignKey?: (key: ForeignKeyStructure, row: any[]) => void;
}

const DEFAULT_COLUMN_WIDTH = 150;
const MIN_COLUMN_WIDTH = 60;

export const DataTable = ({ 
  columns: columnNames, 
  data,
  mutations,
  selectedRowIndex,
  selectedRowIndices = [],
  onRowClick,
  sortConfig,
  onSort,
  hiddenColumns = [],
  pkColumns,
  readOnly = false,
  onDuplicateRow,
  foreignKeys = [],
  onFollowForeignKey,
}: DataTableProps) => {
  const dataTableAppearance = useDatabaseStore((state) => state.appearanceSettings.dataTable);
  const [localData, setLocalData] = useState<any[][]>(data);
  const [maskOverrides, setMaskOverrides] = useState<Set<string>>(() => new Set());
  const maskedColumnNames = useMemo(
    () => columnNames.filter(name => shouldMaskColumn(name, maskOverrides)),
    [columnNames, maskOverrides]
  );
  const maskedColumnSet = useMemo(() => new Set(maskedColumnNames), [maskedColumnNames]);
  const tableRef = useRef<HTMLTableElement>(null);
  
  // Use refs for resize to avoid re-renders during drag
  const columnWidthsRef = useRef<Record<string, number>>({});
  const [, forceUpdate] = useState(0);
  const resizingColumnRef = useRef<string | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  const rafId = useRef<number | null>(null);

  // Filter out hidden columns
  const visibleColumnNames = useMemo(() => 
    columnNames.filter(col => !hiddenColumns.includes(col)),
    [columnNames, hiddenColumns]
  );
  const showLineNumbers = dataTableAppearance.showLineNumbersInTables;
  const headerCellStyle = useMemo<CSSProperties>(() => ({
    fontFamily: dataTableAppearance.fontFamily,
    fontSize: `${dataTableAppearance.fontSize}px`,
    paddingTop: `${Math.max(dataTableAppearance.rowPadding, 6)}px`,
    paddingBottom: `${Math.max(dataTableAppearance.rowPadding, 6)}px`,
    boxShadow: 'inset -1px 0 0 var(--color-border-strong)',
  }), [dataTableAppearance.fontFamily, dataTableAppearance.fontSize, dataTableAppearance.rowPadding]);
  const bodyCellStyle = useMemo<CSSProperties>(() => ({
    fontFamily: dataTableAppearance.fontFamily,
    fontSize: `${dataTableAppearance.fontSize}px`,
    paddingTop: `${dataTableAppearance.rowPadding}px`,
    paddingBottom: `${dataTableAppearance.rowPadding}px`,
  }), [dataTableAppearance.fontFamily, dataTableAppearance.fontSize, dataTableAppearance.rowPadding]);
  const rowNumberStyle = useMemo<CSSProperties>(() => ({
    fontFamily: dataTableAppearance.fontFamily,
    fontSize: `${Math.max(dataTableAppearance.fontSize - 2, 10)}px`,
    color: dataTableAppearance.statusColors.rowNumbers,
  }), [dataTableAppearance.fontFamily, dataTableAppearance.fontSize, dataTableAppearance.statusColors.rowNumbers]);
  const selectedRowSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices]);
  const rowInlineStyle = useCallback((rowIndex: number): CSSProperties | undefined => {
    const change = mutations.getRowState(rowIndex);
    if (!change) return undefined;

    switch (change.type) {
      case 'insert':
        return { backgroundColor: `${dataTableAppearance.statusColors.newRows}1f` };
      case 'update':
        return { backgroundColor: `${dataTableAppearance.statusColors.modifiedValues}22` };
      case 'delete':
        return { backgroundColor: `${dataTableAppearance.statusColors.softDeletedRows}18` };
      default:
        return undefined;
    }
  }, [dataTableAppearance.statusColors, mutations]);
  const getSelectedRowInlineStyle = useCallback((rowIndex: number): CSSProperties | undefined => {
    const baseStyle = rowInlineStyle(rowIndex) || {};
    const isSelected = selectedRowSet.has(rowIndex);
    const isActive = selectedRowIndex === rowIndex;

    if (!isSelected && !isActive) {
      return Object.keys(baseStyle).length > 0 ? baseStyle : undefined;
    }

    return {
      ...baseStyle,
      backgroundColor: `${dataTableAppearance.statusColors.selectionCursor}${isActive ? '2b' : '22'}`,
      boxShadow: isActive ? `inset 0 0 0 1px ${dataTableAppearance.statusColors.selectionCursor}80` : undefined,
    };
  }, [dataTableAppearance.statusColors.selectionCursor, rowInlineStyle, selectedRowIndex, selectedRowSet]);

  // Map original column indices to visible indices
  const columnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    columnNames.forEach((col, idx) => map.set(col, idx));
    return map;
  }, [columnNames]);

  const toggleColumnMask = (name: string) => {
    setMaskOverrides(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const isColumnMasked = (name: string) => maskedColumnSet.has(name);

  // Sync local data with props
  useEffect(() => {
    setLocalData(applyStagedRows(columnNames, data, mutations.state.changes));
  }, [columnNames, data, mutations.state.changes]);

  // Optimized resize handlers using direct DOM manipulation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumnRef.current) return;
      
      // Cancel any pending RAF
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      
      // Use RAF for smooth updates
      rafId.current = requestAnimationFrame(() => {
        const delta = e.clientX - resizeStartX.current;
        const newWidth = Math.max(MIN_COLUMN_WIDTH, resizeStartWidth.current + delta);
        const columnName = resizingColumnRef.current;
        
        if (columnName && tableRef.current) {
          // Direct DOM update for smoothness
          const headerCells = tableRef.current.querySelectorAll('th');
          const bodyCells = tableRef.current.querySelectorAll('td');
          
          headerCells.forEach((cell) => {
            if (cell.getAttribute('data-column') === columnName) {
              cell.style.width = `${newWidth}px`;
              cell.style.minWidth = `${newWidth}px`;
              cell.style.maxWidth = `${newWidth}px`;
            }
          });
          
          bodyCells.forEach((cell) => {
            if (cell.getAttribute('data-column') === columnName) {
              cell.style.width = `${newWidth}px`;
              cell.style.minWidth = `${newWidth}px`;
              cell.style.maxWidth = `${newWidth}px`;
            }
          });
          
          // Also update ref for persistence
          columnWidthsRef.current[columnName] = newWidth;
        }
      });
    };

    const handleMouseUp = () => {
      if (resizingColumnRef.current) {
        resizingColumnRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Force one update to sync state with refs
        forceUpdate(n => n + 1);
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  const handleResizeStart = useCallback((columnName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidthsRef.current[columnName] || DEFAULT_COLUMN_WIDTH;
    resizingColumnRef.current = columnName;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const getColumnWidth = useCallback((columnName: string): number => {
    return columnWidthsRef.current[columnName] || DEFAULT_COLUMN_WIDTH;
  }, []);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnName: string } | null>(null);
  const lastCellPressRef = useRef<CellPress | null>(null);
  const pendingCellEditRef = useRef<CellPress | null>(null);
  const contextCellRef = useRef<{ rowIndex: number; columnName: string } | null>(null);

  const canEditRow = (rowIndex: number) => {
    if (readOnly || mutations.getRowState(rowIndex)?.type === 'delete') return false;
    return mutations.getRowState(rowIndex)?.type === 'insert'
      || !!rowIdentity(columnNames, data[rowIndex] || [], pkColumns);
  };

  const startEditingCell = (rowIndex: number, columnName: string) => {
    if (!canEditRow(rowIndex)) return;
    setEditingCell({ rowIndex, columnName });
  };

  const handleCellEdit = (rowIndex: number, columnName: string, newValue: any) => {
    if (readOnly) return;
    const columnIndex = columnNames.indexOf(columnName);
    const rowData = localData[rowIndex];
    const originalValue = rowData[columnIndex];
    
    if (originalValue === newValue) return;
    const originalData = data[rowIndex] || rowData;
    if (mutations.getRowState(rowIndex)?.type !== 'insert'
      && !rowIdentity(columnNames, originalData, pkColumns)) return;

    // Update local data
    const newData = [...localData];
    newData[rowIndex] = [...rowData];
    newData[rowIndex][columnIndex] = newValue;
    setLocalData(newData);

    mutations.updateCell(rowIndex, columnName, columnIndex, originalValue, newValue, originalData);
  };

  const getRowStyle = useCallback((rowIndex: number): string => {
    const change = mutations.getRowState(rowIndex);
    if (!change) return '';
    
    switch (change.type) {
      case 'insert': return 'border-l-2';
      case 'update': return 'border-l-2';
      case 'delete': return 'border-l-2 opacity-50';
      default: return '';
    }
  }, [mutations]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    if (readOnly) return;
    const rowData = localData[rowIndex];
    if (!rowData) return;
    
    if (mutations.getRowState(rowIndex)?.type !== 'insert'
      && !rowIdentity(columnNames, data[rowIndex] || [], pkColumns)) return;
    mutations.deleteRow(rowIndex, data[rowIndex] || rowData);
  }, [localData, data, pkColumns, columnNames, mutations, readOnly]);

  const handleDuplicateRow = useCallback((rowIndex: number) => {
    if (readOnly) return;
    const rowData = localData[rowIndex];
    if (!rowData) return;
    
    onDuplicateRow([...rowData]);
  }, [localData, onDuplicateRow, readOnly]);

  const handleEditRowQuery = (rowIndex: number) => {
    const columnName = getContextEditColumn(contextCellRef.current, rowIndex, visibleColumnNames);
    if (columnName) startEditingCell(rowIndex, columnName);
  };

  const getCellStyle = useCallback((rowIndex: number, columnName: string): CSSProperties | undefined => {
    const change = mutations.getRowState(rowIndex);
    if (change?.type === 'update' && change.cellChanges) {
      const cellChanged = change.cellChanges.some(c => c.columnName === columnName);
      if (cellChanged) return { backgroundColor: `${dataTableAppearance.statusColors.modifiedValues}22` };
    }
    return undefined;
  }, [dataTableAppearance.statusColors.modifiedValues, mutations]);

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<any[]>();
    return visibleColumnNames.map((name) => {
      const originalIndex = columnIndexMap.get(name) ?? 0;
      return columnHelper.accessor(row => row[originalIndex], {
        id: name,
        header: () => {
          const isSorted = sortConfig?.column === name;
          const sortDirection = sortConfig?.direction;
          return (
            <div className="flex items-center justify-between w-full h-full">
              <div 
                className="flex items-center gap-1 cursor-pointer select-none group flex-1 min-w-0"
                onClick={() => onSort?.(name)}
              >
                <span className="truncate">{name}</span>
                <span className={`transition-opacity flex-shrink-0 ${isSorted ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                  {isSorted && sortDirection === 'DESC' ? (
                    <ChevronDown size={14} className="text-[#007acc]" />
                  ) : (
                    <ChevronUp size={14} className={isSorted ? 'text-[#007acc]' : 'text-[#666]'} />
                  )}
                </span>
              </div>
              <button
                type="button"
                aria-label={`${isColumnMasked(name) ? 'Show' : 'Mask'} ${name} column values`}
                title={isColumnMasked(name) ? 'Show column values' : 'Mask column values'}
                className={cn('shrink-0 ml-1 text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  !isColumnMasked(name) && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
                onClick={(event) => { event.stopPropagation(); toggleColumnMask(name); }}
              >
                {isColumnMasked(name) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        },
        cell: info => {
          const value = info.getValue();
          const rowIndex = info.row.index;
          const isDeleted = mutations.getRowState(rowIndex)?.type === 'delete';
          const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === name;
          const foreignKey = !isDeleted && onFollowForeignKey && foreignKeys.find(key =>
            key.source_columns.find(column => visibleColumnNames.includes(column)) === name
              && key.source_columns.every(column => !isColumnMasked(column))
              && filtersForForeignKey(key, columnNames, info.row.original));

          if (isEditing) {
            return (
              <input
                autoFocus
                className="w-full bg-transparent text-text-primary outline-none px-1 py-0 h-full border-0"
                defaultValue={value === null ? '' : String(value)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  setEditingCell(null);
                  handleCellEdit(rowIndex, name, parseCellEditorValue(value, e.target.value));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setEditingCell(null);
                    handleCellEdit(
                      rowIndex,
                      name,
                      parseCellEditorValue(value, (e.target as HTMLInputElement).value)
                    );
                  } else if (e.key === 'Escape') {
                    setEditingCell(null);
                  }
                }}
              />
            );
          }

          return (
            <div 
              className={cn(
                "w-full h-full min-h-[1.5rem] flex items-center",
                isDeleted ? 'line-through opacity-50' : ''
              )}
            >
              {value === null ? (
                <span className="text-text-muted italic opacity-40">NULL</span>
              ) : isColumnMasked(name) ? (
                <SensitiveValue columnName={name} value={value} />
              ) : typeof value === 'boolean' ? (
                <span className="text-blue-400 font-medium">{value ? 'true' : 'false'}</span>
              ) : (
                <span className="truncate text-[#ccc]">{String(value)}</span>
              )}
              {foreignKey && (
                <button
                  type="button"
                  aria-label={`Open referenced row in ${foreignKey.target_table}`}
                  title={`Open referenced row in ${foreignKey.target_table}`}
                  className="ml-1 shrink-0 rounded p-0.5 text-accent hover:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onPointerDown={event => event.stopPropagation()}
                  onPointerUp={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    onFollowForeignKey(foreignKey, info.row.original);
                  }}
                  onDoubleClick={event => event.stopPropagation()}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        },
      });
    });
  }, [visibleColumnNames, columnIndexMap, mutations, sortConfig, onSort, editingCell, localData, pkColumns, maskedColumnSet, foreignKeys, onFollowForeignKey]);

  const table = useReactTable({
    data: localData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();
  const editableRowSet = new Set(rows.filter(row => canEditRow(row.index)).map(row => row.index));

  // No columns at all - truly nothing to show
  if (columnNames.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        No data to display
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Table */}
      <div 
        className="flex-1 overflow-auto bg-background"
        style={{ height: '100%', width: '100%' }}
      >
        <table 
          ref={tableRef}
          className="border-collapse text-xs" 
          style={{ tableLayout: 'fixed', fontFamily: dataTableAppearance.fontFamily, fontSize: `${dataTableAppearance.fontSize}px` }}
        >
          <thead className="sticky top-0 z-10 bg-sidebar border-b border-border shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {showLineNumbers && (
                  <th
                    className="px-3 py-2 text-left font-semibold text-text-muted truncate"
                    style={{ width: 48, minWidth: 48, maxWidth: 48, ...headerCellStyle, ...rowNumberStyle }}
                  >
                    #
                  </th>
                )}
                {headerGroup.headers.map(header => {
                  const width = getColumnWidth(header.id);
                  return (
                    <th 
                      key={header.id}
                      data-column={header.id}
                      className="px-3 py-2 text-left font-semibold text-text-secondary truncate relative group"
                      style={{ 
                        width,
                        minWidth: MIN_COLUMN_WIDTH,
                        maxWidth: width,
                        ...headerCellStyle
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {/* Resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize bg-transparent hover:bg-[#007acc] transition-colors"
                        onMouseDown={(e) => handleResizeStart(header.id, e)}
                        style={{ transform: 'translateX(50%)' }}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowContextMenu
                key={row.id}
                rowIndex={row.index}
                rowData={row.original}
                allRows={localData}
                selectedRowIndices={selectedRowIndices}
                columnNames={columnNames}
                maskedColumns={maskedColumnNames}
                onEdit={() => handleEditRowQuery(row.index)}
                onDelete={() => handleDeleteRow(row.index)}
                onDuplicate={() => handleDuplicateRow(row.index)}
                canEdit={editableRowSet.has(row.index)}
                canDuplicate={!readOnly}
              >
                <tr 
                  onClick={(event) => onRowClick?.(row.index, event)}
                  className={`hover:bg-accent/5 border-b border-border group cursor-default outline-none ${
                    selectedRowSet.has(row.index) ? 'text-text-primary' : ''
                  } ${getRowStyle(row.index)}`}
                  style={{
                    ...getSelectedRowInlineStyle(row.index),
                    borderLeftColor: mutations.getRowState(row.index)?.type === 'insert'
                      ? dataTableAppearance.statusColors.newRows
                      : mutations.getRowState(row.index)?.type === 'update'
                        ? dataTableAppearance.statusColors.modifiedValues
                        : mutations.getRowState(row.index)?.type === 'delete'
                          ? dataTableAppearance.statusColors.softDeletedRows
                          : undefined,
                  }}
                >
                  {showLineNumbers && (
                    <td
                      className="px-3 border-r border-border truncate whitespace-nowrap overflow-hidden text-text-muted"
                      style={{ width: 48, minWidth: 48, maxWidth: 48, ...bodyCellStyle, ...rowNumberStyle }}
                    >
                      {row.index + 1}
                    </td>
                  )}
                  {row.getVisibleCells().map(cell => {
                    const width = getColumnWidth(cell.column.id);
                    return (
                      <td 
                        key={cell.id}
                        data-column={cell.column.id}
                        onContextMenu={() => {
                          contextCellRef.current = { rowIndex: row.index, columnName: cell.column.id };
                          lastCellPressRef.current = null;
                          pendingCellEditRef.current = null;
                        }}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || event.pointerType === 'touch') return;
                          const press: CellPress = {
                            rowIndex: row.index,
                            columnName: cell.column.id,
                            x: event.clientX,
                            y: event.clientY,
                            time: event.timeStamp,
                          };
                          const repeated = isRepeatedCellPress(lastCellPressRef.current, press);
                          lastCellPressRef.current = repeated ? null : press;
                          pendingCellEditRef.current = repeated ? press : null;
                        }}
                        onPointerUp={(event) => {
                          const pending = pendingCellEditRef.current;
                          pendingCellEditRef.current = null;
                          if (pending?.rowIndex === row.index && pending.columnName === cell.column.id
                            && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 5) {
                            startEditingCell(row.index, cell.column.id);
                          }
                        }}
                        onPointerCancel={() => { pendingCellEditRef.current = null; }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          startEditingCell(row.index, cell.column.id);
                        }}
                        className={cn(
                          'px-3 py-1 border-r border-border truncate whitespace-nowrap overflow-hidden',
                          editableRowSet.has(row.index) && 'data-table-editable-cell',
                          editingCell?.rowIndex === row.index && editingCell.columnName === cell.column.id && 'is-editing'
                        )}
                        title={editableRowSet.has(row.index) ? 'Double-click to edit' : undefined}
                        style={{ 
                          width,
                          minWidth: MIN_COLUMN_WIDTH,
                          maxWidth: width,
                          ...bodyCellStyle,
                          ...getCellStyle(row.index, cell.column.id),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              </RowContextMenu>
            ))}
            
            {/* Placeholder rows if empty */}
            {rows.length === 0 && Array.from({ length: 30 }).map((_, i) => (
              <tr key={`placeholder-${i}`} className="border-b border-[#222]">
                {showLineNumbers && (
                  <td
                    key={`placeholder-index-${i}`}
                    className="border-r border-[#222]"
                    style={{ width: 48, minWidth: 48, maxWidth: 48, ...bodyCellStyle }}
                  />
                )}
                {visibleColumnNames.map(col => {
                  const width = getColumnWidth(col);
                  return (
                    <td 
                      key={`placeholder-cell-${i}-${col}`} 
                      className="border-r border-[#222]"
                      style={{ width, minWidth: MIN_COLUMN_WIDTH, maxWidth: width, ...bodyCellStyle }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
