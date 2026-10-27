import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Trash2, ClipboardCheck, Edit, Eye, FileJson } from 'lucide-react';
import { cn } from '../utils/cn';
import { hasSensitiveColumns } from '../utils/sensitiveData';

interface RowContextMenuProps {
  children: React.ReactNode;
  rowIndex: number;
  rowData: any[];
  allRows: any[][];
  selectedRowIndices?: number[];
  columnNames: string[];
  maskedColumns: string[];
  onEdit: () => void;
  onInspect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  canEdit: boolean;
  canDuplicate: boolean;
}

export const RowContextMenu = ({
  children,
  rowIndex,
  rowData,
  allRows,
  selectedRowIndices = [],
  columnNames,
  maskedColumns,
  onEdit,
  onInspect,
  onDelete,
  onDuplicate,
  canEdit,
  canDuplicate,
}: RowContextMenuProps) => {
  const isPartOfMultiSelection = selectedRowIndices.length > 1 && selectedRowIndices.includes(rowIndex);
  const rowsToCopy = isPartOfMultiSelection
    ? selectedRowIndices.map((index) => allRows[index]).filter((row): row is any[] => Boolean(row))
    : [rowData];

  const confirmRawCopy = () => !(hasSensitiveColumns(columnNames) || maskedColumns.length > 0)
    || window.confirm('These rows include columns that may contain secrets. Copy their raw values to the clipboard?');

  const formatCsvValue = (value: any) => {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
    if (typeof value === 'bigint') return value.toString();
    return String(value);
  };

  const formatSqlValue = (value: any) => {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === 'bigint') return value.toString();
    return String(value);
  };

  const mapRowToObject = (sourceRow: any[]) => Object.fromEntries(
    columnNames.map((columnName, index) => {
      const value = sourceRow[index];
      return [columnName, value === undefined ? null : value];
    })
  );

  const handleCopyAsCSV = () => {
    if (!confirmRawCopy()) return;
    const csv = rowsToCopy
      .map((sourceRow) => sourceRow.map(formatCsvValue).join(','))
      .join('\n');
    navigator.clipboard.writeText(csv);
  };

  const handleCopyAsSQL = () => {
    if (!confirmRawCopy()) return;
    const values = rowsToCopy
      .map((sourceRow) => `(${sourceRow.map(formatSqlValue).join(', ')})`)
      .join(',\n');
    const columns = columnNames.map(c => `"${c}"`).join(', ');
    const sql = `INSERT INTO "table_name" (${columns}) VALUES\n${values};`;
    navigator.clipboard.writeText(sql);
  };

  const handleCopyAsJSON = () => {
    if (!confirmRawCopy()) return;
    const json = JSON.stringify(
      isPartOfMultiSelection ? rowsToCopy.map(mapRowToObject) : mapRowToObject(rowData),
      (_key, value) => typeof value === 'bigint' ? value.toString() : value,
      2
    );
    navigator.clipboard.writeText(json);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {children}
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            "min-w-[200px] bg-[#252526] border border-[#454545] rounded-md overflow-hidden p-1 shadow-xl z-[100]",
            "animate-in fade-in zoom-in duration-100"
          )}
        >
          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onSelect={onInspect}
          >
            <Eye size={14} />
            <span>Inspect value</span>
            <span className="ml-auto text-[10px] text-text-muted">Space</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            disabled={!canEdit}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm data-[disabled]:opacity-40"
            onClick={onEdit}
          >
            <Edit size={14} />
            <span>Edit</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-[#454545] my-1" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={handleCopyAsCSV}
          >
            <Copy size={14} />
            <span>{isPartOfMultiSelection ? 'Copy Rows (CSV)' : 'Copy Row (CSV)'}</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={handleCopyAsJSON}
          >
            <FileJson size={14} />
            <span>{isPartOfMultiSelection ? 'Copy Rows (JSON)' : 'Copy Row (JSON)'}</span>
          </ContextMenu.Item>
          
          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={handleCopyAsSQL}
          >
            <ClipboardCheck size={14} />
            <span>{isPartOfMultiSelection ? 'Copy Rows (SQL Insert)' : 'Copy Row (SQL Insert)'}</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-[#454545] my-1" />

          <ContextMenu.Item
            disabled={!canDuplicate}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm data-[disabled]:opacity-40"
            onClick={onDuplicate}
          >
            <Copy size={14} className="scale-x-[-1]" />
            <span>Duplicate Row</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            disabled={!canEdit}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 outline-none focus:bg-red-500/20 focus:bg-red-900/40 cursor-default rounded-sm data-[disabled]:opacity-40"
            onClick={onDelete}
          >
            <Trash2 size={14} />
            <span>Delete Row</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};
