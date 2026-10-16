import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, RotateCcw } from 'lucide-react';
import { cn } from '../utils/cn';

interface PendingChangesProps {
  statements: string[];
  changeCount: number;
  onCommit: () => void;
  onDiscard: () => void;
  isCommitting?: boolean;
  error?: string | null;
  disabledReason?: string | null;
  disableDiscard?: boolean;
}

export const PendingChanges = ({ 
  statements,
  changeCount,
  onCommit, 
  onDiscard,
  isCommitting = false,
  error = null,
  disabledReason = null,
  disableDiscard = false,
}: PendingChangesProps) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-t border-yellow-500/30 bg-[#252526] flex flex-col h-full">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-yellow-500/10 cursor-pointer hover:bg-yellow-500/15 transition-colors shrink-0"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-xs font-medium text-yellow-500">
            {changeCount} pending change(s)
          </span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onDiscard}
            disabled={isCommitting || disableDiscard}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-white border border-[#444] rounded hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={10} />
            Discard
          </button>
          <button
            onClick={onCommit}
            disabled={isCommitting || !!disabledReason || statements.length === 0}
            title={disabledReason || undefined}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 transition-colors font-semibold disabled:opacity-50 shadow-sm"
          >
            <Check size={10} />
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>

      {/* SQL Preview / Editor */}
      {expanded && (
        <div className="flex-1 overflow-auto p-3 font-mono text-[11px] space-y-3 bg-[#1e1e1e]">
          <div className="text-text-muted">Preview only. Secret values are redacted here; actual values are bound and all changes save together.</div>
          {(error || disabledReason) && (
            <div className="p-2 mb-2 bg-red-500/10 border border-red-500/30 rounded text-red-500 text-[10px]">
              {error || disabledReason}
            </div>
          )}
          {statements.map((sql, index) => (
            <div key={index} className="flex items-start gap-2 group border-b border-[#333] pb-2 last:border-0">
              <span className="text-text-muted select-none pt-1.5 w-4">{index + 1}.</span>
              <pre
                className={cn(
                  "flex-1 whitespace-pre-wrap break-words p-1.5 tracking-tight leading-relaxed",
                  sql.toUpperCase().startsWith('INSERT') ? 'text-green-400' :
                  sql.toUpperCase().startsWith('UPDATE') ? 'text-yellow-400' :
                  sql.toUpperCase().startsWith('DELETE') ? 'text-red-400' : 'text-text-primary'
                )}
              >{sql}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
