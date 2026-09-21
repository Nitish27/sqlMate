import assert from 'node:assert/strict';
import test from 'node:test';
import { reorderTabs } from '../src/utils/tabReordering.ts';

const tabs = [
  { id: 'a-1', connectionId: 'a' },
  { id: 'b-1', connectionId: 'b' },
  { id: 'a-2', connectionId: 'a' },
  { id: 'a-3', connectionId: 'a' }
];

test('moves a tab before another tab from the same connection', () => {
  const reordered = reorderTabs(tabs, 'a-3', 'a-1', 'before');

  assert.deepEqual(reordered.map(tab => tab.id), ['a-3', 'a-1', 'b-1', 'a-2']);
});

test('moves a tab after another tab from the same connection', () => {
  const reordered = reorderTabs(tabs, 'a-1', 'a-3', 'after');

  assert.deepEqual(reordered.map(tab => tab.id), ['b-1', 'a-2', 'a-3', 'a-1']);
});

test('does not move tabs between connections', () => {
  const reordered = reorderTabs(tabs, 'a-1', 'b-1', 'before');

  assert.equal(reordered, tabs);
});
