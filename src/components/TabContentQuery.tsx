import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Play, Square, Clock, Database as DatabaseIcon, Wand2, List, MessageSquare, ChevronDown, ScanSearch, Sparkles } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { invoke } from '@tauri-apps/api/core';
import { SQLEditor, type SQLEditorHandle } from './SQLEditor';
import { QueryResultsTable } from './QueryResultsTable';
import { QueryPlanInspector } from './QueryPlanInspector';
import { QueryParametersDialog } from './QueryParametersDialog';
import { useDatabaseStore } from '../store/databaseStore';
import { format } from 'sql-formatter';
import { useStreamingQuery } from '../hooks/useStreamingQuery';
import { AiAssistantPanel } from './AiAssistantPanel';
import { effectiveAiAccess } from '../utils/aiConnectionPolicy';
import type { SqlExecutionMode } from '../utils/sqlExecution';
import { requestExecutionApproval } from '../utils/executionPolicy';
import type { QueryPlanResult } from '../utils/queryPlan';
import { findQueryParameters, type QueryParameter } from '../utils/queryParameters';

interface TabContentQueryProps {
  id: string;
  initialQuery?: string;
  connectionId: string;
}

type ViewMode = 'data' | 'message' | 'plan';

export const TabContentQuery = ({ id, initialQuery = '', connectionId }: TabContentQueryProps) => {
  const { tabs, savedConnections, updateTab, addToHistory, activeDatabase, setSelectedRow, toggleSelectedRow, triggerRefresh, refreshTrigger, openTab } = useDatabaseStore();
  const tab = useMemo(() => tabs.find(t => t.id === id), [tabs, id]);
  const connection = savedConnections.find(saved => saved.id === connectionId);
  const databaseType = connection?.type;
  const editorRef = useRef<SQLEditorHandle | null>(null);
  const preparingRef = useRef(false);
  const planRequestRef = useRef(0);
  const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

  const [query, setQuery] = useState(tab?.query || initialQuery);
  const [viewMode, setViewMode] = useState<ViewMode>(tab?.viewMode === 'message' ? 'message' : 'data');
  const [messages, setMessages] = useState<string[]>(tab?.messages || []);
  const [elapsed, setElapsed] = useState(tab?.elapsedTime || 0);
  const [executionScope, setExecutionScope] = useState<'current' | 'selection'>('current');
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);
  const [pendingParameters, setPendingParameters] = useState<{ sql: string; names: string[] } | null>(null);
  const [executedQuery, setExecutedQuery] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<QueryPlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [activeEditorSql, setActiveEditorSql] = useState<string | null>(null);
  const assistantButtonRef = useRef<HTMLButtonElement | null>(null);
  const [assistantWidth, setAssistantWidth] = useState(410);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const queryDatabase = tab?.database || activeDatabase || '';
  
  const {
    rows,
    columns,
    isLoading,
    error,
    stats: streamingStats,
    runQuery,
    cancelQuery
  } = useStreamingQuery(connectionId, tab?.database || activeDatabase || '', {
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
    planRequestRef.current += 1;
    setPlanResult(null);
    setPlanError(null);
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

  useEffect(() => {
    if (error) {
      setMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${error}`]);
      setViewMode('message');
    }
    if (streamingStats && !isLoading && !error && executedQuery) {
      const queryForResult = executedQuery || query;
      const cleanQuery = queryForResult.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim();
      const isDdl = /^\s*(CREATE|DROP|ALTER|RENAME|TRUNCATE)\b/i.test(cleanQuery);
      const isDml = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(queryForResult);
      
      if (isDdl) {
        triggerRefresh();
      }

      let completionMsg = `[${new Date().toLocaleTimeString()}] Query complete: ${streamingStats.rows} rows fetched in ${streamingStats.time}ms`;
      if (streamingStats.affectedRows && streamingStats.affectedRows > 0) {
        completionMsg += `. ${streamingStats.affectedRows} rows affected.`;
      } else if (isDdl || (isDml && streamingStats.affectedRows === 0)) {
        completionMsg = `[${new Date().toLocaleTimeString()}] Query executed successfully in ${streamingStats.time}ms.`;
      }
      
      setMessages(prev => [...prev, completionMsg]);
      
      addToHistory({
        sql: queryForResult,
        connectionId,
        database: activeDatabase || undefined,
        executionTimeMs: streamingStats.time,
        rowsAffected: streamingStats.affectedRows || streamingStats.rows
      });
    }
  }, [error, streamingStats, isLoading, connectionId, activeDatabase, addToHistory, query, executedQuery, triggerRefresh]);

  const executeSql = async (sqlToRun: string, parameters?: QueryParameter[]) => {
    preparingRef.current = true;
    let approvalToken: string | undefined;
    try {
      approvalToken = await requestExecutionApproval(connectionId, tab?.database || activeDatabase || '',
        { kind: 'sql', payload: sqlToRun });
    } catch (error) {
      if (String(error) !== 'Error: Execution cancelled') setExecutionNotice(String(error));
      return;
    } finally {
      preparingRef.current = false;
    }

    setExecutionNotice(null);
    planRequestRef.current += 1;
    setPlanResult(null);
    setPlanError(null);
    setExecutedQuery(sqlToRun);
    setMessages([`[${new Date().toLocaleTimeString()}] Executing...`]);
    setViewMode('data');
    startTimer();
    runQuery(sqlToRun, approvalToken, parameters);
  };

  const runEditorQuery = async (mode: SqlExecutionMode) => {
    if (isLoading || planLoading || preparingRef.current || pendingParameters) return;
    if (!databaseType) {
      setExecutionNotice('Connection type is unavailable. Reconnect before running SQL.');
      return;
    }
    const resolution = editorRef.current?.resolveExecution(mode);
    if (!resolution?.target) {
      setExecutionNotice(resolution?.reason || 'The SQL editor is not ready. Focus it and try again.');
      return;
    }
    const sqlToRun = resolution.target.sql;
    const names = findQueryParameters(sqlToRun);
    if (names.length > 0) {
      if (mode === 'all') {
        setExecutionNotice('Parameterized queries run one SELECT at a time. Place the cursor in one statement and use Run Current.');
        return;
      }
      if (!/^\s*SELECT\b/i.test(sqlToRun)) {
        setExecutionNotice('Parameters currently support SELECT statements only.');
        return;
      }
      setExecutionNotice(null);
      setPendingParameters({ sql: sqlToRun, names });
      return;
    }
    executeSql(sqlToRun);
  };

  const explainEditorQuery = async () => {
    if (isLoading || planLoading || preparingRef.current) return;
    const resolution = editorRef.current?.resolveExecution('current');
    if (!resolution?.target) {
      setExecutionNotice(resolution?.reason || 'Focus a SELECT statement before explaining it.');
      return;
    }
    const sql = resolution.target.sql;
    if (findQueryParameters(sql).length > 0) {
      setExecutionNotice('EXPLAIN with parameters is not available yet. Run the SELECT with parameters instead.');
      return;
    }
    if (!/^\s*SELECT\b/i.test(sql)) {
      setExecutionNotice('Explain currently supports one SELECT statement at a time.');
      return;
    }
    const expectedDatabase = tab?.database || activeDatabase || '';
    const requestId = ++planRequestRef.current;
    preparingRef.current = true;
    try {
      const approvalToken = await requestExecutionApproval(connectionId, expectedDatabase,
        { kind: 'sql', payload: sql }, 'Prepare estimated plan (query not run)');
      if (requestId !== planRequestRef.current) return;
      setExecutionNotice(null);
      setPlanResult(null);
      setPlanError(null);
      setPlanLoading(true);
      setViewMode('plan');
      const result = await invoke<QueryPlanResult>('explain_query', {
        connectionId, expectedDatabase, approvalToken, sql,
      });
      if (requestId === planRequestRef.current) setPlanResult(result);
    } catch (error) {
      if (requestId === planRequestRef.current && String(error) !== 'Error: Execution cancelled') {
        setPlanError(String(error));
        setViewMode('plan');
      }
    } finally {
      preparingRef.current = false;
      setPlanLoading(false);
    }
  };

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${((ms / 1000)).toFixed(1)}s`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
      {pendingParameters && <QueryParametersDialog
        sql={pendingParameters.sql}
        names={pendingParameters.names}
        connectionLabel={`${connection?.name || 'Connection'} / ${queryDatabase || 'default database'}`}
        onCancel={() => setPendingParameters(null)}
        onRun={parameters => {
          const sql = pendingParameters.sql;
          setPendingParameters(null);
          executeSql(sql, parameters);
        }}
      />}
      {/* Query Toolbar */}
      <div className="h-9 px-4 flex items-center gap-4 bg-[#2C2C2C] border-b border-[#1e1e1e] shrink-0">
        <div className="flex items-center">
          <button 
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runEditorQuery('current')}
            disabled={isLoading || planLoading}
            title={`Run ${executionScope === 'selection' ? 'Selection' : 'Current'} (${shortcutModifier}+Enter)`}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-colors ${
              isLoading || planLoading
                ? 'bg-[#3C3C3C] text-text-muted cursor-not-allowed' 
                : 'bg-[#404040] text-text-primary hover:bg-[#4C4C4C]'
            }`}
          >
            <Play size={14} className={isLoading || planLoading ? 'text-text-muted' : 'text-green-500'} />
            {executionScope === 'selection' ? 'Run Selection' : 'Run Current'}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="Query execution options"
                disabled={isLoading || planLoading}
                className="px-1 py-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-[60] min-w-[260px] rounded border border-border bg-surface p-1 shadow-xl text-xs text-text-primary"
              >
                <DropdownMenu.Item
                  onSelect={() => runEditorQuery('current')}
                  className="flex items-center justify-between gap-4 px-3 py-2 rounded outline-none data-[highlighted]:bg-accent/20 cursor-pointer"
                >
                  Run {executionScope === 'selection' ? 'Selection' : 'Current'}
                  <span className="text-text-muted">{shortcutModifier}+Enter</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => runEditorQuery('all')}
                  className="flex items-center justify-between gap-4 px-3 py-2 rounded outline-none data-[highlighted]:bg-accent/20 cursor-pointer"
                >
                  Run All
                  <span className="text-text-muted">{shortcutModifier}+Shift+Enter</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={explainEditorQuery}
          disabled={isLoading || planLoading}
          title={`Explain current SELECT (${shortcutModifier}+Alt+E)`}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-bold text-text-secondary hover:bg-white/5 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ScanSearch size={14} className="text-accent" />
          EXPLAIN
        </button>

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

        <div className="w-[1px] h-4 bg-[#444] mx-1" />

        <button ref={assistantButtonRef} onClick={() => setAssistantOpen(!assistantOpen)} aria-expanded={assistantOpen} aria-controls="query-ai-assistant" className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${assistantOpen ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-accent hover:bg-white/5'}`}>
          <Sparkles size={14} /> AI Assistant
        </button>

        <div className="flex-1" />
      </div>

      {executionNotice && (
        <div role="status" className="px-4 py-2 text-xs text-text-secondary bg-surface border-b border-border">
          {executionNotice}
        </div>
      )}

      {connection?.safetyMode === 'Safe' && !executionNotice && (
        <div role="status" className="px-4 py-2 text-xs text-text-secondary bg-surface border-b border-border">
          Safe mode runs one SELECT at a time in a read-only database context. Writes remain blocked; use a read-only database account for stronger protection.
        </div>
      )}

      {/* Stable Flex Layout instead of nested Group to prevent library crashes */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Editor Area */}
        <div className="flex-1 min-h-[100px] flex flex-col">
          <SQLEditor 
            ref={editorRef}
            tabId={id}
            databaseType={databaseType || 'Postgres'}
            connectionId={connectionId}
            database={tab?.database || activeDatabase || ''}
            refreshTrigger={refreshTrigger}
            value={query} 
            onChange={handleQueryChange}
            onRun={runEditorQuery}
            onExplain={explainEditorQuery}
            onCancel={cancelQuery}
            onExecutionScopeChange={setExecutionScope}
            onActiveStatementChange={setActiveEditorSql}
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
              <button
                onClick={() => setViewMode('plan')}
                className={`flex items-center gap-2 h-8 px-1 text-[11px] font-medium border-b-2 transition-colors ${
                  viewMode === 'plan' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                <ScanSearch size={14} />
                PLAN
              </button>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-text-muted">
              {viewMode === 'plan' ? (
                <span>{planLoading ? 'Preparing plan...' : planResult ? `${planResult.planningTimeMs}ms planning` : 'Estimated plan'}</span>
              ) : isLoading ? (
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
                  {rows.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <List size={12} />
                      ✓ {rows.length} {streamingStats.totalRows ? `/ ${streamingStats.totalRows}` : ''} rows
                    </div>
                  ) : streamingStats.affectedRows ? (
                    <div className="flex items-center gap-1.5 text-green-400">
                      ✓ {streamingStats.affectedRows} rows affected
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-green-400">
                      ✓ Success
                    </div>
                  )}
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
                  selectedRowIndices={tab?.selectedRowIndices}
                  onSelectRow={(index, event) => {
                    if (event.metaKey || event.ctrlKey) {
                      toggleSelectedRow(id, index);
                      return;
                    }
                    setSelectedRow(id, index);
                  }}
                  onContextSelectRow={(index) => setSelectedRow(id, index)}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-muted text-xs italic h-full p-4">
                  <div>{isLoading ? 'Running query...' : 'Execute a query to see results'}</div>
                  {error && <div className="text-red-400 mt-2 whitespace-pre-wrap">{error}</div>}
                </div>
              )
            ) : viewMode === 'plan' ? (
              <QueryPlanInspector result={planResult} isLoading={planLoading} error={planError} />
            ) : (
              <div className="h-full overflow-auto p-4 font-mono text-xs text-text-secondary whitespace-pre-wrap select-text">
                {messages.length > 0 ? messages.join('\n') : 'No messages'}
              </div>
            )}
          </div>
        </div>
      </div>
      {assistantOpen && <div id="query-ai-assistant" style={{ width: assistantWidth }} className="relative h-full shrink-0 max-w-[65vw] max-[900px]:absolute max-[900px]:inset-0 max-[900px]:z-40 max-[900px]:!w-full max-[900px]:max-w-none">
        <div role="separator" aria-label="Resize AI assistant" aria-orientation="vertical" tabIndex={0}
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30 focus:bg-accent/30 max-[900px]:hidden"
          onPointerDown={event => { resizeStart.current = { x: event.clientX, width: assistantWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (resizeStart.current) setAssistantWidth(Math.max(300, Math.min(640, resizeStart.current.width + resizeStart.current.x - event.clientX))); }}
          onPointerUp={event => { resizeStart.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { resizeStart.current = null; }}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setAssistantWidth(width => Math.max(300, Math.min(640, width + (event.key === 'ArrowLeft' ? 24 : -24)))); } }}
        />
        <AiAssistantPanel
          connectionId={connectionId}
          connectionLabel={`${connection?.name || 'Unknown connection'} (${connection?.environment || 'unclassified'})`}
          database={queryDatabase}
          aiAllowed={effectiveAiAccess(connection?.environment, connection?.aiEnabled)}
          editor={editorRef}
          currentStatementSql={activeEditorSql}
          onNewQuery={sql => openTab({ type: 'query', title: 'SQL Query', connectionId, database: queryDatabase, query: sql })}
          onClose={() => { setAssistantOpen(false); assistantButtonRef.current?.focus(); }}
        />
      </div>}
      </div>
    </div>
  );
};
