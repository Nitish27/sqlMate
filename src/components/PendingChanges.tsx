import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, RotateCcw } from 'lucide-react';

interface PendingChangesProps {
  statements: string[];
  onCommit: () => void;
  onDiscard: () => void;
  isCommitting?: boolean;
}

export const PendingChanges = ({ 
  statements, 
  onCommit, 
  onDiscard,
  isCommitting = false 
}: PendingChangesProps) => {
  const [expanded, setExpanded] = useState(true);

  if (statements.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-yellow-500/30 bg-[#252526]">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-yellow-500/10 cursor-pointer hover:bg-yellow-500/15 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-xs font-medium text-yellow-500">
            {statements.length} pending change(s)
          </span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onDiscard}
            disabled={isCommitting}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-white border border-border rounded hover:bg-border transition-colors disabled:opacity-50"
          >
            <RotateCcw size={10} />
            Discard
          </button>
          <button
            onClick={onCommit}
            disabled={isCommitting}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 transition-colors font-medium disabled:opacity-50"
          >
            <Check size={10} />
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>

      {/* SQL Preview */}
      {expanded && (
        <div className="p-3 max-h-48 overflow-auto font-mono text-[11px] space-y-1">
          {statements.map((sql, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="text-text-muted select-none">{index + 1}.</span>
              <code className={`flex-1 ${
                sql.startsWith('INSERT') ? 'text-green-400' :
                sql.startsWith('UPDATE') ? 'text-yellow-400' :
                sql.startsWith('DELETE') ? 'text-red-400' : 'text-text-primary'
              }`}>
                {sql}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
