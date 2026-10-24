import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/schemaCompare.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { compareSchemas, comparableTargets } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const column = (name, data_type = 'integer', extra = {}) => ({
  name, data_type, is_nullable: true, default_value: null, is_primary_key: false, ...extra,
});
const table = (name, columns, schema = null) => ({ name, schema, columns });
const snapshot = (tables, engine = 'Postgres') => ({ engine, database: 'app', tables });

test('schema compare keeps equal table names in different PostgreSQL schemas separate', () => {
  const result = compareSchemas(
    snapshot([table('users', [column('id')], 'public'), table('users', [column('id')], 'audit')]),
    snapshot([table('users', [column('id')], 'public')]),
  );
  assert.equal(result.tables.length, 2);
  assert.equal(result.tables.find(entry => entry.schema === 'audit').status, 'source-only');
  assert.equal(result.tables.find(entry => entry.schema === 'public').status, 'unchanged');
});

test('schema compare reports both directions and changed column properties', () => {
  const result = compareSchemas(
    snapshot([table('projects', [column('id', 'integer', { is_primary_key: true }), column('old')]), table('legacy', [])]),
    snapshot([table('projects', [column('id', 'bigint', { is_primary_key: true }), column('new')]), table('fresh', [])]),
  );
  assert.equal(result.summary.sourceOnly, 1);
  assert.equal(result.summary.targetOnly, 1);
  assert.equal(result.summary.changed, 1);
  const projects = result.tables.find(entry => entry.name === 'projects');
  assert.equal(projects.status, 'changed');
  assert.deepEqual(projects.columns.map(entry => [entry.name, entry.status]), [
    ['id', 'changed'], ['new', 'target-only'], ['old', 'source-only'],
  ]);
  assert.deepEqual(projects.columns.find(entry => entry.name === 'id').changedFields, ['data_type']);
});

test('schema compare ignores column ordering but detects nullable, default, and key changes', () => {
  const result = compareSchemas(
    snapshot([table('tasks', [column('name'), column('id')])]),
    snapshot([table('tasks', [column('id'), column('name', 'integer', {
      is_nullable: false, default_value: '0', is_primary_key: true,
    })])]),
  );
  const changes = result.tables[0].columns.find(entry => entry.name === 'name');
  assert.deepEqual(changes.changedFields, ['is_nullable', 'default_value', 'is_primary_key']);
});

test('schema compare rejects cross-engine snapshots rather than reporting false drift', () => {
  assert.throws(() => compareSchemas(snapshot([]), snapshot([], 'MySql')), /same engine/i);
});

test('comparison picker lists only other open connections using the source engine', () => {
  const connections = [
    { id: 'source', type: 'Postgres' }, { id: 'target', type: 'Postgres' },
    { id: 'closed', type: 'Postgres' }, { id: 'other-engine', type: 'MySql' },
  ];
  assert.deepEqual(
    comparableTargets(connections[0], connections, ['source', 'target', 'other-engine']).map(connection => connection.id),
    ['target'],
  );
});
