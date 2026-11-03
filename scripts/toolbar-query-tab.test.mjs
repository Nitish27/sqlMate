import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/toolbarQueryTab.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { findToolbarQueryTab } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const tabs = [
  { id: 'first', type: 'query', title: 'SQL Query', connectionId: 'local', database: 'app', query: 'select 1' },
  { id: 'remote', type: 'query', title: 'SQL Query', connectionId: 'remote', database: 'app', query: 'select 2' },
  { id: 'saved', type: 'query', title: 'SQL Query', savedQueryId: 'saved-1', connectionId: 'local', database: 'app' },
  { id: 'table', type: 'table', title: 'SQL Query', connectionId: 'local', database: 'app' },
  { id: 'last', type: 'query', title: 'SQL Query', connectionId: 'local', database: 'app', query: 'select 3' },
  { id: 'other-database', type: 'query', title: 'SQL Query', connectionId: 'local', database: 'audit', query: 'select 4' },
];

test('reuses the active ordinary SQL Query tab without changing its SQL', () => {
  assert.equal(findToolbarQueryTab(tabs, 'local', 'app', 'first'), tabs[0]);
});

test('otherwise chooses the latest ordinary SQL Query tab for this connection', () => {
  assert.equal(findToolbarQueryTab(tabs, 'local', 'app', 'table'), tabs[4]);
  assert.equal(findToolbarQueryTab(tabs, 'remote', 'app', 'first'), tabs[1]);
  assert.equal(findToolbarQueryTab(tabs, 'local', 'audit', 'first'), tabs[5]);
});

test('does not reuse saved, table, or other-connection tabs', () => {
  assert.equal(findToolbarQueryTab(tabs.slice(1, 4), 'local', 'app', 'saved'), undefined);
});
