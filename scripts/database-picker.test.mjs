import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/databasePicker.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { filterDatabases, moveDatabaseSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('database search is case-insensitive and trims whitespace', () => {
  assert.deepEqual(filterDatabases(['shop', 'Customer_Archive', 'customer_live'], ' CUSTOMER '),
    ['Customer_Archive', 'customer_live']);
});

test('database keyboard selection wraps and stays safe for empty results', () => {
  assert.equal(moveDatabaseSelection(0, 3, -1), 2);
  assert.equal(moveDatabaseSelection(2, 3, 1), 0);
  assert.equal(moveDatabaseSelection(0, 0, 1), 0);
});
