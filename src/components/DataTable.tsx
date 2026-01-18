import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { UseTableMutationsReturn } from '../hooks/useTableMutations';

interface DataTableProps {
  columns: string[];
  data: any[][];
  mutations: UseTableMutationsReturn;
  selectedRowIndex?: number | null;
  onRowClick?: (index: number | null) => void;
}

interface EditingCell {
  rowIndex: number;
  columnIndex: number;
}

export const DataTable = ({ 
  columns: columnNames, 
  data,
  mutations,
  selectedRowIndex,
  onRowClick
}: DataTableProps) => {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [localData, setLocalData] = useState<any[][]>(data);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local data with props
  useEffect(() => {
    setLocalData(data);
  }, [data]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const startEditing = useCallback((rowIndex: number, columnIndex: number, value: any) => {
    setEditingCell({ rowIndex, columnIndex });
    setEditValue(value === null ? '' : String(value));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;

    const { rowIndex, columnIndex } = editingCell;
    const columnName = columnNames[columnIndex];
    const originalValue = data[rowIndex]?.[columnIndex];
    
    // Parse value back to appropriate type
    let newValue: any = editValue;
    if (editValue === '' || editValue.toLowerCase() === 'null') {
      newValue = null;
    } else if (originalValue !== null && typeof originalValue === 'number') {
      newValue = parseFloat(editValue) || 0;
    } else if (originalValue !== null && typeof originalValue === 'boolean') {
      newValue = editValue.toLowerCase() === 'true';
    }

    // Update local data
    setLocalData(prev => {
      const next = prev.map(row => [...row]);
      if (next[rowIndex]) {
        next[rowIndex][columnIndex] = newValue;
      }
      return next;
    });

    // Track the mutation
    mutations.updateCell(rowIndex, columnName, columnIndex, originalValue, newValue);

    cancelEditing();
  }, [editingCell, editValue, columnNames, data, mutations, cancelEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEditing();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      // Move to next cell
      if (editingCell) {
        const nextCol = editingCell.columnIndex + 1;
        if (nextCol < columnNames.length) {
          const value = localData[editingCell.rowIndex]?.[nextCol];
          startEditing(editingCell.rowIndex, nextCol, value);
        }
      }
    }
  }, [commitEdit, cancelEditing, editingCell, columnNames.length, localData, startEditing]);

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

  const getCellStyle = useCallback((rowIndex: number, columnName: string): string => {
    const change = mutations.getRowState(rowIndex);
    if (change?.type === 'update' && change.cellChanges) {
      const cellChanged = change.cellChanges.some(c => c.columnName === columnName);
      if (cellChanged) return 'bg-yellow-500/20';
    }
    return '';
  }, [mutations]);

  const columns = useMemo(() => {
    const helper = createColumnHelper<any[]>();
    return columnNames.map((name, index) => 
      helper.accessor(row => row[index], {
        id: name,
        header: name,
        cell: info => {
          const value = info.getValue();
          const rowIndex = info.row.index;
          const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnIndex === index;
          const isDeleted = mutations.getRowState(rowIndex)?.type === 'delete';

          if (isEditing) {
            return (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitEdit}
                className="w-full bg-accent/20 border border-accent rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              />
            );
          }

          return (
            <span 
              className={`cursor-text ${isDeleted ? 'line-through' : ''}`}
              onDoubleClick={() => !isDeleted && startEditing(rowIndex, index, value)}
            >
              {value === null ? (
                <span className="text-text-muted italic">NULL</span>
              ) : typeof value === 'boolean' ? (
                value ? 'true' : 'false'
              ) : (
                String(value)
              )}
            </span>
          );
        },
      })
    );
  }, [columnNames, editingCell, editValue, handleKeyDown, commitEdit, startEditing, mutations]);

  const table = useReactTable({
    data: localData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  // Empty state
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
        <table className="w-full border-collapse text-xs" style={{ minWidth: 'max-content' }}>
          <thead className="sticky top-0 z-10 bg-sidebar border-b border-border shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                <th className="w-10 px-2 py-2 border-r border-border bg-sidebar text-text-muted font-normal text-center">#</th>
                {headerGroup.headers.map(header => (
                  <th 
                    key={header.id}
                    className="px-3 py-2 text-left font-semibold text-text-secondary border-r border-border min-w-[150px] truncate"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr 
                key={row.id}
                onClick={() => onRowClick?.(index)}
                className={`hover:bg-accent/5 border-b border-border group cursor-default outline-none ${
                   selectedRowIndex === index ? 'bg-[#2a2d2e] ring-1 ring-inset ring-accent/50' : ''
                } ${getRowStyle(index)}`}
              >
                <td className="px-2 py-1 border-r border-border text-center text-text-muted group-hover:bg-accent/10 transition-colors">
                  {index + 1}
                </td>
                {row.getVisibleCells().map(cell => (
                  <td 
                    key={cell.id}
                    className={`px-3 py-1 border-r border-border truncate whitespace-nowrap ${getCellStyle(index, cell.column.id)}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
