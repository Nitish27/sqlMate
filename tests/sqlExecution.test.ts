import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSqlExecution } from '../src/utils/sqlExecution.ts';

const snapshot = {
  value: 'select 1;\n\nselect 2;',
  cursorOffset: 9,
  selectionStart: 9,
  selectionEnd: 9,
  databaseType: 'MySql' as const,
};

test('Current resolves the live cursor rather than falling back to the whole editor', () => {
  assert.deepEqual(resolveSqlExecution(snapshot, 'current'), {
    target: { sql: 'select 1;', startOffset: 0, endOffset: 9, scope: 'current' },
  });
});

test('selection is preserved byte-for-byte while All explicitly uses the full document', () => {
  const value = 'select 1;\n\n  select 2;  ';
  const selected = { ...snapshot, value, selectionStart: 11, selectionEnd: value.length };
  assert.deepEqual(resolveSqlExecution(selected, 'current').target, {
    sql: '  select 2;  ', startOffset: 11, endOffset: value.length, scope: 'selection',
  });
  assert.deepEqual(resolveSqlExecution(selected, 'all').target, {
    sql: value, startOffset: 0, endOffset: value.length, scope: 'all',
  });
});

test('blank and unsupported Current scopes give guidance rather than invoking the full script', () => {
  for (const value of [' ', '-- comment', '/* comment */']) {
    const result = resolveSqlExecution({ ...snapshot, value, cursorOffset: value.length,
      selectionStart: value.length, selectionEnd: value.length }, 'current');
    assert.equal(result.target, null);
    assert.ok(result.reason);
  }
  const blank = resolveSqlExecution({ ...snapshot, cursorOffset: 10, selectionStart: 10, selectionEnd: 10 }, 'current');
  assert.equal(blank.target, null);
  assert.ok(blank.reason);
  const value = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN select 1; END$$';
  assert.match(resolveSqlExecution({ ...snapshot, value }, 'current').reason || '', /DELIMITER/);
});

test('selected multiple queries are intentional and whitespace selection still resolves Current', () => {
  assert.equal(resolveSqlExecution({ ...snapshot, selectionStart: 0, selectionEnd: snapshot.value.length }, 'current').target?.scope, 'selection');
  assert.equal(resolveSqlExecution({ ...snapshot, cursorOffset: 15, selectionStart: 9, selectionEnd: 11 }, 'current').target?.sql, 'select 2;');
  assert.equal(resolveSqlExecution({ ...snapshot, cursorOffset: 10, selectionStart: 9, selectionEnd: 11 }, 'current').target, null);
});

test('invalid editor ranges fail closed and empty All does not invoke', () => {
  assert.equal(resolveSqlExecution({ ...snapshot, selectionStart: -1 }, 'current').target, null);
  assert.equal(resolveSqlExecution({ ...snapshot, selectionEnd: 2 }, 'current').target, null);
  assert.equal(resolveSqlExecution({ ...snapshot, value: '' }, 'all').target, null);
});
