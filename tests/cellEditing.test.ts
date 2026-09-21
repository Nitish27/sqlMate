import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCellEditorValue } from '../src/utils/cellEditing.ts';

test('preserves numeric cell types after inline editing', () => {
  assert.equal(parseCellEditorValue(0, '1'), 1);
  assert.equal(parseCellEditorValue(42, '7'), 7);
});

test('keeps text cell edits as strings', () => {
  assert.equal(parseCellEditorValue('42', '7'), '7');
});
