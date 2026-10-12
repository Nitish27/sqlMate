import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStagedRows, buildRowMutationBatch, rowIdentity } from '../src/utils/rowMutations.ts';

test('a composite key uses every original key value, never the row index', () => {
  const columns = ['tenant_id', 'id', 'name'];
  const original = [7, 42, 'old'];
  assert.deepEqual(rowIdentity(columns, original, ['tenant_id', 'id']), {
    tenant_id: 7,
    id: 42,
  });
  const batch = buildRowMutationBatch('users', columns, ['tenant_id', 'id'], [{
    type: 'update', rowIndex: 99, originalData: original,
    cellChanges: [{ rowIndex: 99, columnName: 'name', originalValue: 'old', newValue: 'new' }],
  }]);
  assert.deepEqual(batch.changes, [{
    kind: 'update',
    original: { tenant_id: 7, id: 42, name: 'old' },
    values: { name: 'new' },
  }]);
});

test('missing or null keys fail closed for existing rows', () => {
  assert.equal(rowIdentity(['id'], [5], []), null);
  assert.equal(rowIdentity(['id'], [null], ['id']), null);
  assert.throws(() => buildRowMutationBatch('users', ['id'], [], [{
    type: 'delete', rowIndex: 0, originalData: [5],
  }]));
});

test('unsafe numeric primary keys cannot identify a row', () => {
  const unsafeId = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(rowIdentity(['id'], [unsafeId], ['id']), null);
  assert.throws(() => buildRowMutationBatch('users', ['id'], ['id'], [{
    type: 'delete', rowIndex: 0, originalData: [unsafeId],
  }]));
});

test('new rows can be inserted without a key and values remain typed', () => {
  const batch = buildRowMutationBatch('events', ['message', 'enabled', 'count'], [], [{
    type: 'insert', rowIndex: 0, newData: ["a'\\b", true, 3],
  }]);
  assert.deepEqual(batch.changes, [{
    kind: 'insert', values: { message: "a'\\b", enabled: true, count: 3 },
  }]);
});

test('editing a scalar column does not require reading an unrelated binary column', () => {
  const columns = ['id', 'name', 'blob'];
  const original = [5, 'old', 'Binary/Complex (blob)'];
  const batch = buildRowMutationBatch('items', columns, ['id'], [{
    type: 'update', rowIndex: 0, originalData: original,
    cellChanges: [{ rowIndex: 0, columnName: 'name', originalValue: 'old', newValue: 'new' }],
  }]);
  assert.equal(batch.changes[0].kind, 'update');
  assert.throws(() => buildRowMutationBatch('items', columns, ['id'], [{
    type: 'delete', rowIndex: 0, originalData: original,
  }]));
});

test('adding another row preserves staged cell and inserted-row values in the grid', () => {
  const changes = new Map([
    [0, { type: 'update' as const, rowIndex: 0, cellChanges: [{
      rowIndex: 0, columnName: 'name', originalValue: 'old', newValue: 'edited',
    }] }],
    [1, { type: 'insert' as const, rowIndex: 1, newData: [null, 'new row'] }],
  ]);
  assert.deepEqual(applyStagedRows(['id', 'name'], [[1, 'old'], [null, null], [null, null]], changes), [
    [1, 'edited'], [null, 'new row'], [null, null],
  ]);
});
