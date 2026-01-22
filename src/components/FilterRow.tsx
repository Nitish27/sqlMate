import { X, Plus, GripVertical } from 'lucide-react';
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
  '=', '<', '>', '<=', '>=', '!=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'
];

export const FilterRow = ({
  filter,
  columns,
  onUpdate,
  onRemove,
  onAdd,
  isLast,
  canRemove
}: FilterRowProps) => {
  return (
    <div className="flex items-center gap-2 h-7 mb-1">
      <div className="flex items-center justify-center w-5 cursor-move text-[#666]">
         <GripVertical size={12} />
      </div>
      
      <input 
        type="checkbox"
        checked={filter.enabled}
        onChange={(e) => onUpdate({ enabled: e.target.checked })}
        className="rounded border-[#444] bg-[#333]"
      />
      
      {/* Column Selector */}
      <div className="relative h-full">
        <select 
          value={filter.column}
          onChange={(e) => onUpdate({ column: e.target.value })}
          className="h-full px-2 bg-[#333] text-white text-xs border border-[#444] rounded outline-none focus:border-[#666] min-w-[120px]"
        >
          {columns.map(col => (
            <option key={col} value={col}>{col}</option>
          ))}
        </select>
      </div>

      {/* Operator Selector */}
      <div className="relative h-full">
        <select 
          value={filter.operator}
          onChange={(e) => onUpdate({ operator: e.target.value })}
          className="h-full px-2 bg-[#333] text-white text-xs border border-[#444] rounded outline-none focus:border-[#666] min-w-[80px]"
        >
          {OPERATORS.map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      </div>

      {/* Value Input */}
      <div className="flex-1 h-full">
        <input 
          type="text"
          value={filter.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder="Value"
          className="w-full h-full px-2 bg-[#1e1e1e] text-white text-xs border border-[#444] rounded outline-none focus:border-[#666]"
        />
      </div>

      <div className="flex items-center gap-1">
        {canRemove && (
            <button 
                onClick={onRemove}
                className="p-1 hover:bg-[#454545] rounded text-[#999] hover:text-[#ff6b6b]"
            >
                <X size={12} />
            </button>
        )}
        
        <button 
            onClick={onAdd}
            className="p-1 hover:bg-[#454545] rounded text-[#999] hover:text-[#69db7c]"
        >
            <Plus size={12} />
        </button>
      </div>
    </div>
  );
};
