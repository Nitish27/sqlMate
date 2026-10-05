import assert from 'node:assert/strict';
import test from 'node:test';
import { resizeColumnWidth } from '../src/utils/columnSizing.ts';

test('increases a column width by the pointer movement', () => {
  assert.equal(resizeColumnWidth(150, 45, 60), 195);
});

test('does not shrink a column below its minimum width', () => {
  assert.equal(resizeColumnWidth(150, -200, 60), 60);
});
