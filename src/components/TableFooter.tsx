import { ChevronLeft, ChevronRight, Columns, Filter, Plus, Download, GitFork, BarChart3 } from 'lucide-react';
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
  onProfileData?: () => void;
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
  onProfileData,
}: TableFooterProps) => {
  const start = displayedRows > 0 ? offset + 1 : 0;
  const end = offset + displayedRows;

  return (
    <div className="relative z-50 flex h-10 shrink-0 items-center justify-between gap-3 overflow-x-auto border-t border-border-strong bg-surface px-2 text-[11px] select-none">
      <div className="flex h-full shrink-0 items-center">
        <div className="mr-3 flex h-7 rounded bg-surface-elevated p-0.5">
          <button 
            onClick={() => onTypeChange('Data')}
            className={cn(
              "px-3 flex items-center rounded-sm transition-colors h-full",
              type === 'Data' ? "bg-sidebar text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Data
          </button>
          <button 
            onClick={() => onTypeChange('Structure')}
            className={cn(
              "px-3 flex items-center rounded-sm transition-colors h-full",
              type === 'Structure' ? "bg-sidebar text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            Structure
          </button>
        </div>

        {onAddRow && (
          <button 
            onClick={onAddRow}
            className="mr-3 flex h-7 items-center gap-1.5 rounded border border-border-strong bg-surface-elevated px-3 text-text-primary transition-colors hover:bg-hover active:bg-hover"
          >
            <Plus size={12} className="text-text-secondary" />
            <span>Row</span>
          </button>
        )}
        {onViewRelationships && (
          <button type="button" onClick={onViewRelationships} title="View declared foreign-key relationships" className="flex h-7 items-center gap-1.5 rounded border border-border-strong bg-surface-elevated px-2.5 text-text-primary transition-colors hover:bg-hover">
            <GitFork size={12} className="text-accent" />
            <span>Map</span>
          </button>
        )}
        {onProfileData && (
          <button type="button" onClick={onProfileData} title="Profile a bounded, read-only sample of rows" className="ml-2 flex h-7 items-center gap-1.5 rounded border border-border-strong bg-surface-elevated px-2.5 text-text-primary transition-colors hover:bg-hover">
            <BarChart3 size={12} className="text-accent" />
            <span>Profile</span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {executionTime !== undefined && (
          <div className="text-text-secondary">
             {executionTime}ms
          </div>
        )}
        <div className="text-text-secondary font-medium flex items-center gap-2">
           <span>{start}-{end}{totalRows === null ? ` rows${hasMore ? '+' : ''}` : ` of ${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`}</span>
           {totalRows === null && (
             <button type="button" onClick={onCountRows} disabled={countingRows}
               className="text-accent hover:underline disabled:opacity-50"
               title="Count all matching rows (may be slow on large tables)">
               {countingRows ? 'Counting...' : 'Count total'}
             </button>
           )}
        </div>

        <div className="flex h-7 items-center rounded border border-border-strong bg-surface-elevated">
           <button 
             onClick={onToggleColumns}
             className={cn(
               "px-3 h-full border-r border-border-strong hover:bg-hover text-text-primary flex items-center gap-1 transition-colors",
               isColumnsVisible && "bg-sidebar"
             )}
           >
             <Columns size={12} className={cn("text-text-secondary", isColumnsVisible && "text-accent")} />
             <span>Columns</span>
           </button>
           {onToggleFilters && <button
             onClick={onToggleFilters}
             className={cn(
               "px-3 h-full hover:bg-hover text-text-primary flex items-center gap-1 transition-colors",
               isFiltersVisible && "bg-sidebar"
             )}
           >
             <Filter size={12} className={cn("text-text-secondary", isFiltersVisible && "text-accent")} />
             <span>Filters</span>
           </button>}
        </div>

        {onExport && (
          <button 
            onClick={onExport}
            className="flex h-7 items-center gap-1.5 rounded border border-border-strong bg-surface-elevated px-3 text-text-primary transition-colors hover:bg-hover"
          >
            <Download size={12} className="text-text-secondary" />
            <span>Export</span>
          </button>
        )}

        <div className="flex h-7 items-center overflow-hidden rounded border border-border-strong bg-surface-elevated">
           <button 
             onClick={() => onPageChange('prev')}
             disabled={offset === 0}
             className="h-full border-r border-border-strong px-3 text-text-primary hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent"
             aria-label="Previous page"
           >
             <ChevronLeft size={14} />
           </button>
           <button 
             onClick={() => onPageChange('next')}
             disabled={!hasMore}
             className="h-full px-3 text-text-primary hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent"
             aria-label="Next page"
           >
             <ChevronRight size={14} />
           </button>
        </div>
      </div>
    </div>
  );
};
