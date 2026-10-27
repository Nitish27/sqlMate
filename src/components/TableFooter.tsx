import { ChevronLeft, ChevronRight, Columns, Filter, Plus, Download, GitFork } from 'lucide-react';
import { cn } from '../utils/cn';

interface TableFooterProps {
  type: 'Data' | 'Structure';
  onTypeChange: (type: 'Data' | 'Structure') => void;
  onAddRow?: () => void;
  offset: number;
  totalRows: number | null;
  displayedRows: number;
  hasMore: boolean;
  countingRows: boolean;
  onCountRows: () => void;
  onPageChange: (direction: 'next' | 'prev') => void;
  executionTime?: number;
  onToggleFilters?: () => void;
  isFiltersVisible?: boolean;
  onToggleColumns?: () => void;
  isColumnsVisible?: boolean;
  onExport?: () => void;
  onViewRelationships?: () => void;
}

export const TableFooter = ({
  type,
  onTypeChange,
  onAddRow,
  offset,
  totalRows,
  displayedRows,
  hasMore,
  countingRows,
  onCountRows,
  onPageChange,
  executionTime,
  onToggleFilters,
  isFiltersVisible,
  onToggleColumns,
  isColumnsVisible,
  onExport,
  onViewRelationships,
}: TableFooterProps) => {
  const start = displayedRows > 0 ? offset + 1 : 0;
  const end = offset + displayedRows;

  return (
    <div className="h-8 bg-[#2C2C2C] border-t border-[#1e1e1e] flex items-center justify-between px-2 text-[11px] select-none relative z-50">
      <div className="flex items-center h-full">
        <div className="flex bg-[#3C3C3C] rounded p-0.5 h-6 mr-3">
          <button 
            onClick={() => onTypeChange('Data')}
            className={cn(
              "px-3 flex items-center rounded-sm transition-colors h-full",
              type === 'Data' ? "bg-[#555555] text-white shadow-sm" : "text-[#999999] hover:text-white"
            )}
          >
            Data
          </button>
          <button 
            onClick={() => onTypeChange('Structure')}
            className={cn(
              "px-3 flex items-center rounded-sm transition-colors h-full",
              type === 'Structure' ? "bg-[#555555] text-white shadow-sm" : "text-[#999999] hover:text-white"
            )}
          >
            Structure
          </button>
        </div>

        {onAddRow && (
          <button 
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-3 h-6 bg-[#3C3C3C] border border-[#444444] rounded text-white hover:bg-[#454545] transition-colors mr-3 active:bg-[#505050]"
          >
            <Plus size={12} className="text-gray-400" />
            <span>Row</span>
          </button>
        )}
        {onViewRelationships && (
          <button type="button" onClick={onViewRelationships} title="View declared foreign-key relationships" className="flex h-6 items-center gap-1.5 rounded border border-[#444444] bg-[#3C3C3C] px-2.5 text-[#cccccc] transition-colors hover:bg-[#454545] hover:text-white">
            <GitFork size={12} className="text-accent" />
            <span>Map</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
        {executionTime !== undefined && (
          <div className="text-[#999999]">
             {executionTime}ms
          </div>
        )}
        <div className="text-[#999999] font-medium flex items-center gap-2">
           <span>{start}-{end}{totalRows === null ? ` rows${hasMore ? '+' : ''}` : ` of ${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`}</span>
           {totalRows === null && (
             <button type="button" onClick={onCountRows} disabled={countingRows}
               className="text-accent hover:underline disabled:opacity-50"
               title="Count all matching rows (may be slow on large tables)">
               {countingRows ? 'Counting...' : 'Count total'}
             </button>
           )}
        </div>

        <div className="flex items-center border border-[#444444] rounded bg-[#3C3C3C] h-6">
           <button 
             onClick={onToggleColumns}
             className={cn(
               "px-3 h-full border-r border-[#444444] hover:bg-[#454545] text-[#cccccc] flex items-center gap-1 transition-colors",
               isColumnsVisible && "bg-[#555555] text-white"
             )}
           >
             <Columns size={12} className={cn("text-[#999999]", isColumnsVisible && "text-white")} />
             <span>Columns</span>
           </button>
           <button 
             onClick={onToggleFilters}
             className={cn(
               "px-3 h-full hover:bg-[#454545] text-[#cccccc] flex items-center gap-1 transition-colors",
               isFiltersVisible && "bg-[#555555] text-white"
             )}
           >
             <Filter size={12} className={cn("text-[#999999]", isFiltersVisible && "text-white")} />
             <span>Filters</span>
           </button>
        </div>

        {onExport && (
          <button 
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 h-6 bg-[#3C3C3C] border border-[#444444] rounded text-[#cccccc] hover:bg-[#454545] hover:text-white transition-colors"
          >
            <Download size={12} className="text-[#999999]" />
            <span>Export</span>
          </button>
        )}

        <div className="flex items-center border border-[#444444] rounded bg-[#3C3C3C] h-6 overflow-hidden">
           <button 
             onClick={() => onPageChange('prev')}
             disabled={offset === 0}
             className="px-3 h-full border-r border-[#444444] hover:bg-[#454545] text-[#cccccc] disabled:opacity-30 disabled:hover:bg-transparent"
           >
             <ChevronLeft size={14} />
           </button>
           <button 
             onClick={() => onPageChange('next')}
             disabled={!hasMore}
             className="px-3 h-full hover:bg-[#454545] text-[#cccccc] disabled:opacity-30 disabled:hover:bg-transparent"
           >
             <ChevronRight size={14} />
           </button>
        </div>
      </div>
    </div>
  );
};
