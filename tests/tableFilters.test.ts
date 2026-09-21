import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultTableFilter } from '../src/utils/tableFilters.ts';

test('creates an enabled equals filter for the first table column', () => {
  assert.deepEqual(createDefaultTableFilter(['id', 'email'], 'filter-1'), {
    id: 'filter-1',
    column: 'id',
    operator: '=',
    value: '',
    enabled: true
  });
});
