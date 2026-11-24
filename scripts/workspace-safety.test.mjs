import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function load(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
}

test('closing a scratch query protects its SQL even if it was executed', async () => {
  const { isUnsavedQuery } = await load('src/utils/tabClose.ts');
  const tab = { type: 'query', query: 'SELECT 1', connectionId: 'a' };
  assert.equal(isUnsavedQuery(tab, []), true);
  assert.equal(isUnsavedQuery({ ...tab, query: '  ' }, []), false);
  const saved = [{ id: 'q', sql: 'SELECT 1', connectionId: 'a' }];
  assert.equal(isUnsavedQuery({ ...tab, savedQueryId: 'q' }, saved), false);
  assert.equal(isUnsavedQuery({ ...tab, savedQueryId: 'q', query: 'SELECT 2' }, saved), true);
});

test('confirmation cannot be replaced or settled by a stale dialog', async () => {
  const { requestReview, getReview, settleReview } = await load('src/utils/actionReview.ts');
  const review = { title: 'Delete connection', description: 'Review target', actions: [{ id: 'delete', label: 'Delete' }] };
  const first = requestReview(review);
  const pending = getReview();
  assert.equal(await requestReview(review), null);
  settleReview(pending, null);
  assert.equal(await first, null);
  const second = requestReview(review);
  settleReview(pending, 'delete');
  assert.ok(getReview());
  settleReview(getReview(), 'delete');
  assert.equal(await second, 'delete');
});

test('Postgres identities distinguish schemas, dots and quoted identifiers', async () => {
  const { sidebarTableName, quoteTableReference } = await load('src/utils/sqlIdentifiers.ts');
  const ref = sidebarTableName('order.items', 'bill"ing', 'Postgres');
  assert.equal(ref, '"bill""ing"."order.items"');
  assert.equal(quoteTableReference(ref, 'Postgres'), ref);
  assert.notEqual(sidebarTableName('orders', 'public', 'Postgres'), sidebarTableName('orders', 'sales', 'Postgres'));
  assert.equal(quoteTableReference('orders', 'Postgres'), '"public"."orders"');
});

test('saved SQL from removed connections stays recoverable without retargeting to another database', async () => {
  const { filterDetachedQueries } = await load('src/utils/savedQueries.ts');
  const removed = { connectionId: 'removed', name: 'Draft', sql: 'SELECT 42', updatedAt: 1 };
  assert.deepEqual(filterDetachedQueries([removed, { ...removed, connectionId: 'active' }], ['active'], '42'), [removed]);
});

test('tab and connection guards keep work intact on cancel or failed save', async () => {
  const storage = new Map();
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  } });
  const calls = [];
  let failSave = true;
  globalThis.__workspaceSafetyInvoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'save_saved_queries' && failSave) throw new Error('Disk unavailable');
    if (command === 'get_execution_context') return ['demo', 'Alert'];
    if (command === 'prepare_execution') return 'approval-token';
  };
  try {
    const { outputFiles } = await build({
      stdin: { contents: `export * from './src/store/databaseStore'; export * from './src/store/recoveryStore'; export * from './src/utils/actionReview'; export * from './src/utils/executionPolicy';`, resolveDir: process.cwd() },
      bundle: true, platform: 'node', format: 'esm', write: false, mainFields: ['module', 'main'],
      plugins: [{ name: 'tauri-mock', setup(build) {
        build.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'tauri-mock' }));
        build.onLoad({ filter: /.*/, namespace: 'tauri-mock' }, () => ({ contents: 'export const invoke = (...args) => globalThis.__workspaceSafetyInvoke(...args);' }));
      } }],
    });
    const { useDatabaseStore: store, useRecoveryStore: recovery, getReview, settleReview, requestExecutionApproval } = await import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
    const review = () => getReview();
    const nextReview = async () => {
      for (let tries = 0; tries < 50; tries++) {
        if (review()) return review();
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.fail('Expected a confirmation');
    };
    const connectionId = 'demo';
    store.setState({ activeConnectionId: connectionId, activeDatabase: 'demo', savedQueryStatus: 'ready',
      savedConnections: [{ id: connectionId, name: 'Demo', type: 'Postgres', database: 'demo' }] });
    recovery.setState({ status: 'ready' });
    store.getState().openTab({ type: 'query', connectionId, title: 'Draft', query: 'SELECT 42' });
    const tabId = store.getState().activeTabId;

    const close = store.getState().closeTab(tabId);
    settleReview(await nextReview(), 'save');
    await close;
    assert.equal(store.getState().tabs[0].query, 'SELECT 42');
    assert.match(store.getState().tabCloseNotice, /could not be saved/i);

    const remove = store.getState().removeConnection(connectionId);
    assert.match((await nextReview()).title, /Demo/);
    settleReview(review(), 'delete');
    settleReview(await nextReview(), null);
    await remove;
    assert.ok(store.getState().tabs.some(tab => tab.id === tabId));
    assert.equal(calls.some(call => call.command === 'forget_connection'), false);

    const discard = store.getState().closeTab(tabId);
    settleReview(await nextReview(), 'discard');
    await discard;
    assert.equal(store.getState().tabs.length, 0);
    store.getState().reopenClosedTab();
    assert.equal(store.getState().tabs[0].query, 'SELECT 42');

    failSave = false;
    store.setState({ savedQueryStatus: 'ready' });
    const save = store.getState().closeTab(tabId);
    settleReview(await nextReview(), 'save');
    await save;
    assert.equal(store.getState().tabs.length, 0);
    assert.ok(store.getState().savedQueries.some(query => query.sql === 'SELECT 42'));

    const run = requestExecutionApproval(connectionId, 'demo', { kind: 'sql', payload: 'SELECT 42' });
    const execution = await nextReview();
    assert.match(execution.description, /Demo.*demo/i);
    assert.equal(execution.details, 'SELECT 42');
    assert.equal(calls.some(call => call.command === 'prepare_execution'), false);
    settleReview(execution, 'run');
    assert.equal(await run, 'approval-token');
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
    delete globalThis.__workspaceSafetyInvoke;
  }
});
