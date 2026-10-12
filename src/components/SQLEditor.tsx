import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import Editor from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { useDatabaseStore } from '../store/databaseStore';
import type { DatabaseType } from '../utils/sqlIdentifiers';
import { readSqlEditorSnapshot } from '../utils/sqlEditorSnapshot';
import { resolveSqlExecution, type SqlExecutionMode, type SqlExecutionResolution } from '../utils/sqlExecution';

export interface SQLEditorHandle {
  resolveExecution: (mode: SqlExecutionMode) => SqlExecutionResolution;
}

interface SQLEditorProps {
  ref?: Ref<SQLEditorHandle>;
  tabId: string;
  databaseType: DatabaseType;
  value: string;
  onChange: (value: string | undefined) => void;
  onRun?: (mode: SqlExecutionMode) => void;
  onCancel?: () => void;
  onExecutionScopeChange?: (scope: 'current' | 'selection') => void;
}

interface QueryEditorSession {
  model: MonacoEditor.ITextModel;
  viewState: MonacoEditor.ICodeEditorViewState | null;
}

// Only open tabs retain models/undo; closed tabs release their resources.
const queryEditorSessions = new Map<string, QueryEditorSession>();

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
  value,
  onChange,
  onRun,
  onCancel,
  onExecutionScopeChange,
}: SQLEditorProps) => {
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const sqlEditorAppearance = useDatabaseStore((state) => state.appearanceSettings.sqlEditor);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onRun, onCancel, onChange, onExecutionScopeChange, databaseType });
  callbacksRef.current = { onRun, onCancel, onChange, onExecutionScopeChange, databaseType };
  const modelPath = `sqlmate-query:///${encodeURIComponent(tabId)}.sql`;

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
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, () => {
            callbacksRef.current.onCancel?.();
          });
        }}
      />
    </div>
  );
};
