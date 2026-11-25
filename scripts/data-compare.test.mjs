import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/utils/dataCompare.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { comparableTables, compareRows, comparisonCoverage, parsePrimaryKeyRange } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const column = (name, data_type = 'integer', is_primary_key = false) => ({ name, data_type, is_primary_key, is_nullable: false, default_value: null });
const table = (name, columns, schema = null) => ({ name, schema, columns });
const snapshot = tables => ({ engine: 'Postgres', database: 'app', tables });
const rows = (values, has_more = false, columns = ['id', 'name']) => ({ columns, column_types: columns.map(name => name === 'id' ? 'integer' : 'text'), primary_key: ['id'], rows: values, has_more });

test('only identical scalar tables with a primary key are eligible', () => {
  const source = snapshot([table('users', [column('id', 'integer', true), column('name', 'text')]), table('logs', [column('message', 'text')]), table('files', [column('id', 'integer', true), column('payload', 'bytea')])]);
  const target = snapshot([table('users', [column('name', 'text'), column('id', 'integer', true)]), table('logs', [column('message', 'text')]), table('files', [column('id', 'integer', true), column('payload', 'bytea')])]);
  assert.deepEqual(comparableTables(source, target).map(item => item.name), ['users']);
  assert.deepEqual(comparableTables(source, { ...target, engine: 'MySql' }), []);
});

test('detects changed values, matching rows, and verified missing rows', () => {
  const result = compareRows(rows([['1', 'Alice'], ['2', 'Bob']]), rows([['1', 'Alicia'], ['3', 'Cara']]));
  assert.deepEqual(result.rows.map(row => [row.label, row.status]), [['1', 'changed'], ['2', 'source-only'], ['3', 'target-only']]);
  assert.deepEqual(result.rows[0].changedColumns, ['name']);
});

test('incomplete opposite sample never claims a row is missing', () => {
  const result = compareRows(rows([['1', 'Alice']], true), rows([['2', 'Bob']], true));
  assert.deepEqual(result.rows.map(row => row.status), ['not-checked', 'not-checked']);
});

test('ranged results sort numerically without rounding large keys', () => {
  const result = compareRows(rows([['2', 'a'], ['9007199254740993', 'b']]), rows([['10', 'c'], ['9007199254740992', 'd']]), true);
  assert.deepEqual(result.rows.map(row => row.label), ['2', '10', '9007199254740992', '9007199254740993']);
});

test('coverage copy distinguishes a complete read from a partial sample', () => {
  const complete = comparisonCoverage(rows([['1', 'Alice']]), rows([['1', 'Alice']]), 100);
  assert.match(complete, /All rows returned from both tables/);
  assert.doesNotMatch(complete, /Partial comparison/);
  const partial = comparisonCoverage(rows([['1', 'Alice']], true), rows([['1', 'Alice']]), 100);
  assert.match(partial, /Partial comparison/);
  assert.match(partial, /Source: 1\+/);
  assert.match(partial, /not called missing/);
});

test('range coverage distinguishes all matching rows from all table rows', () => {
  assert.match(comparisonCoverage(rows([]), rows([]), 100, true), /All rows in the selected range/);
  assert.match(comparisonCoverage(rows([['2', 'Alice']], true), rows([]), 100, true), /within the selected range/);
});

test('range filters only support single-column integer keys', () => {
  const source = snapshot([
    table('events', [column('event_id', 'bigint', true)]),
    table('logs', [column('id', 'uuid', true)]),
    table('parts', [column('a', 'integer', true), column('b', 'integer', true)]),
  ]);
  assert.deepEqual(comparableTables(source, source).map(item => [item.name, item.rangeKey]), [
    ['events', { column: 'event_id', unsigned: false }],
    ['logs', null],
    ['parts', null],
  ]);
  const mysql = { engine: 'MySql', database: 'app', tables: [table('orders', [column('id', 'bigint(20) unsigned', true)])] };
  assert.deepEqual(comparableTables(mysql, mysql)[0].rangeKey, { column: 'id', unsigned: true });
});

test('range input preserves exact integer bounds and rejects invalid values', () => {
  const signed = { column: 'id', unsigned: false };
  const unsigned = { column: 'id', unsigned: true };
  assert.equal(parsePrimaryKeyRange(signed, '', ' '), null);
  assert.deepEqual(parsePrimaryKeyRange(signed, '-9223372036854775808', ''), {
    column: 'id', lower: '-9223372036854775808', upper: null,
  });
  assert.deepEqual(parsePrimaryKeyRange(unsigned, '', ' 18446744073709551615 '), {
    column: 'id', lower: null, upper: '18446744073709551615',
  });
  assert.throws(() => parsePrimaryKeyRange(unsigned, '-1', ''), /between/);
  assert.throws(() => parsePrimaryKeyRange(signed, '9223372036854775808', ''), /between/);
  assert.throws(() => parsePrimaryKeyRange(signed, '9007199254740993', '9007199254740992'), /Lower bound/);
  assert.throws(() => parsePrimaryKeyRange(signed, '1.5', ''), /whole number/);
});

test('compares columns by name and rejects duplicate keys', () => {
  assert.equal(compareRows(rows([['1', 'Alice']]), rows([['Alice', '1']], false, ['name', 'id'])).rows[0].status, 'unchanged');
  assert.throws(() => compareRows(rows([['1', 'Alice'], ['1', 'Bob']]), rows([])), /Duplicate primary-key/);
});

test('rejects type drift between sampled connections', () => {
  assert.throws(() => compareRows(rows([['1', 'Alice']]), { ...rows([['1', 'Alice']]), column_types: ['integer', 'varchar'] }), /column type changed/);
});
