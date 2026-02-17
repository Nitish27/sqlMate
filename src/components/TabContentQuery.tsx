import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Square, Clock, Database as DatabaseIcon, ChevronDown } from 'lucide-react';
import { SQLEditor } from './SQLEditor';
import { QueryResultsTable } from './QueryResultsTable';
import { useDatabaseStore } from '../store/databaseStore';

interface TabContentQueryProps {
  id: string;
  initialQuery?: string;
  connectionId: string;
}

const ROW_LIMITS = [
  { label: '100', value: 100 },
  { label: '500', value: 500 },
  { label: '1,000', value: 1000 },
  { label: '5,000', value: 5000 },
  { label: '10,000', value: 10000 },
  { label: 'No limit', value: 0 },
];

export const TabContentQuery = ({ id, initialQuery = '', connectionId }: TabContentQueryProps) => {
  const { updateTab, addToHistory, activeDatabase } = useDatabaseStore();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ time: number; rows: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [rowLimit, setRowLimit] = useState(1000);
  const [limitDropdownOpen, setLimitDropdownOpen] = useState(false);
  const generationRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Close limit dropdown on outside click
  useEffect(() => {
    if (!limitDropdownOpen) return;
    const handleClick = () => setLimitDropdownOpen(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [limitDropdownOpen]);

  const startTimer = () => {
    setElapsed(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(prev => prev + 100);
    }, 100);
  };

  const stopTimer = () => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const handleQueryChange = (value: string | undefined) => {
    const newVal = value || '';
    setQuery(newVal);
    updateTab(id, { query: newVal });
  };

  // Inject LIMIT into a SELECT query if it doesn't already have one
  const applyLimit = (sql: string, limit: number): string => {
    if (limit === 0) return sql; // No limit
    const trimmed = sql.trim().replace(/;$/, '');
    // Only apply to SELECT queries that don't already have a LIMIT
    if (!/^select/i.test(trimmed)) return sql;
    if (/\blimit\s+\d+/i.test(trimmed)) return sql;
    return `${trimmed} LIMIT ${limit}`;
  };

  const stopQuery = useCallback(() => {
    generationRef.current += 1;
    setLoading(false);
    stopTimer();
    setError('Query cancelled by user');
    setResults(null);
    setStats(null);
  }, []);

  const runQuery = useCallback(async () => {
    if (!query.trim()) return;
    if (loading) {
      stopQuery();
      return;
    }

    const currentGen = ++generationRef.current;
    setLoading(true);
    setError(null);
    startTimer();
    const start = performance.now();

    const effectiveSql = applyLimit(query, rowLimit);

    try {
      const result = await invoke<any>('execute_query', { 
        connectionId, 
        sql: effectiveSql 
      });

      // If generation changed (user clicked Stop), discard result
      if (currentGen !== generationRef.current) return;

      if (result && result.columns) {
        setResults({ columns: result.columns, rows: result.rows });
        const time = result.execution_time_ms || Math.round(performance.now() - start);
        const rowsCount = result.rows.length;
        
        setStats({ 
          time, 
          rows: rowsCount 
        });

        // Add to history
        addToHistory({
          sql: query,
          connectionId,
          database: activeDatabase || undefined,
          executionTimeMs: time,
          rowsAffected: rowsCount
        });
      }
    } catch (err: any) {
      if (currentGen !== generationRef.current) return;
      console.error("[ERROR] Query execution failed:", err);
      setError(err.toString());
      setResults(null);
      setStats(null);
    } finally {
      if (currentGen === generationRef.current) {
        setLoading(false);
        stopTimer();
      }
    }
  }, [query, connectionId, loading, stopQuery, rowLimit]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const currentLimitLabel = ROW_LIMITS.find(l => l.value === rowLimit)?.label || `${rowLimit}`;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
      {/* Query Toolbar */}
      <div className="h-9 px-4 flex items-center gap-4 bg-[#2C2C2C] border-b border-[#1e1e1e] shrink-0">
        <button 
          onClick={runQuery}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-colors ${
            loading 
              ? 'bg-red-600 hover:bg-red-500 text-white' 
              : 'bg-accent hover:bg-accent/90 text-white'
          }`}
        >
          {loading ? (
            <>
              <Square size={10} fill="currentColor" />
              STOP
            </>
          ) : (
            <>
              <Play size={12} fill="currentColor" />
              RUN
            </>
          )}
        </button>

        {loading && (
          <div className="flex items-center gap-1.5 text-[10px] text-yellow-400 font-mono animate-pulse">
            <Clock size={12} />
            <span>{formatElapsed(elapsed)}</span>
          </div>
        )}
        
        <div className="flex-1" />

        {/* Row Limit Dropdown */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLimitDropdownOpen(!limitDropdownOpen);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:bg-[#3C3C3C] transition-colors border border-[#3C3C3C]"
          >
            <span>{rowLimit === 0 ? 'No limit' : `Limit ${currentLimitLabel}`}</span>
            <ChevronDown size={10} />
          </button>
          {limitDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-28 bg-[#2C2C2C] border border-[#3C3C3C] rounded-md shadow-xl overflow-hidden z-50">
              {ROW_LIMITS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setRowLimit(opt.value);
                    setLimitDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent hover:text-white transition-colors ${
                    rowLimit === opt.value ? 'text-accent font-bold' : 'text-text-secondary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {stats && !loading && (
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <div className="flex items-center gap-1">
              <Clock size={12} />
              <span>{stats.time}ms</span>
            </div>
            <div className="flex items-center gap-1">
              <DatabaseIcon size={12} />
              <span>{stats.rows.toLocaleString()} rows</span>
            </div>
          </div>
        )}
      </div>

      {/* Editor & Results Split */}
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
              <div className={`p-4 font-mono text-[11px] ${error === 'Query cancelled by user' ? 'text-yellow-400 bg-yellow-500/5' : 'text-red-500 bg-red-500/5'}`}>
                <span className="font-bold">{error === 'Query cancelled by user' ? 'Cancelled:' : 'Error:'}</span> {error}
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
