import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/cellEditing.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { isRepeatedCellPress, getContextEditColumn, nullCellEditValue, parseCellEditorValue } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('a second press on the same cell starts editing', () => {
  const first = { rowIndex: 2, columnName: 'email', x: 100, y: 50, time: 1000 };
  const second = { rowIndex: 2, columnName: 'email', x: 102, y: 51, time: 1200 };
  assert.equal(isRepeatedCellPress(first, second), true);
});

test('quick presses on different cells do not start editing', () => {
  const first = { rowIndex: 2, columnName: 'id', x: 100, y: 50, time: 1000 };
  const second = { rowIndex: 2, columnName: 'email', x: 102, y: 51, time: 1200 };
  assert.equal(isRepeatedCellPress(first, second), false);
});

test('a later press on the same cell does not start editing', () => {
  const first = { rowIndex: 2, columnName: 'email', x: 100, y: 50, time: 1000 };
  const second = { rowIndex: 2, columnName: 'email', x: 100, y: 50, time: 1700 };
  assert.equal(isRepeatedCellPress(first, second), false);
});

test('right-click Edit targets the clicked column, not the first column', () => {
  assert.equal(getContextEditColumn({ rowIndex: 2, columnName: 'email' }, 2, ['id', 'email']), 'email');
});

test('right-click Edit does not reuse a cell from another row', () => {
  assert.equal(getContextEditColumn({ rowIndex: 1, columnName: 'email' }, 2, ['id', 'email']), 'id');
});

test('Set NULL stages a null distinct from an empty text edit', () => {
  assert.equal(nullCellEditValue(true), null);
  assert.throws(() => nullCellEditValue(false), /not nullable/);
});

test('clearing a nullable datetime stages SQL NULL but clearing text keeps an empty string', () => {
  assert.equal(parseCellEditorValue('2026-02-09T06:40:14+00:00', '', { isNullable: true, dataType: 'datetime' }), null);
  assert.equal(parseCellEditorValue('before', '', { isNullable: true, dataType: 'varchar' }), '');
  assert.equal(parseCellEditorValue('before', '', { isNullable: false, dataType: 'datetime' }), '');
});
