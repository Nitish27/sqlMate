import { X, Plus, GripVertical, ChevronDown } from 'lucide-react';
import { FilterConfig } from '../store/databaseStore';

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
        className="h-full pl-3 pr-7 bg-background text-text-primary text-xs border border-border-strong rounded-md outline-none
                   focus:border-accent focus:ring-1 focus:ring-accent/30
                   hover:border-accent transition-colors cursor-pointer
                   appearance-none"
        style={{ minWidth }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-sidebar text-text-primary py-1">
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
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
      <div className="flex items-center justify-center w-5 cursor-move text-text-muted hover:text-text-secondary transition-colors">
        <GripVertical size={14} />
      </div>
      
      {/* Enable checkbox */}
      <div className="flex items-center justify-center">
        <input 
          type="checkbox"
          checked={filter.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          className="w-4 h-4 rounded border-border-strong bg-background text-accent
                     focus:ring-accent focus:ring-offset-0 focus:ring-1
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
          className="w-full h-full px-3 bg-background text-text-primary text-xs border border-border-strong rounded-md
                     outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                     hover:border-accent transition-colors
                     placeholder:text-text-muted disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button 
          onClick={onAdd}
          className="p-1.5 hover:bg-hover rounded-md text-text-secondary hover:text-success-text transition-colors"
          title="Add filter"
        >
          <Plus size={14} />
        </button>
        
        {canRemove && (
          <button 
            onClick={onRemove}
            className="p-1.5 hover:bg-hover rounded-md text-text-secondary hover:text-danger-text transition-colors"
            title="Remove filter"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
