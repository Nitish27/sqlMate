import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryPlan.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { getQueryPlanNodes } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('PostgreSQL plan keeps nested operations and estimated metrics', () => {
  const nodes = getQueryPlanNodes({
    databaseType: 'Postgres', planningTimeMs: 3,
    plan: [{ Plan: {
      'Node Type': 'Nested Loop', 'Plan Rows': 2, 'Total Cost': 18.7,
      Plans: [{ 'Node Type': 'Index Scan', 'Relation Name': 'users', 'Index Name': 'users_pkey', 'Plan Rows': 1 }],
    } }],
  });
  assert.equal(nodes[0].title, 'Nested Loop');
  assert.equal(nodes[0].children[0].title, 'Index Scan on users');
  assert.deepEqual(nodes[0].children[0].meta, ['Index: users_pkey', 'Est. rows: 1']);
});

test('MySQL plan shows table access, index, and estimate', () => {
  const nodes = getQueryPlanNodes({
    databaseType: 'MySql', planningTimeMs: 2,
    plan: [{ table: 'orders', type: 'ALL', key: null, rows: 1200, Extra: 'Using where' }],
  });
  assert.equal(nodes[0].title, 'orders');
  assert.equal(nodes[0].badge, 'scan');
  assert.deepEqual(nodes[0].meta, ['Access: ALL', 'Est. rows: 1200', 'Using where']);
});

test('SQLite plan keeps parent-child relationships even when parent appears later', () => {
  const nodes = getQueryPlanNodes({
    databaseType: 'Sqlite', planningTimeMs: 1,
    plan: [
      { id: 5, parent: 2, detail: 'SEARCH items USING INDEX items_id (id=?)' },
      { id: 2, parent: 0, detail: 'SCAN users' },
    ],
  });
  assert.equal(nodes[0].title, 'SCAN users');
  assert.equal(nodes[0].children[0].title, 'SEARCH items USING INDEX items_id (id=?)');
});

test('malformed plan is represented as unavailable instead of crashing', () => {
  const nodes = getQueryPlanNodes({ databaseType: 'Postgres', planningTimeMs: 0, plan: null });
  assert.equal(nodes[0].title, 'Plan unavailable');
  assert.equal(getQueryPlanNodes({ databaseType: 'MySql', planningTimeMs: 0, plan: [] })[0].title, 'Plan unavailable');
});
