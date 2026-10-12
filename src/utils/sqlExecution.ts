import type { DatabaseType } from './sqlIdentifiers';
import { resolveActiveSqlStatement, scanSqlStatements, type ActiveSqlStatement } from './sqlStatements.ts';

export interface EditorSnapshot {
  value: string;
  cursorOffset: number;
  selectionStart: number;
  selectionEnd: number;
  databaseType: DatabaseType;
}

export type SqlExecutionMode = 'current' | 'all';
export type SqlExecutionScope = SqlExecutionMode | 'selection';
export interface SqlExecutionTarget extends ActiveSqlStatement {
  scope: SqlExecutionScope;
}
export type SqlExecutionResolution =
  | { target: SqlExecutionTarget; reason?: never }
  | { target: null; reason: string };

export const resolveSqlExecution = (snapshot: EditorSnapshot, mode: SqlExecutionMode): SqlExecutionResolution => {
  const { value, selectionStart, selectionEnd } = snapshot;
  if (!value.trim()) return { target: null, reason: 'Enter SQL before running a query.' };
  if (mode === 'all') {
    return { target: { sql: value, startOffset: 0, endOffset: value.length, scope: 'all' } };
  }
  if (![selectionStart, selectionEnd, snapshot.cursorOffset].every(offset =>
    Number.isInteger(offset) && offset >= 0 && offset <= value.length) || selectionStart > selectionEnd) {
    return { target: null, reason: 'Editor position is unavailable. Refocus the editor and try again.' };
  }
  const selection = value.slice(selectionStart, selectionEnd);
  if (selection.trim()) {
    return { target: { sql: selection, startOffset: selectionStart, endOffset: selectionEnd, scope: 'selection' } };
  }
  const current = resolveActiveSqlStatement(snapshot.value, snapshot.cursorOffset, snapshot.databaseType);
  if (!current) {
    return { target: null, reason: scanSqlStatements(value, snapshot.databaseType).reason ||
      'Place the cursor inside a query or select SQL to run. Blank separator lines do not run a query.' };
  }
  return { target: { ...current, scope: mode } };
};
