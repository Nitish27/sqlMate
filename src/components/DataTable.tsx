import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { UseTableMutationsReturn } from '../hooks/useTableMutations';
import { SortConfig } from '../store/databaseStore';
import { RowContextMenu } from './RowContextMenu';
import { cn } from '../utils/cn';

interface DataTableProps {
  columns: string[];
  data: any[][];
  mutations: UseTableMutationsReturn;
  selectedRowIndex?: number | null;
  onRowClick?: (index: number | null) => void;
  sortConfig?: SortConfig;
  onSort?: (column: string) => void;
  hiddenColumns?: string[];
  pkColumn?: string;
}

const DEFAULT_COLUMN_WIDTH = 150;
const MIN_COLUMN_WIDTH = 60;

export const DataTable = ({ 
  columns: columnNames, 
  data,
  mutations,
  selectedRowIndex,
  onRowClick,
  sortConfig,
  onSort,
  hiddenColumns = [],
  pkColumn
}: DataTableProps) => {
  const [localData, setLocalData] = useState<any[][]>(data);
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

  // Map original column indices to visible indices
  const columnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    columnNames.forEach((col, idx) => map.set(col, idx));
    return map;
  }, [columnNames]);

  // Sync local data with props
  useEffect(() => {
    setLocalData(data);
  }, [data]);

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

  const handleCellEdit = (rowIndex: number, columnName: string, newValue: any) => {
    const columnIndex = columnNames.indexOf(columnName);
    const rowData = localData[rowIndex];
    const originalValue = rowData[columnIndex];
    
    if (originalValue === newValue) return;

    // Update local data
    const newData = [...localData];
    newData[rowIndex] = [...rowData];
    newData[rowIndex][columnIndex] = newValue;
    setLocalData(newData);

    // Track mutation
    let pkValue = rowIndex;
    if (pkColumn) {
      const pkIndex = columnNames.indexOf(pkColumn);
      if (pkIndex >= 0) {
        pkValue = rowData[pkIndex];
      }
    }
    
    mutations.updateCell(rowIndex, columnName, columnIndex, originalValue, newValue, pkValue);
  };

  // Sync local data with props
  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const getRowStyle = useCallback((rowIndex: number): string => {
    const change = mutations.getRowState(rowIndex);
    if (!change) return '';
    
    switch (change.type) {
      case 'insert': return 'bg-green-500/10 border-l-2 border-l-green-500';
      case 'update': return 'bg-yellow-500/10 border-l-2 border-l-yellow-500';
      case 'delete': return 'bg-red-500/10 border-l-2 border-l-red-500 opacity-50';
      default: return '';
    }
  }, [mutations]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    const rowData = localData[rowIndex];
    if (!rowData) return;
    
    // Find primary key value
    let pkValue = rowIndex; // Fallback to index if no PK
    if (pkColumn) {
      const pkIndex = columnNames.indexOf(pkColumn);
      if (pkIndex >= 0) {
        pkValue = rowData[pkIndex];
      }
    }
    
    mutations.deleteRow(rowIndex, pkValue, rowData);
  }, [localData, pkColumn, columnNames, mutations]);

  const handleDuplicateRow = useCallback((rowIndex: number) => {
    const rowData = localData[rowIndex];
    if (!rowData) return;
    
    // Create new row with same data but marked as "insert"
    const newRow = [...rowData];
    setLocalData(prev => [...prev, newRow]);
    mutations.insertRow(localData.length, newRow);
  }, [localData, mutations]);

  const handleEditRowQuery = useCallback((rowIndex: number) => {
    const rowData = localData[rowIndex];
    if (!rowData) return;
    
    // Find primary key value
    let pkValue = rowIndex;
    if (pkColumn) {
      const pkIndex = columnNames.indexOf(pkColumn);
      if (pkIndex >= 0) {
        pkValue = rowData[pkIndex];
      }
    }
    
    mutations.updateRow(rowIndex, rowData, columnNames, pkValue);
  }, [localData, columnNames, pkColumn, mutations]);

  const getCellStyle = useCallback((rowIndex: number, columnName: string): string => {
    const change = mutations.getRowState(rowIndex);
    if (change?.type === 'update' && change.cellChanges) {
      const cellChanged = change.cellChanges.some(c => c.columnName === columnName);
      if (cellChanged) return 'bg-yellow-500/20';
    }
    return '';
  }, [mutations]);

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
            </div>
          );
        },
        cell: info => {
          const value = info.getValue();
          const rowIndex = info.row.index;
          const isDeleted = mutations.getRowState(rowIndex)?.type === 'delete';
          const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === name;

          if (isEditing) {
            return (
              <input
                autoFocus
                className="w-full bg-accent/20 text-white outline-none px-1 py-0 h-full border-0 rounded-sm"
                defaultValue={value === null ? '' : String(value)}
                onBlur={(e) => {
                  setEditingCell(null);
                  handleCellEdit(rowIndex, name, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setEditingCell(null);
                    handleCellEdit(rowIndex, name, (e.target as HTMLInputElement).value);
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
              onDoubleClick={() => !isDeleted && setEditingCell({ rowIndex, columnName: name })}
            >
              {value === null ? (
                <span className="text-text-muted italic opacity-40">NULL</span>
              ) : typeof value === 'boolean' ? (
                <span className="text-blue-400 font-medium">{value ? 'true' : 'false'}</span>
              ) : (
                <span className="truncate text-[#ccc]">{String(value)}</span>
              )}
            </div>
          );
        },
      });
    });
  }, [visibleColumnNames, columnIndexMap, mutations, sortConfig, onSort, editingCell, localData, pkColumn]);

  const table = useReactTable({
    data: localData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

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
          style={{ tableLayout: 'fixed' }}
        >
          <thead className="sticky top-0 z-10 bg-sidebar border-b border-border shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const width = getColumnWidth(header.id);
                  return (
                    <th 
                      key={header.id}
                      data-column={header.id}
                      className="px-3 py-2 text-left font-semibold text-text-secondary border-r border-border truncate relative group"
                      style={{ 
                        width,
                        minWidth: MIN_COLUMN_WIDTH,
                        maxWidth: width
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
                rowData={row.original}
                columnNames={columnNames}
                onEdit={() => handleEditRowQuery(row.index)}
                onDelete={() => handleDeleteRow(row.index)}
                onDuplicate={() => handleDuplicateRow(row.index)}
              >
                <tr 
                  onClick={() => onRowClick?.(row.index)}
                  className={`hover:bg-accent/5 border-b border-border group cursor-default outline-none ${
                    selectedRowIndex === row.index ? 'bg-[#2a2d2e] ring-1 ring-inset ring-accent/50' : ''
                  } ${getRowStyle(row.index)}`}
                >
                  {row.getVisibleCells().map(cell => {
                    const width = getColumnWidth(cell.column.id);
                    return (
                      <td 
                        key={cell.id}
                        data-column={cell.column.id}
                        className={`px-3 py-1 border-r border-border truncate whitespace-nowrap overflow-hidden ${getCellStyle(row.index, cell.column.id)}`}
                        style={{ 
                          width,
                          minWidth: MIN_COLUMN_WIDTH,
                          maxWidth: width
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
                {visibleColumnNames.map(col => {
                  const width = getColumnWidth(col);
                  return (
                    <td 
                      key={`placeholder-cell-${i}-${col}`} 
                      className="border-r border-[#222] h-7"
                      style={{ width, minWidth: MIN_COLUMN_WIDTH, maxWidth: width }}
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
