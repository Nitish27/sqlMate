import assert from 'node:assert/strict';
import test from 'node:test';
import { readSqlEditorSnapshot } from '../src/utils/sqlEditorSnapshot.ts';
import { resolveSqlExecution } from '../src/utils/sqlExecution.ts';

test('execution reads fresh model text, cursor, and selection at click time', () => {
  let value = 'select 1;\n\nselect 2;';
  let offset = 9;
  let selectedStart = 9;
  let selectedEnd = 9;
  const editor = {
    getModel: () => ({
      getValue: () => value,
      getOffsetAt: (position: { lineNumber: number; column: number }) => position.column - 1,
    }),
    getPosition: () => ({ lineNumber: 1, column: offset + 1 }),
    getSelection: () => ({
      startLineNumber: 1, startColumn: selectedStart + 1,
      endLineNumber: 1, endColumn: selectedEnd + 1,
    }),
  };
  const first = readSqlEditorSnapshot(editor, 'MySql');
  assert.ok(first);
  assert.equal(resolveSqlExecution(first, 'current').target?.sql, 'select 1;');
  value = 'select 3;\n\nselect 4;';
  offset = value.length;
  selectedStart = 11;
  selectedEnd = value.length;
  const second = readSqlEditorSnapshot(editor, 'MySql');
  assert.ok(second);
  assert.equal(resolveSqlExecution(second, 'current').target?.sql, 'select 4;');
  assert.equal(resolveSqlExecution(second, 'current').target?.scope, 'selection');
});

test('missing model, cursor, or selection cannot produce executable SQL', () => {
  const unavailable = { getModel: () => null, getPosition: () => null, getSelection: () => null };
  assert.equal(readSqlEditorSnapshot(unavailable, 'Postgres'), null);
});
