import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/sqlIdentifiers.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { quoteTableReference } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('DuckDB table references quote schema and table separately', () => {
  assert.equal(quoteTableReference('archive.orders', 'DuckDb'), '"archive"."orders"');
  assert.equal(quoteTableReference('main.orders', 'DuckDb'), '"main"."orders"');
});

test('legacy PostgreSQL references go to public; MySQL and SQLite remain unqualified', () => {
  assert.equal(quoteTableReference('orders', 'Postgres'), '"public"."orders"');
  assert.equal(quoteTableReference('orders', 'MySql'), '`orders`');
  assert.equal(quoteTableReference('orders', 'Sqlite'), '"orders"');
});
