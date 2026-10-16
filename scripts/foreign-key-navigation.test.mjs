import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/foreignKeyNavigation.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { filtersForForeignKey } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const composite = {
  name: 'membership_group_fk',
  source_columns: ['tenant_id', 'group_id'],
  target_table: 'groups',
  target_columns: ['tenant_id', 'id'],
};

test('foreign-key navigation filters all target columns using the displayed row', () => {
  const filters = filtersForForeignKey(composite, ['group_id', 'tenant_id'], [9, 3]);
  assert.deepEqual(filters.map(({ column, operator, value, enabled }) =>
    ({ column, operator, value, enabled })), [
    { column: 'tenant_id', operator: '=', value: '3', enabled: true },
    { column: 'id', operator: '=', value: '9', enabled: true },
  ]);
});

test('incomplete, null, and complex references do not create navigation filters', () => {
  assert.equal(filtersForForeignKey(composite, ['tenant_id'], [3]), null);
  assert.equal(filtersForForeignKey(composite, ['tenant_id', 'group_id'], [3, null]), null);
  assert.equal(filtersForForeignKey(composite, ['tenant_id', 'group_id'], [3, { binary: true }]), null);
  assert.equal(filtersForForeignKey({ ...composite, target_columns: ['id'] }, ['tenant_id', 'group_id'], [3, 9]), null);
});
