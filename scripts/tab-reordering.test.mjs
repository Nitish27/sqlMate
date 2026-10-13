import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/tabReordering.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { getTabDropTarget, reorderTabs } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('dropping the first tab on the right half of the last tab moves it to the end', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'middle', connectionId: 'a' },
    { id: 'last', connectionId: 'a' },
  ];
  const target = getTabDropTarget([
    { id: 'first', left: 0, right: 100 },
    { id: 'middle', left: 100, right: 200 },
    { id: 'last', left: 200, right: 300 },
  ], 275);

  assert.deepEqual(reorderTabs(tabs, 'first', target.tabId, target.position).map(tab => tab.id), [
    'middle', 'last', 'first',
  ]);
});

test('dropping to the left of a middle tab inserts before it', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'middle', connectionId: 'a' },
    { id: 'last', connectionId: 'a' },
  ];
  const target = getTabDropTarget([
    { id: 'first', left: 0, right: 100 },
    { id: 'middle', left: 100, right: 200 },
    { id: 'last', left: 200, right: 300 },
  ], 125);

  assert.deepEqual(reorderTabs(tabs, 'last', target.tabId, target.position).map(tab => tab.id), [
    'first', 'last', 'middle',
  ]);
});

test('dropping in empty space after the final tab appends the dragged tab', () => {
  const target = getTabDropTarget([
    { id: 'first', left: 0, right: 100 },
    { id: 'last', left: 100, right: 200 },
  ], 260);
  assert.deepEqual(target, { tabId: 'last', position: 'after' });
});

test('reordering never moves a tab into another connection', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'other', connectionId: 'b' },
  ];
  assert.equal(reorderTabs(tabs, 'first', 'other', 'after'), tabs);
});
