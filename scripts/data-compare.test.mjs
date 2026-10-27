import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/utils/dataCompare.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { comparableTables, compareRows, comparisonCoverage } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
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

test('coverage copy distinguishes a complete read from a partial sample', () => {
  const complete = comparisonCoverage(rows([['1', 'Alice']]), rows([['1', 'Alice']]), 100);
  assert.match(complete, /All rows returned from both tables/);
  assert.doesNotMatch(complete, /Partial comparison/);
  const partial = comparisonCoverage(rows([['1', 'Alice']], true), rows([['1', 'Alice']]), 100);
  assert.match(partial, /Partial comparison/);
  assert.match(partial, /Source: 1\+/);
  assert.match(partial, /not called missing/);
});

test('compares columns by name and rejects duplicate keys', () => {
  assert.equal(compareRows(rows([['1', 'Alice']]), rows([['Alice', '1']], false, ['name', 'id'])).rows[0].status, 'unchanged');
  assert.throws(() => compareRows(rows([['1', 'Alice'], ['1', 'Bob']]), rows([])), /Duplicate primary-key/);
});

test('rejects type drift between sampled connections', () => {
  assert.throws(() => compareRows(rows([['1', 'Alice']]), { ...rows([['1', 'Alice']]), column_types: ['integer', 'varchar'] }), /column type changed/);
});
