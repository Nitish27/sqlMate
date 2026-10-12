import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/rowDrafts.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { reconcileRowDraft } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

const columns = ['id', 'name'];
const primaryKeys = ['id'];

test('restored edits follow primary keys, not old row positions', () => {
  const draft = {
    version: 1,
    columns,
    primaryKeys,
    changes: [{
      type: 'update', rowIndex: 0, originalData: [1, 'before'],
      cellChanges: [{ rowIndex: 0, columnName: 'name', originalValue: 'before', newValue: 'after' }],
    }],
  };
  const restored = reconcileRowDraft(draft, columns, primaryKeys, [[2, 'other'], [1, 'before']]);
  assert.equal(restored.get(1)?.cellChanges?.[0].newValue, 'after');
  assert.equal(restored.get(1)?.rowIndex, 1);
  assert.equal(restored.has(0), false);
});

test('off-page edits stay pending but cannot attach to a different row', () => {
  const draft = {
    version: 1, columns, primaryKeys,
    changes: [{ type: 'delete', rowIndex: 0, originalData: [1, 'before'] }],
  };
  const restored = reconcileRowDraft(draft, columns, primaryKeys, [[2, 'other']]);
  assert.equal(restored.get(-1)?.originalData?.[0], 1);
  assert.equal(restored.has(0), false);
});

test('schema changes reject draft reconciliation', () => {
  const draft = { version: 1, columns, primaryKeys, changes: [] };
  assert.throws(() => reconcileRowDraft(draft, ['id', 'renamed'], primaryKeys, []));
});

test('restored inserts receive current append positions', () => {
  const draft = { version: 1, columns, primaryKeys,
    changes: [
      { type: 'insert', rowIndex: 99, newData: [null, 'first'] },
      { type: 'insert', rowIndex: 100, newData: [null, 'second'] },
    ],
  };
  const restored = reconcileRowDraft(draft, columns, primaryKeys, [[1, 'existing']]);
  assert.equal(restored.get(1)?.newData?.[1], 'first');
  assert.equal(restored.get(2)?.newData?.[1], 'second');
});
