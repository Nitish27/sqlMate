import type { DatabaseType } from './sqlIdentifiers';
import type { EditorSnapshot } from './sqlExecution';

interface EditorPosition {
  lineNumber: number;
  column: number;
}

export interface SqlEditorSnapshotSource {
  getModel: () => {
    getValue: () => string;
    getOffsetAt: (position: EditorPosition) => number;
  } | null;
  getPosition: () => EditorPosition | null;
  getSelection: () => {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

export const readSqlEditorSnapshot = (
  editor: SqlEditorSnapshotSource,
  databaseType: DatabaseType,
): EditorSnapshot | null => {
  const model = editor.getModel();
  const position = editor.getPosition();
  const selection = editor.getSelection();
  if (!model || !position || !selection) return null;
  return {
    value: model.getValue(),
    cursorOffset: model.getOffsetAt(position),
    selectionStart: model.getOffsetAt({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
    selectionEnd: model.getOffsetAt({ lineNumber: selection.endLineNumber, column: selection.endColumn }),
    databaseType,
  };
};
