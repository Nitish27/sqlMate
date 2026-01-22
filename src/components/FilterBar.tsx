import { Plus } from 'lucide-react';
import { useDatabaseStore, FilterConfig } from '../store/databaseStore';
import { FilterRow } from './FilterRow';
import { v4 as uuidv4 } from 'uuid';

interface FilterBarProps {
  tabId: string;
  columns: string[];
  filters: FilterConfig[];
}

export const FilterBar = ({ tabId, columns, filters }: FilterBarProps) => {
  const { addFilter, removeFilter, updateFilter, setFilters, triggerRefresh } = useDatabaseStore();

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

  if (filters.length === 0) {
    return (
      <div className="bg-[#2C2C2C] border-b border-[#1e1e1e] p-2 flex items-center justify-between text-xs">
         <span className="text-[#999]">No filters applied</span>
         <button 
           onClick={handleAddFilter}
           className="flex items-center gap-1 px-2 py-1 bg-[#3C3C3C] hover:bg-[#454545] rounded text-white"
         >
           <Plus size={12} />
           Add Filter
         </button>
      </div>
    );
  }

  return (
    <div className="bg-[#2C2C2C] border-b border-[#1e1e1e] p-2 flex flex-col gap-1">
      <div className="flex flex-col">
        {filters.map((filter, index) => (
          <FilterRow
            key={filter.id}
            filter={filter}
            columns={columns}
            onUpdate={(updates) => updateFilter(tabId, filter.id, updates)}
            onRemove={() => removeFilter(tabId, filter.id)}
            onAdd={handleAddFilter}
            isLast={index === filters.length - 1}
            canRemove={true}
          />
        ))}
      </div>
      
      <div className="flex items-center justify-end gap-2 mt-1 pt-1 border-t border-[#333]">
        <button 
          onClick={handleUnset}
          className="px-3 py-1 text-[#999] hover:text-white hover:bg-[#3C3C3C] rounded transition-colors text-xs"
        >
          Unset
        </button>
        <button 
          onClick={handleApply}
          className="px-3 py-1 bg-[#007acc] hover:bg-[#0062a3] text-white rounded shadow-sm text-xs"
        >
          Apply
        </button>
      </div>
    </div>
  );
};
