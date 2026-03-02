import { Plus, Filter } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useUIStore } from '../store/uiStore';
import type { FilterConfig } from '../store/types';
import { FilterRow } from './FilterRow';
import { v4 as uuidv4 } from 'uuid';

interface FilterBarProps {
  tabId: string;
  columns: string[];
  filters: FilterConfig[];
}

export const FilterBar = ({ tabId, columns, filters }: FilterBarProps) => {
  const { addFilter, removeFilter, updateFilter, setFilters } = useWorkspaceStore();
  const triggerRefresh = useUIStore(s => s.triggerRefresh);

  const handleAddFilter = () => {
    addFilter(tabId, {
      id: uuidv4(),
      column: columns[0] || '',
      operator: '=',
      value: '',
      enabled: true
    });
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
      <div className="bg-[#252526] border-b border-[#1a1a1a] px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#888]">
          <Filter size={14} className="text-[#666]" />
          <span>No filters applied</span>
        </div>
        <button 
          onClick={handleAddFilter}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#007acc] hover:bg-[#0069b3] rounded-md text-white text-xs font-medium transition-colors shadow-sm"
        >
          <Plus size={12} />
          Add Filter
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#252526] border-b border-[#1a1a1a] px-3 py-2.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-[#888]">
          <Filter size={14} className="text-[#007acc]" />
          <span className="text-[#ccc]">{enabledFiltersCount} active filter{enabledFiltersCount !== 1 ? 's' : ''}</span>
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
      <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-[#333]">
        <button 
          onClick={handleUnset}
          className="px-4 py-1.5 text-[#888] hover:text-white hover:bg-[#3a3a3a] rounded-md transition-colors text-xs font-medium"
        >
          Clear All
        </button>
        <button 
          onClick={handleApply}
          className="px-4 py-1.5 bg-[#007acc] hover:bg-[#0069b3] text-white rounded-md shadow-sm text-xs font-medium transition-colors"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};
