import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/quickOpen.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { buildQuickOpenItems, searchQuickOpenItems, resolveQuickOpenTarget } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const state = {
  activeConnectionId: 'local',
  activeDatabase: 'app',
  openConnectionIds: ['local', 'remote'],
  savedConnections: [
    { id: 'local', name: 'Local', type: 'MySql', database: 'app', host: 'localhost', environment: 'local' },
    { id: 'remote', name: 'Production', type: 'Postgres', database: 'live', host: 'prod.example', environment: 'production' },
    { id: 'closed', name: 'Archive', type: 'Sqlite', database: '/tmp/archive.db' },
  ],
  databases: ['app', 'audit'],
  sidebarItems: {
    local: [{ name: 'admins', item_type: 'Table' }, { name: 'audit_view', item_type: 'View' }, { name: 'helper', item_type: 'Function' }],
    remote: [{ name: 'remote_only', item_type: 'Table' }],
  },
  tabs: [
    { id: 'tab-local', type: 'table', title: 'admins', connectionId: 'local', database: 'app', tableName: 'admins' },
    { id: 'tab-remote', type: 'query', title: 'Reports', connectionId: 'remote', database: 'live', query: 'select 1' },
  ],
  savedQueries: [
    { id: 'saved-local', name: 'Active admins', sql: 'select * from admins', connectionId: 'local', database: 'app', updatedAt: 10 },
    { id: 'saved-closed', name: 'Archive report', sql: 'select * from archive', connectionId: 'closed', updatedAt: 11 },
  ],
  queryHistory: [
    { id: 'history-local', sql: 'select * from admins limit 5', connectionId: 'local', database: 'app', timestamp: 100 },
    { id: 'history-closed', sql: 'select * from archive', connectionId: 'closed', timestamp: 200 },
  ],
};

test('quick open only offers safe targets in open connection contexts', () => {
  const items = buildQuickOpenItems(state);
  assert.deepEqual(items.filter(item => item.kind === 'connection').map(item => item.connectionId), ['local', 'remote']);
  assert.deepEqual(items.filter(item => item.kind === 'database').map(item => item.title), ['app', 'audit']);
  assert.deepEqual(items.filter(item => item.kind === 'table').map(item => item.title), ['admins', 'audit_view']);
  assert.equal(items.some(item => item.title === 'remote_only' || item.title === 'helper'), false);
  assert.equal(items.some(item => item.connectionId === 'closed'), false);
  assert.equal(items.find(item => item.id === 'saved:saved-local').kind, 'saved');
  assert.equal(items.find(item => item.id === 'history:history-local').kind, 'history');
});

test('quick open ranks name matches before SQL-body matches and respects a result cap', () => {
  const items = buildQuickOpenItems(state);
  const results = searchQuickOpenItems(items, 'admins', 10);
  assert.equal(results[0].title, 'admins');
  assert.ok(results.some(item => item.kind === 'saved'));
  assert.ok(results.some(item => item.kind === 'history'));
  assert.deepEqual(searchQuickOpenItems(items, 'admins', 1).map(item => item.title), ['admins']);
  assert.deepEqual(searchQuickOpenItems(items, 'no-match'), []);
});

test('quick open keeps duplicate tab and table names distinguishable by kind and connection', () => {
  const items = buildQuickOpenItems(state);
  const matches = searchQuickOpenItems(items, 'admins');
  assert.ok(matches.some(item => item.kind === 'table' && item.connectionId === 'local'));
  assert.ok(matches.some(item => item.kind === 'tab' && item.connectionId === 'local'));
  assert.ok(items.find(item => item.id === 'tab:tab-remote').detail.includes('Production'));
});

test('quick open rejects stale targets rather than using an old connection or database', () => {
  const items = buildQuickOpenItems(state);
  const table = items.find(item => item.id === 'table:local:Table:admins');
  const saved = items.find(item => item.id === 'saved:saved-local');
  assert.equal(resolveQuickOpenTarget(table, state)?.kind, 'table');
  assert.equal(resolveQuickOpenTarget(table, { ...state, activeDatabase: 'audit' }), null);
  assert.equal(resolveQuickOpenTarget(table, { ...state, activeConnectionId: 'remote' }), null);
  assert.equal(resolveQuickOpenTarget(saved, { ...state, openConnectionIds: ['remote'] }), null);
  assert.equal(resolveQuickOpenTarget(saved, state)?.kind, 'saved');
});
