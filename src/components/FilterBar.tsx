import { Plus, Filter } from 'lucide-react';
import { useDatabaseStore, FilterConfig } from '../store/databaseStore';
import { FilterRow } from './FilterRow';
import { v4 as uuidv4 } from 'uuid';
import { createDefaultTableFilter } from '../utils/tableFilters';

interface FilterBarProps {
  tabId: string;
  columns: string[];
  filters: FilterConfig[];
  refreshDisabled?: boolean;
}

export const FilterBar = ({ tabId, columns, filters, refreshDisabled = false }: FilterBarProps) => {
  const { addFilter, removeFilter, updateFilter, setFilters, triggerRefresh } = useDatabaseStore();

  const handleAddFilter = () => {
    addFilter(tabId, createDefaultTableFilter(columns, uuidv4()));
  };

  const handleApply = () => {
    triggerRefresh();
  };

  const handleUnset = () => {
    setFilters(tabId, []);
    triggerRefresh();
  };

  const enabledFiltersCount = filters.filter(f => f.enabled).length;

  if (filters.length === 0) {
    return (
      <div className="bg-sidebar border-b border-border px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Filter size={14} className="text-text-muted" />
          <span>No filters applied</span>
        </div>
        <button 
          onClick={handleAddFilter}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:brightness-110 rounded-md text-accent-contrast text-xs font-medium transition-colors shadow-sm"
        >
          <Plus size={12} />
          Add Filter
        </button>
      </div>
    );
  }

  return (
    <div className="bg-sidebar border-b border-border px-3 py-2.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Filter size={14} className="text-accent" />
          <span className="text-text-primary">{enabledFiltersCount} active filter{enabledFiltersCount !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Filter rows */}
      <div className="flex flex-col">
        {filters.map((filter) => (
          <FilterRow
            key={filter.id}
            filter={filter}
            columns={columns}
            onUpdate={(updates) => updateFilter(tabId, filter.id, updates)}
            onRemove={() => removeFilter(tabId, filter.id)}
            onAdd={handleAddFilter}
            canRemove={true}
          />
        ))}
      </div>
      
      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border">
        <button 
          onClick={handleUnset}
          disabled={refreshDisabled}
          title={refreshDisabled ? 'Apply or discard pending changes first' : undefined}
          className="px-4 py-1.5 text-text-secondary hover:text-text-primary hover:bg-hover rounded-md transition-colors text-xs font-medium disabled:opacity-40"
        >
          Clear All
        </button>
        <button 
          onClick={handleApply}
          disabled={refreshDisabled}
          title={refreshDisabled ? 'Apply or discard pending changes first' : undefined}
          className="px-4 py-1.5 bg-accent hover:brightness-110 text-accent-contrast rounded-md shadow-sm text-xs font-medium transition-colors disabled:opacity-40"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};
