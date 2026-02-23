import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Play, Square, Clock, Database as DatabaseIcon, Wand2, List, MessageSquare } from 'lucide-react';
import { SQLEditor } from './SQLEditor';
import { QueryResultsTable } from './QueryResultsTable';
import { useDatabaseStore } from '../store/databaseStore';
import { format } from 'sql-formatter';
import { useStreamingQuery } from '../hooks/useStreamingQuery';

interface TabContentQueryProps {
  id: string;
  initialQuery?: string;
  connectionId: string;
}

type ViewMode = 'data' | 'message';

export const TabContentQuery = ({ id, initialQuery = '', connectionId }: TabContentQueryProps) => {
  const { tabs, updateTab, addToHistory, activeDatabase, setSelectedRow } = useDatabaseStore();
  const tab = useMemo(() => tabs.find(t => t.id === id), [tabs, id]);

  const [query, setQuery] = useState(tab?.query || initialQuery);
  const [viewMode, setViewMode] = useState<ViewMode>((tab?.viewMode as ViewMode) || 'data');
  const [messages, setMessages] = useState<string[]>(tab?.messages || []);
  const [elapsed, setElapsed] = useState(tab?.elapsedTime || 0);
  
  const {
    rows,
    columns,
    isLoading,
    error,
    stats: streamingStats,
    runQuery,
    cancelQuery
  } = useStreamingQuery(connectionId, {
    rows: tab?.rows,
    columns: tab?.columns,
    stats: tab?.stats
  });

  // Targeted sync back to store
  useEffect(() => {
    updateTab(id, { 
      query, 
      viewMode, 
      messages, 
      rows,
      columns,
      stats: streamingStats
    });
  }, [id, query, viewMode, messages, rows, columns, streamingStats]);

  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (!isLoading) {
      stopTimer();
      updateTab(id, { elapsedTime: elapsed });
    }
  }, [isLoading, id, updateTab]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const handleQueryChange = (value: string | undefined) => {
    const newVal = value || '';
    setQuery(newVal);
  };

  const beautifySql = () => {
    try {
      const formatted = format(query, {
        language: 'sql',
        keywordCase: 'upper',
      });
      handleQueryChange(formatted);
    } catch (err) {
      console.error('Failed to format SQL:', err);
    }
  };

  const loadMore = useCallback(() => {}, []);

  const runAll = useCallback(async () => {
    if (!query.trim()) return;
    
    setMessages([`[${new Date().toLocaleTimeString()}] Executing query...`]);
    setViewMode('data');
    startTimer();
    
    await runQuery(query);
  }, [query, runQuery]);

  useEffect(() => {
    if (error) {
      setMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${error}`]);
      setViewMode('message');
    }
    if (streamingStats && !isLoading) {
      setMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] Query complete: ${streamingStats.rows} rows fetched in ${streamingStats.time}ms`]);
      
      addToHistory({
        sql: query,
        connectionId,
        database: activeDatabase || undefined,
        executionTimeMs: streamingStats.time,
        rowsAffected: streamingStats.rows
      });
    }
  }, [error, streamingStats, isLoading, connectionId, activeDatabase, addToHistory, query]);

  const runCurrent = useCallback((selectedText?: string) => {
    const sqlToRun = selectedText || query;
    if (!sqlToRun.trim()) return;
    
    setMessages([`[${new Date().toLocaleTimeString()}] Executing...`]);
    setViewMode('data');
    startTimer();
    runQuery(sqlToRun);
  }, [query, runQuery]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${((ms / 1000)).toFixed(1)}s`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
      {/* Query Toolbar */}
      <div className="h-9 px-4 flex items-center gap-4 bg-[#2C2C2C] border-b border-[#1e1e1e] shrink-0">
        <div className="flex items-center">
          <button 
            onClick={() => runAll()}
            disabled={isLoading}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-colors ${
              isLoading 
                ? 'bg-[#3C3C3C] text-text-muted cursor-not-allowed' 
                : 'bg-[#404040] text-text-primary hover:bg-[#4C4C4C]'
            }`}
          >
            <Play size={14} className={isLoading ? 'text-text-muted' : 'text-green-500'} />
            RUN
          </button>
        </div>

        {isLoading && (
          <button 
            onClick={() => cancelQuery()}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-[11px] font-bold transition-colors"
          >
            <Square size={12} fill="currentColor" />
            STOP
          </button>
        )}

        <button 
          onClick={beautifySql}
          className="flex items-center gap-1.5 px-2 py-1 text-text-muted hover:text-text-primary transition-colors text-[11px]"
          title="Format SQL (Cmd+Shift+F)"
        >
          <Wand2 size={14} />
          BEAUTIFY
        </button>

        <div className="flex-1" />
      </div>

      {/* Stable Flex Layout instead of nested Group to prevent library crashes */}
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* Editor Area */}
        <div className="flex-1 min-h-[100px] flex flex-col">
          <SQLEditor 
            value={query} 
            onChange={handleQueryChange}
            onRun={runCurrent}
            onRunAll={runAll}
            onCancel={cancelQuery}
          />
        </div>

        {/* Static Separator Line */}
        <div className="h-[2px] w-full bg-[#1e1e1e] border-y border-[#3C3C3C] shrink-0" />

        {/* Results Area */}
        <div className="flex-1 min-h-[100px] flex flex-col">
          <div className="h-8 px-4 flex items-center justify-between bg-[#2C2C2C] border-b border-[#1e1e1e] shrink-0">
            <div className="flex gap-4">
              <button 
                onClick={() => setViewMode('data')}
                className={`flex items-center gap-2 h-8 px-1 text-[11px] font-medium border-b-2 transition-colors ${
                  viewMode === 'data' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <DatabaseIcon size={14} />
                DATA
              </button>
              <button 
                onClick={() => setViewMode('message')}
                className={`flex items-center gap-2 h-8 px-1 text-[11px] font-medium border-b-2 transition-colors ${
                  viewMode === 'message' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <MessageSquare size={14} />
                MESSAGE
              </button>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-text-muted">
              {isLoading ? (
                <div className="flex items-center gap-1.5 text-accent animate-pulse font-medium">
                  <Clock size={12} />
                  {formatElapsed(elapsed)}
                  <span className="ml-2 pl-2 border-l border-accent/20">⏳ Loading... {rows.length} rows</span>
                </div>
              ) : streamingStats ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} />
                    {streamingStats.time}ms
                  </div>
                  <div className="flex items-center gap-1.5">
                    <List size={12} />
                    ✓ {rows.length} {streamingStats.totalRows ? `/ ${streamingStats.totalRows}` : ''} rows
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-[#1e1e1e]">
            {viewMode === 'data' ? (
              (rows.length > 0 || columns.length > 0) ? (
                <QueryResultsTable 
                  columns={columns} 
                  data={rows} 
                  onReachBottom={loadMore}
                  isLoadingMore={isLoading}
                  selectedRowIndex={tab?.selectedRowIndex}
                  onSelectRow={(index) => setSelectedRow(id, index)}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-muted text-xs italic h-full p-4">
                  <div>{isLoading ? 'Running query...' : 'Execute a query to see results'}</div>
                  {error && <div className="text-red-400 mt-2 whitespace-pre-wrap">{error}</div>}
                </div>
              )
            ) : (
              <div className="h-full overflow-auto p-4 font-mono text-xs text-text-secondary whitespace-pre-wrap select-text">
                {messages.length > 0 ? messages.join('\n') : 'No messages'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
