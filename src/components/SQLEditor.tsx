import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import Editor from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { useDatabaseStore, type SidebarItem } from '../store/databaseStore';
import type { DatabaseType } from '../utils/sqlIdentifiers';
import { findCompletionTable, getColumnSuggestions, getSqlCompletionContext, getTableSuggestions } from '../utils/sqlCompletion';
import { readSqlEditorSnapshot } from '../utils/sqlEditorSnapshot';
import { resolveSqlExecution, type SqlExecutionMode, type SqlExecutionResolution } from '../utils/sqlExecution';

export interface SQLEditorHandle {
  resolveExecution: (mode: SqlExecutionMode) => SqlExecutionResolution;
}

interface SQLEditorProps {
  ref?: Ref<SQLEditorHandle>;
  tabId: string;
  databaseType: DatabaseType;
  connectionId: string;
  database: string;
  refreshTrigger: number;
  value: string;
  onChange: (value: string | undefined) => void;
  onRun?: (mode: SqlExecutionMode) => void;
  onExplain?: () => void;
  onCancel?: () => void;
  onExecutionScopeChange?: (scope: 'current' | 'selection') => void;
}

interface QueryEditorSession {
  model: MonacoEditor.ITextModel;
  viewState: MonacoEditor.ICodeEditorViewState | null;
}

// Only open tabs retain models/undo; closed tabs release their resources.
const queryEditorSessions = new Map<string, QueryEditorSession>();

interface CompletionSchemaEntry {
  loadedAt: number;
  refreshTrigger: number;
  tables: Promise<SidebarItem[]>;
  columns: Map<string, Promise<string[]>>;
}

const completionSchemaCache = new Map<string, CompletionSchemaEntry>();
const COMPLETION_CACHE_MS = 60_000;

const completionContextMatches = (connectionId: string, database: string) => {
  const state = useDatabaseStore.getState();
  return state.activeConnectionId === connectionId && (state.activeDatabase || '') === database;
};

const getCompletionSchema = (connectionId: string, database: string, refreshTrigger: number) => {
  const key = `${connectionId}\0${database}`;
  const cached = completionSchemaCache.get(key);
  if (cached && cached.refreshTrigger === refreshTrigger && Date.now() - cached.loadedAt < COMPLETION_CACHE_MS) {
    return cached;
  }
  const entry: CompletionSchemaEntry = {
    loadedAt: Date.now(), refreshTrigger, columns: new Map(),
    tables: invoke<SidebarItem[]>('get_sql_completion_tables', { connectionId, expectedDatabase: database })
      .catch(() => []),
  };
  completionSchemaCache.set(key, entry);
  return entry;
};

const getCompletionColumns = (entry: CompletionSchemaEntry, connectionId: string, database: string, item: SidebarItem) => {
  const key = `${item.schema || ''}\0${item.name}`;
  const cached = entry.columns.get(key);
  if (cached) return cached;
  const columns = invoke<string[]>('get_sql_completion_columns', {
    connectionId, expectedDatabase: database, tableName: item.name, schema: item.schema || null,
  }).catch(() => []);
  entry.columns.set(key, columns);
  return columns;
};

const unsubscribeSessions = useDatabaseStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  const openTabs = new Set(state.tabs.map(tab => tab.id));
  for (const [id, session] of queryEditorSessions) {
    if (!openTabs.has(id)) {
      if (!session.model.isDisposed()) session.model.dispose();
      queryEditorSessions.delete(id);
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeSessions();
    for (const session of queryEditorSessions.values()) {
      if (!session.model.isDisposed()) session.model.dispose();
    }
    queryEditorSessions.clear();
  });
}

export const SQLEditor = ({
  ref,
  tabId,
  databaseType,
  connectionId,
  database,
  refreshTrigger,
  value,
  onChange,
  onRun,
  onExplain,
  onCancel,
  onExecutionScopeChange,
}: SQLEditorProps) => {
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const sqlEditorAppearance = useDatabaseStore((state) => state.appearanceSettings.sqlEditor);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onRun, onExplain, onCancel, onChange, onExecutionScopeChange, databaseType, connectionId, database, refreshTrigger });
  callbacksRef.current = { onRun, onExplain, onCancel, onChange, onExecutionScopeChange, databaseType, connectionId, database, refreshTrigger };
  const modelPath = `sqlmate-query:///${encodeURIComponent(tabId)}.sql`;

  useEffect(() => {
    if (completionContextMatches(connectionId, database)) {
      void getCompletionSchema(connectionId, database, refreshTrigger).tables;
    }
  }, [connectionId, database, refreshTrigger]);

  const resolveExecution = (mode: SqlExecutionMode): SqlExecutionResolution => {
    const editor = editorRef.current;
    const snapshot = editor && readSqlEditorSnapshot(editor, callbacksRef.current.databaseType);
    return snapshot ? resolveSqlExecution(snapshot, mode) :
      { target: null, reason: 'The SQL editor is not ready. Focus it and try again.' };
  };

  useImperativeHandle(ref, () => ({ resolveExecution }), []);

  useLayoutEffect(() => () => {
    const editor = editorRef.current;
    const session = queryEditorSessions.get(tabId);
    if (editor && session && !session.model.isDisposed()) {
      session.viewState = editor.saveViewState();
      useDatabaseStore.getState().updateTab(tabId, { query: session.model.getValue() });
    }
    cleanupRef.current?.();
    editorRef.current = null;
  }, [tabId]);

  const editorOptions = useMemo(() => ({
    minimap: { enabled: false },
    fontSize: sqlEditorAppearance.fontSize,
    fontFamily: sqlEditorAppearance.fontFamily,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineHeight: Math.round(sqlEditorAppearance.fontSize * sqlEditorAppearance.lineHeight),
    padding: { top: sqlEditorAppearance.padding, bottom: sqlEditorAppearance.padding },
    wordWrap: 'on' as const,
  }), [
    sqlEditorAppearance.fontFamily,
    sqlEditorAppearance.fontSize,
    sqlEditorAppearance.lineHeight,
    sqlEditorAppearance.padding,
  ]);

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        path={modelPath}
        keepCurrentModel
        saveViewState={false}
        defaultLanguage="sql"
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        onChange={onChange}
        options={editorOptions}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          const model = editor.getModel();
          if (!model) return;
          const savedSession = queryEditorSessions.get(tabId);
          if (savedSession?.viewState) editor.restoreViewState(savedSession.viewState);
          queryEditorSessions.set(tabId, { model, viewState: savedSession?.viewState || null });
          callbacksRef.current.onChange(model.getValue());
          const decorations = editor.createDecorationsCollection();
          const updateActiveStatement = () => {
            const resolution = resolveExecution('current');
            const target = resolution.target;
            callbacksRef.current.onExecutionScopeChange?.(target?.scope === 'selection' ? 'selection' : 'current');
            if (!target) {
              decorations.clear();
              return;
            }
            const start = model.getPositionAt(target.startOffset);
            const end = model.getPositionAt(target.endOffset);
            decorations.set([{
              range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
              options: {
                className: 'sql-active-statement',
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            }]);
          };

          updateActiveStatement();
          const subscriptions = [
            editor.onDidChangeCursorSelection(updateActiveStatement),
            editor.onDidChangeModelContent(updateActiveStatement),
          ];
          subscriptions.push(monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.', ' '],
            provideCompletionItems: async (
              candidateModel: MonacoEditor.ITextModel,
              position: { lineNumber: number; column: number },
              token: { isCancellationRequested: boolean },
            ) => {
              if (candidateModel !== model) return { suggestions: [] };
              const { connectionId, database, databaseType, refreshTrigger } = callbacksRef.current;
              if (!completionContextMatches(connectionId, database)) return { suggestions: [] };
              const offset = candidateModel.getOffsetAt(position);
              const context = getSqlCompletionContext(candidateModel.getValue(), offset, databaseType);
              if (!context) return { suggestions: [] };

              const schema = getCompletionSchema(connectionId, database, refreshTrigger);
              const tables = await schema.tables;
              if (token.isCancellationRequested || !completionContextMatches(connectionId, database)
                || callbacksRef.current.refreshTrigger !== refreshTrigger) {
                return { suggestions: [] };
              }
              const word = candidateModel.getWordAtPosition(position);
              const start = candidateModel.getPositionAt(context.replaceStart);
              const range = new monaco.Range(start.lineNumber, start.column, position.lineNumber,
                word?.endColumn && word.startColumn === start.column ? word.endColumn : position.column);

              if (context.kind === 'table') {
                return { suggestions: getTableSuggestions(context, tables, databaseType).map(item => ({
                  ...item, range,
                  kind: item.detail === 'View' ? monaco.languages.CompletionItemKind.Interface
                    : monaco.languages.CompletionItemKind.Class,
                })) };
              }

              const table = findCompletionTable(context, tables);
              if (!table) return { suggestions: [] };
              const columns = await getCompletionColumns(schema, connectionId, database, table);
              if (token.isCancellationRequested || !completionContextMatches(connectionId, database)
                || callbacksRef.current.refreshTrigger !== refreshTrigger) {
                return { suggestions: [] };
              }
              return { suggestions: getColumnSuggestions(context.prefix, columns, databaseType).map(item => ({
                ...item, range, kind: monaco.languages.CompletionItemKind.Field,
                detail: table.schema ? `${table.schema}.${table.name}` : table.name,
              })) };
            },
          }));
          cleanupRef.current = () => {
            subscriptions.forEach(subscription => subscription.dispose());
            decorations.clear();
          };

          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            callbacksRef.current.onRun?.('current');
          });
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            callbacksRef.current.onRun?.('all');
          });
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyE, () => {
            callbacksRef.current.onExplain?.();
          });
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, () => {
            callbacksRef.current.onCancel?.();
          });
        }}
      />
    </div>
  );
};
