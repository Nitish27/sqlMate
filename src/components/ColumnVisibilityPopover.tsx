import { useRef } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { useOutsideClick } from '../hooks/useOutsideClick';

interface ColumnVisibilityPopoverProps {
  tabId: string;
  columns: string[];
  hiddenColumns: string[];
  onClose: () => void;
}

export const ColumnVisibilityPopover = ({
  tabId,
  columns,
  hiddenColumns,
  onClose
}: ColumnVisibilityPopoverProps) => {
  const { toggleColumnVisibility, showAllColumns, hideAllColumns } = useDatabaseStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  useOutsideClick(popoverRef, onClose);

  const visibleCount = columns.length - hiddenColumns.length;

  return (
    <div ref={popoverRef} className="absolute bottom-full right-0 mb-2 bg-[#2C2C2C] border border-[#444] rounded-lg shadow-xl z-[60] min-w-[200px] max-h-[300px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#444]">
        <span className="text-xs font-medium text-white">
          Columns ({visibleCount}/{columns.length})
        </span>
        <button 
          onClick={onClose}
          className="p-0.5 hover:bg-[#454545] rounded text-[#999] hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#333]">
        <button 
          onClick={() => showAllColumns(tabId)}
          className="flex-1 px-2 py-1 text-[10px] bg-[#3C3C3C] hover:bg-[#454545] rounded text-[#ccc] flex items-center justify-center gap-1"
        >
          <Eye size={10} />
          Show All
        </button>
        <button 
          onClick={() => hideAllColumns(tabId, columns)}
          className="flex-1 px-2 py-1 text-[10px] bg-[#3C3C3C] hover:bg-[#454545] rounded text-[#ccc] flex items-center justify-center gap-1"
        >
          <EyeOff size={10} />
          Hide All
        </button>
      </div>

      {/* Column list */}
      <div className="flex-1 overflow-y-auto py-1">
        {columns.map(column => {
          const isHidden = hiddenColumns.includes(column);
          return (
            <button
              key={column}
              onClick={() => toggleColumnVisibility(tabId, column)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#3C3C3C] text-left text-xs transition-colors"
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                isHidden 
                  ? 'border-[#555] bg-transparent' 
                  : 'border-[#007acc] bg-[#007acc]'
              }`}>
                {!isHidden && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`truncate ${isHidden ? 'text-[#666]' : 'text-[#ccc]'}`}>
                {column}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
