import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Clock, Database as DatabaseIcon } from 'lucide-react';
import { SQLEditor } from './SQLEditor';
import { QueryResultsTable } from './QueryResultsTable';
import { useDatabaseStore } from '../store/databaseStore';

interface TabContentQueryProps {
  id: string;
  initialQuery?: string;
  connectionId: string;
}

export const TabContentQuery = ({ id, initialQuery = '', connectionId }: TabContentQueryProps) => {
  const { updateTab } = useDatabaseStore();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ time: number; rows: number } | null>(null);

  const handleQueryChange = (value: string | undefined) => {
    const newVal = value || '';
    setQuery(newVal);
    updateTab(id, { query: newVal });
  };

  const runQuery = useCallback(async () => {
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);
    const start = performance.now();

    try {
      const result = await invoke<any>('execute_query', { 
        connectionId, 
        sql: query 
      });

      if (result && result.columns) {
        setResults({ columns: result.columns, rows: result.rows });
        setStats({ 
          time: result.execution_time_ms || Math.round(performance.now() - start), 
          rows: result.rows.length 
        });
      }
    } catch (err: any) {
      console.error("[ERROR] Query execution failed:", err);
      setError(err.toString());
      setResults(null);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [query, connectionId, loading]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
      {/* Query Toolbar */}
      <div className="h-9 px-4 flex items-center gap-4 bg-[#2C2C2C] border-b border-[#1e1e1e] shrink-0">
        <button 
          onClick={runQuery}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 bg-accent hover:bg-accent/90 text-white rounded text-[11px] font-bold transition-colors disabled:opacity-50"
        >
          <Play size={12} fill="currentColor" />
          {loading ? 'RUNNING...' : 'RUN'}
        </button>
        
        <div className="flex-1" />

        {stats && (
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <div className="flex items-center gap-1">
              <Clock size={12} />
              <span>{stats.time}ms</span>
            </div>
            <div className="flex items-center gap-1">
              <DatabaseIcon size={12} />
              <span>{stats.rows} rows</span>
            </div>
          </div>
        )}
      </div>

      {/* Editor & Results Split (Simple vertical for now) */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 border-b border-[#3C3C3C] relative min-h-[100px]">
          <SQLEditor 
            value={query} 
            onChange={handleQueryChange} 
            onRun={runQuery}
          />
        </div>
        
        <div className="h-[40%] min-h-[150px] bg-[#1a1a1a] flex flex-col relative overflow-hidden">
          <div className="px-3 py-1 bg-[#252526] text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-[#1e1e1e]">
            Results
          </div>
          
          <div className="flex-1 overflow-auto relative">
            {error ? (
              <div className="p-4 text-red-500 font-mono text-[11px] bg-red-500/5">
                <span className="font-bold">Error:</span> {error}
              </div>
            ) : results ? (
              <QueryResultsTable columns={results.columns} data={results.rows} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted text-[11px] italic h-full">
                {loading ? 'Executing query...' : 'Execute a query to see results'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
