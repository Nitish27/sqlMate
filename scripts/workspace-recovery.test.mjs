import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/workspaceRecovery.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { captureWorkspace, restoreWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('snapshot keeps ordered tabs and SQL but excludes fetched rows and messages', () => {
  const workspace = captureWorkspace({
    tabs: [
      { id: 'table-1', type: 'table', title: 'users', tableName: 'users', connectionId: 'conn', database: 'app', rows: [[1, 'secret']], columns: ['id'], messages: ['sensitive'] },
      { id: 'query-1', type: 'query', title: 'SQL Query', connectionId: 'conn', database: 'app', query: 'select 1', savedQueryId: 'saved-1', rows: [[1]] },
    ],
    activeDatabases: { conn: 'app' },
  });
  assert.deepEqual(workspace.tabs.map(tab => tab.id), ['table-1', 'query-1']);
  assert.equal(workspace.tabs[1].query, 'select 1');
  assert.equal(restoreWorkspace(workspace, ['conn']).tabs[1].savedQueryId, 'saved-1');
  assert.equal(JSON.stringify(workspace).includes('secret'), false);
  assert.equal(JSON.stringify(workspace).includes('messages'), false);
});

test('restore ignores unknown connections and malformed tabs without activating one', () => {
  const restored = restoreWorkspace({
    version: 1,
    tabs: [
      { id: 'good', type: 'query', title: 'SQL Query', connectionId: 'conn', query: 'select 1' },
      { id: 'orphan', type: 'table', title: 'users', tableName: 'users', connectionId: 'missing' },
      { id: 'bad', type: 'table', title: 'oops', connectionId: 'conn' },
      { id: 'good', type: 'query', title: 'duplicate', connectionId: 'conn' },
    ],
    activeDatabases: { conn: 'app', missing: 'bad' },
  }, ['conn']);
  assert.deepEqual(restored.tabs.map(tab => tab.id), ['good']);
  assert.equal('activeTabIds' in restored, false);
  assert.deepEqual(restored.activeDatabases, { conn: 'app' });
  assert.equal(restored.tabs[0].rows, undefined);
});

test('unsupported snapshots recover as an empty workspace', () => {
  assert.deepEqual(restoreWorkspace({ version: 2, tabs: [] }, ['conn']).tabs, []);
  assert.deepEqual(restoreWorkspace(null, ['conn']).tabs, []);
});

test('related tabs recover their scoped filter and back destination without storing rows', () => {
  const filter = { id: 'foreign-key-0', column: 'id', operator: '=', value: '7', enabled: true };
  const snapshot = captureWorkspace({
    tabs: [
      { id: 'source', type: 'table', title: 'orders', tableName: 'orders', connectionId: 'conn' },
      { id: 'related', type: 'table', title: 'accounts', tableName: 'accounts', connectionId: 'conn',
        originTabId: 'source', filters: [filter], isFilterVisible: true, rows: [['secret']] },
    ],
    activeDatabases: { conn: 'app' },
  });
  const restored = restoreWorkspace(snapshot, ['conn']);
  assert.equal(restored.tabs[1].originTabId, 'source');
  assert.deepEqual(restored.tabs[1].filters, [filter]);
  assert.equal(restored.tabs[1].isFilterVisible, true);
  assert.equal(JSON.stringify(restored).includes('secret'), false);
});
