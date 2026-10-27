import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/cellValueInspector.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { formatCellValue, parseJsonCellValue, searchJsonPaths, jsonChildPath } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('formats null, scalar, and structured cell values without losing data', () => {
  assert.equal(formatCellValue(null), 'NULL');
  assert.equal(formatCellValue(false), 'false');
  assert.equal(formatCellValue(12n), '12');
  assert.equal(formatCellValue({ enabled: true }), '{\n  "enabled": true\n}');
});

test('only reasonably sized JSON objects and arrays use the tree', () => {
  assert.deepEqual(parseJsonCellValue('{"users":[{"id":1}]}'), { users: [{ id: 1 }] });
  assert.deepEqual(parseJsonCellValue([1, 2]), [1, 2]);
  assert.equal(parseJsonCellValue('hello'), null);
  assert.equal(parseJsonCellValue('null'), null);
  assert.equal(parseJsonCellValue('{broken'), null);
  assert.equal(parseJsonCellValue('{"x":1}' + ' '.repeat(600_000)), null);
  assert.equal(parseJsonCellValue(`${'{"x":'.repeat(70)}0${'}'.repeat(70)}`), null);
});

test('JSON search keeps matching ancestors and handles keys with slashes', () => {
  const value = { users: [{ 'display/name': 'Ada' }, { 'display/name': 'Lin' }] };
  const first = jsonChildPath(jsonChildPath(jsonChildPath('', 'users'), '0'), 'display/name');
  const result = searchJsonPaths(value, 'ada');
  assert.equal(result.count, 1);
  assert.equal(result.paths.has(''), true);
  assert.equal(result.paths.has(jsonChildPath('', 'users')), true);
  assert.equal(result.paths.has(first), true);
  assert.equal(result.paths.has(jsonChildPath(jsonChildPath(jsonChildPath('', 'users'), '1'), 'display/name')), false);
  assert.equal(searchJsonPaths(value, 'missing').count, 0);
});
