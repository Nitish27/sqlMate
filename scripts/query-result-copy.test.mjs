import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryResultCopy.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { rowsForCopy, serializeResultRows, needsRawCopyConfirmation } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('copies selected rows in grid order only when the clicked row belongs to the selection', () => {
  const data = [[1, 'a'], [2, 'b'], [3, 'c']];
  assert.deepEqual(rowsForCopy(data, 2, [2, 0, 2]), [data[0], data[2]]);
  assert.deepEqual(rowsForCopy(data, 1, [0, 2]), [data[1]]);
});

test('plain text and CSV preserve nulls, quotes, and delimiters', () => {
  const rows = [[1, 'a,b', null], [2, 'a"b', 'line\nbreak']];
  assert.equal(serializeResultRows(['id', 'name', 'note'], rows, 'plain'),
    '1\ta,b\tNULL\n2\ta"b\tline\\nbreak');
  assert.equal(serializeResultRows(['id', 'name', 'note'], rows, 'csv-with-headers'),
    'id,name,note\n1,"a,b",NULL\n2,"a""b","line\nbreak"');
});

test('JSON keeps duplicate column names and Markdown escapes table syntax', () => {
  assert.equal(serializeResultRows(['id', 'id'], [[1, 2]], 'json'),
    '[\n  {\n    "id": 1,\n    "id (2)": 2\n  }\n]');
  assert.equal(serializeResultRows(['name'], [['a|b\nc']], 'markdown'),
    '| name |\n| --- |\n| a\\|b<br>c |');
});

test('raw copy confirmation includes masked and likely-secret columns', () => {
  assert.equal(needsRawCopyConfirmation(['id', 'password'], []), true);
  assert.equal(needsRawCopyConfirmation(['id', 'alias'], ['alias']), true);
  assert.equal(needsRawCopyConfirmation(['id', 'name'], []), false);
});
