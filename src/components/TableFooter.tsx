import { ChevronLeft, ChevronRight, Columns, Filter, Plus } from 'lucide-react';
import { cn } from '../utils/cn';

interface TableFooterProps {
  type: 'Data' | 'Structure';
  onTypeChange: (type: 'Data' | 'Structure') => void;
  onAddRow?: () => void;
  offset: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (direction: 'next' | 'prev') => void;
  executionTime?: number;
}

export const TableFooter = ({
  type,
  onTypeChange,
  onAddRow,
  offset,
  pageSize,
  totalRows,
  onPageChange,
  executionTime
}: TableFooterProps) => {
  const start = totalRows > 0 ? offset + 1 : 0;
  const end = Math.min(offset + pageSize, totalRows);

  return (
    <div className="h-8 bg-[#2C2C2C] border-t border-[#1e1e1e] flex items-center justify-between px-2 text-[11px] select-none">
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
      </div>

      <div className="flex items-center gap-6">
        {executionTime !== undefined && (
          <div className="text-[#999999]">
             {executionTime}ms
          </div>
        )}
        <div className="text-[#999999] font-medium">
           {start}-{end} of {totalRows} {totalRows === 1 ? 'row' : 'rows'}
        </div>

        <div className="flex items-center border border-[#444444] rounded bg-[#3C3C3C] h-6">
           <button className="px-3 h-full border-r border-[#444444] hover:bg-[#454545] text-[#cccccc] flex items-center gap-1">
             <Columns size={12} className="text-[#999999]" />
             <span>Columns</span>
           </button>
           <button className="px-3 h-full hover:bg-[#454545] text-[#cccccc] flex items-center gap-1">
             <Filter size={12} className="text-[#999999]" />
             <span>Filters</span>
           </button>
        </div>

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
             disabled={end >= totalRows}
             className="px-3 h-full hover:bg-[#454545] text-[#cccccc] disabled:opacity-30 disabled:hover:bg-transparent"
           >
             <ChevronRight size={14} />
           </button>
        </div>
      </div>
    </div>
  );
};
