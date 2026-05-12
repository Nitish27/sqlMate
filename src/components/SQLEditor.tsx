import { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { useDatabaseStore } from '../store/databaseStore';

interface SQLEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  onRun?: (selectedText?: string) => void;
  onRunAll?: () => void;
  onCancel?: () => void;
}

export const SQLEditor = ({ value, onChange, onRun, onRunAll, onCancel }: SQLEditorProps) => {
  const resolvedTheme = useDatabaseStore((state) => state.resolvedTheme);
  const sqlEditorAppearance = useDatabaseStore((state) => state.appearanceSettings.sqlEditor);

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
          // ⌘+Return or Ctrl+Return: Run Current/Selected
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const selection = editor.getSelection();
            const selectedText = selection ? editor.getModel()?.getValueInRange(selection) : undefined;
            onRun?.(selectedText);
          });

          // ⌘+⇧+Return or Ctrl+Shift+Return: Run All
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            onRunAll?.();
          });

          // ⌘+. or Ctrl+.: Cancel Query
          // Note: monaco.KeyCode.Period is used for '.'
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period, () => {
            onCancel?.();
          });
        }}
      />
    </div>
  );
};
