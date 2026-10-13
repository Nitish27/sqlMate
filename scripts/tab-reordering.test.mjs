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
const { getTabDragPreview, reorderTabs } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('drag preview shifts variable-width neighbors and leaves a destination slot', () => {
  const preview = getTabDragPreview([
    { id: 'first', left: 8, width: 100 },
    { id: 'middle', left: 109, width: 150 },
    { id: 'last', left: 260, width: 80 },
  ], 'first', 350, 1);

  assert.deepEqual(preview.order, ['middle', 'last', 'first']);
  assert.deepEqual(preview.offsets, { first: 232, middle: -101, last: -101 });
});

test('lifting a middle tab does not move it before crossing a neighbor', () => {
  const preview = getTabDragPreview([
    { id: 'first', left: 8, width: 100 },
    { id: 'middle', left: 109, width: 150 },
    { id: 'last', left: 260, width: 80 },
  ], 'middle', 184, 1);

  assert.deepEqual(preview.order, ['first', 'middle', 'last']);
  assert.deepEqual(preview.offsets, { first: 0, middle: 0, last: 0 });
});

test('unchanged preview leaves measured tab positions untouched', () => {
  const preview = getTabDragPreview([
    { id: 'first', left: 8, width: 100.5 },
    { id: 'middle', left: 110, width: 150 },
  ], 'middle', 185, 1);

  assert.deepEqual(preview.offsets, { first: 0, middle: 0 });
});

test('dropping the first tab on the right half of the last tab moves it to the end', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'middle', connectionId: 'a' },
    { id: 'last', connectionId: 'a' },
  ];
  assert.deepEqual(reorderTabs(tabs, 'first', 'last', 'after').map(tab => tab.id), [
    'middle', 'last', 'first',
  ]);
});

test('dropping to the left of a middle tab inserts before it', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'middle', connectionId: 'a' },
    { id: 'last', connectionId: 'a' },
  ];
  assert.deepEqual(reorderTabs(tabs, 'last', 'middle', 'before').map(tab => tab.id), [
    'first', 'last', 'middle',
  ]);
});

test('dropping in empty space after the final tab appends the dragged tab', () => {
  const preview = getTabDragPreview([
    { id: 'first', left: 0, width: 100 },
    { id: 'last', left: 101, width: 100 },
  ], 'first', 260, 1);
  assert.deepEqual(preview.order, ['last', 'first']);
});

test('reordering never moves a tab into another connection', () => {
  const tabs = [
    { id: 'first', connectionId: 'a' },
    { id: 'other', connectionId: 'b' },
  ];
  assert.equal(reorderTabs(tabs, 'first', 'other', 'after'), tabs);
});
