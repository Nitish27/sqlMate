import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useDatabaseStore } from '../store/databaseStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { parseRowDraftContext } from '../utils/rowDrafts';

export const RecoveryBar = () => {
  const { activeConnectionId, activeDatabase, setActiveDatabase, openTab } = useDatabaseStore();
  const drafts = useRecoveryStore(state => state.drafts);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = drafts.map(draft => ({ draft, parts: parseRowDraftContext(draft.context) }))
    .filter(({ parts }) => parts?.[0] === activeConnectionId);
  if (!current.length) return null;

  const openDraft = async (database: string, tableName: string) => {
    if (!activeConnectionId) return;
    setError(null);
    try {
      if (database !== (activeDatabase || '')) await setActiveDatabase(database);
      const existing = useDatabaseStore.getState().tabs.find(tab => tab.type === 'table'
        && tab.connectionId === activeConnectionId && tab.database === database && tab.tableName === tableName);
      if (existing) useDatabaseStore.getState().setActiveTabId(existing.id);
      else openTab({ type: 'table', title: tableName, tableName, connectionId: activeConnectionId, database });
      setExpanded(false);
    } catch (cause) {
      setError(`Could not open saved draft: ${String(cause)}`);
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex items-center gap-2 hover:text-amber-100">
        <AlertCircle size={13} />
        {current.length} table{current.length === 1 ? '' : 's'} with pending edits · Review before committing
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {expanded && (
        <div className="flex flex-wrap gap-2 pt-2">
          {current.map(({ draft, parts }) => parts && (
            <button key={draft.context} onClick={() => void openDraft(parts[1], parts[2])}
              className="rounded border border-amber-500/30 px-2 py-1 hover:bg-amber-500/20"
              title={`Open ${parts[2]} in ${parts[1]} to review pending edits`}>
              {parts[1] ? `${parts[1]}.` : ''}{parts[2]} ({draft.change_count})
            </button>
          ))}
        </div>
      )}
      {error && <div role="alert" className="pt-1 text-red-300">{error}</div>}
    </div>
  );
};
