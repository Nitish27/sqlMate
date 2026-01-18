import Editor from '@monaco-editor/react';

interface SQLEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  onRun?: () => void;
}

export const SQLEditor = ({ value, onChange, onRun }: SQLEditorProps) => {
  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme="vs-dark"
        value={value}
        onChange={onChange}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 10, bottom: 10 },
          wordWrap: 'on',
        }}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            onRun?.();
          });
        }}
      />
    </div>
  );
};
