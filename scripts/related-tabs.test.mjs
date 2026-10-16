import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const { outputFiles } = await build({
  entryPoints: ['src/store/databaseStore.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { useDatabaseStore } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('following a reference opens a separate filtered tab without replacing an existing view', () => {
  useDatabaseStore.setState({ tabs: [], activeTabId: null, activeTabIds: {}, activeDatabases: { conn: 'app' } });
  useDatabaseStore.getState().openTab({
    type: 'table', title: 'accounts', tableName: 'accounts', connectionId: 'conn',
  });
  const sourceId = useDatabaseStore.getState().activeTabId;
  const filter = { id: 'foreign-key-0', column: 'id', operator: '=', value: '7', enabled: true };
  useDatabaseStore.getState().openTab({
    type: 'table', title: 'accounts', tableName: 'accounts', connectionId: 'conn',
    filters: [filter], isFilterVisible: true, originTabId: sourceId,
  }, { forceNew: true });

  const state = useDatabaseStore.getState();
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].filters.length, 0);
  assert.deepEqual(state.tabs[1].filters, [filter]);
  assert.equal(state.tabs[1].originTabId, sourceId);
  assert.equal(state.activeTabId, state.tabs[1].id);
});
