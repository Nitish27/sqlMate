import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryResultExport.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
});
const { captureQueryResultExport, serializeQueryResultExport } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('captures valid selected rows once in grid order', () => {
  const columns = ['id'], rows = [[10], [20], [30]], selection = [2, 0, 2, 9, -1, 1.5];
  const result = captureQueryResultExport(columns, rows, selection, new Set(), true);
  selection.push(1);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.selectedRows, [[10], [30]]);
  assert.deepEqual(JSON.parse(serializeQueryResultExport(result, 'json', 'selected')), [{ id: 10 }, { id: 30 }]);
  assert.equal(JSON.parse(serializeQueryResultExport(result, 'json', 'loaded')).length, 3);
});

test('redacts known secrets even when revealed and respects manually masked aliases', () => {
  const result = captureQueryResultExport(
    ['id', 'password', 'other', 'count', 'count'],
    [[123n, 'secret-value', 'manually hidden', 2, null]],
    [],
    new Set(['password', 'other']),
    false,
  );
  assert.equal(result.maskedColumnCount, 2);
  assert.deepEqual(JSON.parse(serializeQueryResultExport(result, 'json', 'loaded')), [{
    id: '123', password: '[MASKED]', other: '[MASKED]', count: 2, 'count (2)': null,
  }]);
  assert.match(serializeQueryResultExport(result, 'csv', 'loaded'), /123,\[MASKED\],\[MASKED\],2,/);
  assert.throws(() => serializeQueryResultExport(result, 'csv', 'selected'), /No rows selected/);
});

test('CSV quotes separators, protects text and headers from spreadsheet formulas, and retains actual numbers', () => {
  const result = captureQueryResultExport(
    ['=heading', 'name', 'note', 'total', 'alias'],
    [['  =1+1', 'a,b', 'a"b\nnext line', -25, '\ttext']],
    [],
    new Set(),
    false,
  );
  assert.equal(serializeQueryResultExport(result, 'csv', 'loaded'),
    "'=heading,name,note,total,alias\r\n'  =1+1,\"a,b\",\"a\"\"b\nnext line\",-25,'\ttext\r\n");
  assert.equal(JSON.parse(serializeQueryResultExport(result, 'json', 'loaded'))[0]['=heading'], '  =1+1');
});

test('empty successful results export CSV headers or a valid empty JSON array', () => {
  const result = captureQueryResultExport(['id'], [], [], new Set(), false);
  assert.equal(serializeQueryResultExport(result, 'csv', 'loaded'), 'id\r\n');
  assert.deepEqual(JSON.parse(serializeQueryResultExport(result, 'json', 'loaded')), []);
});

test('limits file payload size by UTF-8 bytes', () => {
  const result = captureQueryResultExport(['id'], [['éé']], [], new Set(), false);
  assert.throws(() => serializeQueryResultExport(result, 'csv', 'loaded', 9), /too large/i);
  assert.equal(serializeQueryResultExport(result, 'csv', 'loaded', 10), 'id\r\néé\r\n');
});
