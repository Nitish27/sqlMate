import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/connectionTypes.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { CONNECTION_TYPES, OTHER_DATABASES, filterConnectionTypes, filterOtherDatabases, moveConnectionTypeSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('the chooser offers only supported drivers', () => {
  assert.deepEqual(CONNECTION_TYPES.map(type => type.id), ['Postgres', 'MySql', 'Sqlite', 'DuckDb']);
});

test('search finds database names and compatible aliases', () => {
  assert.deepEqual(filterConnectionTypes(' mariaDB ').map(type => type.id), ['MySql']);
  assert.deepEqual(filterConnectionTypes('file').map(type => type.id), ['Sqlite', 'DuckDb']);
  assert.deepEqual(filterConnectionTypes('unsupported'), []);
});

test('keyboard selection wraps and handles an empty search', () => {
  assert.equal(moveConnectionTypeSelection(0, 4, -1), 3);
  assert.equal(moveConnectionTypeSelection(3, 4, 1), 0);
  assert.equal(moveConnectionTypeSelection(0, 0, 1), 0);
});

test('unsupported databases are discoverable but never offered as working drivers', () => {
  assert.deepEqual(filterOtherDatabases('sql server'), ['Microsoft SQL Server']);
  assert.ok(OTHER_DATABASES.includes('Redis'));
  assert.ok(CONNECTION_TYPES.every(type => !OTHER_DATABASES.includes(type.name)));
});
