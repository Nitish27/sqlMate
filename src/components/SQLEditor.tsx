import { useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useDatabaseStore } from '../store/databaseStore';

interface SQLEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  onRun?: (selectedText?: string, activeStatement?: string) => void;
  onRunAll?: () => void;
  onCancel?: () => void;
  onActiveStatementChange?: (statement: string | null) => void;
}

interface ActiveSqlStatement {
  sql: string;
  startLineNumber: number;
  endLineNumber: number;
}

const getActiveSqlStatement = (sql: string, cursorOffset: number): ActiveSqlStatement | null => {
  const ranges: Array<{ start: number; end: number }> = [];
  let statementStart = 0;
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === quote) {
        if (nextCharacter === quote) {
          index += 1;
        } else if (sql[index - 1] !== '\\') {
          quote = null;
        }
      }
      continue;
    }

    if (character === '-' && nextCharacter === '-') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (character === ';') {
      ranges.push({ start: statementStart, end: index + 1 });
      statementStart = index + 1;
    }
  }

  ranges.push({ start: statementStart, end: sql.length });

  const range = ranges.find(({ start, end }) => cursorOffset >= start && cursorOffset < end)
    || [...ranges].reverse().find(({ start, end }) => cursorOffset >= start && cursorOffset <= end);

  if (!range) return null;

  const rawStatement = sql.slice(range.start, range.end);
  const statement = rawStatement.trim();
  if (!statement) return null;

  const statementStartOffset = range.start + rawStatement.indexOf(statement);
  const statementEndOffset = statementStartOffset + statement.length;
  const lineNumberAtOffset = (offset: number) => sql.slice(0, offset).split('\n').length;

  return {
    sql: statement,
    startLineNumber: lineNumberAtOffset(statementStartOffset),
    endLineNumber: lineNumberAtOffset(statementEndOffset),
  };
};

export const SQLEditor = ({
  value,
  onChange,
  onRun,
  onRunAll,
  onCancel,
  onActiveStatementChange,
}: SQLEditorProps) => {
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const sqlEditorAppearance = useDatabaseStore((state) => state.appearanceSettings.sqlEditor);
  const onRunRef = useRef(onRun);
  const onRunAllRef = useRef(onRunAll);
  const onCancelRef = useRef(onCancel);
  const onActiveStatementChangeRef = useRef(onActiveStatementChange);

  onRunRef.current = onRun;
  onRunAllRef.current = onRunAll;
  onCancelRef.current = onCancel;
  onActiveStatementChangeRef.current = onActiveStatementChange;

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
        defaultLanguage="sql"
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        onChange={onChange}
        options={editorOptions}
        onMount={(editor, monaco) => {
          const decorations = editor.createDecorationsCollection();
          const updateActiveStatement = () => {
            const model = editor.getModel();
            const position = editor.getPosition();
            if (!model || !position) return;

            const activeStatement = getActiveSqlStatement(model.getValue(), model.getOffsetAt(position));
            onActiveStatementChangeRef.current?.(activeStatement?.sql || null);
            decorations.set(activeStatement ? [{
              range: new monaco.Range(
                activeStatement.startLineNumber,
                1,
                activeStatement.endLineNumber,
                model.getLineMaxColumn(activeStatement.endLineNumber),
              ),
              options: {
                isWholeLine: true,
                className: 'sql-active-statement',
              },
            }] : []);
          };

          updateActiveStatement();
          editor.onDidChangeCursorPosition(updateActiveStatement);
          editor.onDidChangeModelContent(updateActiveStatement);

          // ⌘+Return or Ctrl+Return: Run Current/Selected
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            const selectedText = selection ? editor.getModel()?.getValueInRange(selection) : undefined;
            const model = editor.getModel();
            const position = editor.getPosition();
            const activeStatement = model && position
              ? getActiveSqlStatement(model.getValue(), model.getOffsetAt(position))
              : null;
            onRunRef.current?.(selectedText, activeStatement?.sql);
          });

          // ⌘+⇧+Return or Ctrl+Shift+Return: Run All
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            onRunAllRef.current?.();
          });

          // ⌘+. or Ctrl+.: Cancel Query
          // Note: monaco.KeyCode.Period is used for '.'
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, () => {
            onCancelRef.current?.();
          });
        }}
      />
    </div>
  );
};
