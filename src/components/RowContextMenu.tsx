import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Trash2, ClipboardCheck, Edit, FileJson } from 'lucide-react';
import { cn } from '../utils/cn';

interface RowContextMenuProps {
  children: React.ReactNode;
  rowData: any[];
  columnNames: string[];
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export const RowContextMenu = ({
  children,
  rowData,
  columnNames,
  onEdit,
  onDelete,
  onDuplicate,
}: RowContextMenuProps) => {
  const handleCopyAsCSV = () => {
    const csv = rowData.map(val => {
      if (val === null) return 'NULL';
      if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
      return String(val);
    }).join(',');
    navigator.clipboard.writeText(csv);
  };

  const handleCopyAsSQL = () => {
    const values = rowData.map(val => {
      if (val === null) return 'NULL';
      if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
      return String(val);
    }).join(', ');
    const columns = columnNames.map(c => `"${c}"`).join(', ');
    const sql = `INSERT INTO "table_name" (${columns}) VALUES (${values});`;
    navigator.clipboard.writeText(sql);
  };

  const handleCopyAsJSON = () => {
    const json = JSON.stringify(
      Object.fromEntries(
        columnNames.map((columnName, index) => {
          const value = rowData[index];
          return [columnName, value === undefined ? null : value];
        })
      ),
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
            <span>Copy Row (CSV)</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={handleCopyAsJSON}
          >
            <FileJson size={14} />
            <span>Copy Row (JSON)</span>
          </ContextMenu.Item>
          
          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={handleCopyAsSQL}
          >
            <ClipboardCheck size={14} />
            <span>Copy Row (SQL Insert)</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-[#454545] my-1" />

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary outline-none focus:bg-[#094771] focus:text-white cursor-default rounded-sm"
            onClick={onDuplicate}
          >
            <Copy size={14} className="scale-x-[-1]" />
            <span>Duplicate Row</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 outline-none focus:bg-red-500/20 focus:bg-red-900/40 cursor-default rounded-sm"
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
