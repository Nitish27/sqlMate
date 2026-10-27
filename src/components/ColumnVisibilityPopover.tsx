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
    <div ref={popoverRef} className="absolute bottom-full right-0 mb-2 bg-sidebar border border-border-strong rounded-lg shadow-xl z-[60] min-w-[200px] max-h-[300px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-strong">
        <span className="text-xs font-medium text-text-primary">
          Columns ({visibleCount}/{columns.length})
        </span>
        <button 
          onClick={onClose}
          className="p-0.5 hover:bg-hover rounded text-text-secondary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1 px-3 py-2 border-b border-border">
        <button 
          onClick={() => showAllColumns(tabId)}
          className="flex-1 px-2 py-1 text-[10px] bg-surface-elevated hover:bg-hover rounded text-text-primary flex items-center justify-center gap-1"
        >
          <Eye size={10} />
          Show All
        </button>
        <button 
          onClick={() => hideAllColumns(tabId, columns)}
          className="flex-1 px-2 py-1 text-[10px] bg-surface-elevated hover:bg-hover rounded text-text-primary flex items-center justify-center gap-1"
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
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-hover text-left text-xs transition-colors"
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                isHidden 
                  ? 'border-border-strong bg-transparent'
                  : 'border-accent bg-accent'
              }`}>
                {!isHidden && (
                  <svg className="w-3 h-3 text-accent-contrast" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`truncate ${isHidden ? 'text-text-muted' : 'text-text-primary'}`}>
                {column}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
