import { X, Plus, GripVertical, ChevronDown } from 'lucide-react';
import type { FilterConfig } from '../store/types';

interface FilterRowProps {
  filter: FilterConfig;
  columns: string[];
  onUpdate: (updates: Partial<FilterConfig>) => void;
  onRemove: () => void;
  onAdd: () => void;
  isLast: boolean;
  canRemove: boolean;
}

const OPERATORS = [
  { value: '=', label: 'equals (=)' },
  { value: '!=', label: 'not equal (≠)' },
  { value: '<', label: 'less than (<)' },
  { value: '>', label: 'greater than (>)' },
  { value: '<=', label: 'less or equal (≤)' },
  { value: '>=', label: 'greater or equal (≥)' },
  { value: 'LIKE', label: 'contains' },
  { value: 'ILIKE', label: 'contains (case-insensitive)' },
  { value: 'IN', label: 'in list' },
  { value: 'IS NULL', label: 'is null' },
  { value: 'IS NOT NULL', label: 'is not null' }
];

// Custom styled select component
const StyledSelect = ({ 
  value, 
  onChange, 
  options, 
  minWidth = 120
}: { 
  value: string; 
  onChange: (value: string) => void; 
  options: { value: string; label: string }[];
  minWidth?: number;
}) => {
  return (
    <div className="relative h-full">
      <select 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full pl-3 pr-7 bg-[#1e1e1e] text-white text-xs border border-[#3a3a3a] rounded-md outline-none 
                   focus:border-[#007acc] focus:ring-1 focus:ring-[#007acc]/30
                   hover:border-[#555] transition-colors cursor-pointer
                   appearance-none"
        style={{ minWidth }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-[#252526] text-white py-1">
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[#666]">
        <ChevronDown size={12} />
      </div>
    </div>
  );
};

export const FilterRow = ({
  filter,
  columns,
  onUpdate,
  onRemove,
  onAdd,
  canRemove
}: Omit<FilterRowProps, 'isLast'>) => {
  // Convert columns to options format
  const columnOptions = columns.map(col => ({ value: col, label: col }));
  const needsValue = !['IS NULL', 'IS NOT NULL'].includes(filter.operator);

  return (
    <div className="flex items-center gap-2 h-8 mb-1.5 group">
      {/* Drag handle */}
      <div className="flex items-center justify-center w-5 cursor-move text-[#555] hover:text-[#888] transition-colors">
        <GripVertical size={14} />
      </div>
      
      {/* Enable checkbox */}
      <div className="flex items-center justify-center">
        <input 
          type="checkbox"
          checked={filter.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          className="w-4 h-4 rounded border-[#3a3a3a] bg-[#1e1e1e] text-[#007acc] 
                     focus:ring-[#007acc] focus:ring-offset-0 focus:ring-1
                     cursor-pointer"
        />
      </div>
      
      {/* Column Selector */}
      <StyledSelect
        value={filter.column}
        onChange={(value) => onUpdate({ column: value })}
        options={columnOptions}
        minWidth={150}
      />

      {/* Operator Selector */}
      <StyledSelect
        value={filter.operator}
        onChange={(value) => onUpdate({ operator: value })}
        options={OPERATORS}
        minWidth={100}
      />

      {/* Value Input */}
      <div className="flex-1 h-full">
        <input 
          type="text"
          value={filter.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={needsValue ? "Enter value..." : "(no value needed)"}
          disabled={!needsValue}
          className="w-full h-full px-3 bg-[#1e1e1e] text-white text-xs border border-[#3a3a3a] rounded-md 
                     outline-none focus:border-[#007acc] focus:ring-1 focus:ring-[#007acc]/30
                     hover:border-[#555] transition-colors
                     placeholder:text-[#555] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button 
          onClick={onAdd}
          className="p-1.5 hover:bg-[#3a3a3a] rounded-md text-[#888] hover:text-[#4ade80] transition-colors"
          title="Add filter"
        >
          <Plus size={14} />
        </button>
        
        {canRemove && (
          <button 
            onClick={onRemove}
            className="p-1.5 hover:bg-[#3a3a3a] rounded-md text-[#888] hover:text-[#f87171] transition-colors"
            title="Remove filter"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
