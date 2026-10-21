import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/tablePageCache.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createTablePageCache, integerKeysetCursor, tablePageKeys } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('keyset cursor is used only for a safe integer primary key in default order', () => {
  const page = { columns: ['id', 'name'], rows: [[2, 'two'], [3, 'three']], time: 1 };
  assert.equal(integerKeysetCursor(page, ['id'], { id: 'INTEGER' }, null), 3);
  assert.equal(integerKeysetCursor(page, ['id'], { id: 'INTEGER' }, 'name'), undefined);
  assert.equal(integerKeysetCursor(page, ['id', 'name'], { id: 'INTEGER' }, null), undefined);
  assert.equal(integerKeysetCursor(page, ['id'], { id: 'TEXT' }, null), undefined);
  assert.equal(integerKeysetCursor({ ...page, rows: [[Number.MAX_SAFE_INTEGER + 1, 'x']] },
    ['id'], { id: 'BIGINT' }, null), undefined);
});

const base = {
  connectionId: 'a', database: 'app', tableName: 'users', filters: [],
  sortColumn: null, sortDirection: 'ASC', limit: 100, offset: 0, generation: 0,
};

test('page identity includes pagination, filters, sort, target, and refresh generation', () => {
  const key = tablePageKeys(base);
  assert.notEqual(key.page, tablePageKeys({ ...base, offset: 100 }).page);
  assert.equal(key.count, tablePageKeys({ ...base, offset: 100 }).count);
  assert.equal(key.count, tablePageKeys({ ...base, sortColumn: 'id' }).count);
  for (const change of [
    { filters: [{ column: 'name', value: 'x', enabled: true }] },
    { database: 'other' }, { connectionId: 'b' }, { tableName: 'orders' },
    { generation: 1 },
  ]) {
    assert.notEqual(key.count, tablePageKeys({ ...base, ...change }).count);
  }
});

test('cached pages remain visible when stale and refresh only when due', () => {
  const cache = createTablePageCache(2, 4, 1000);
  const keys = tablePageKeys(base);
  cache.putPage('tab', keys.page, { columns: ['id'], rows: [[1]], time: 5 }, 100);
  assert.equal(cache.getPage('tab', keys.page, 500)?.fresh, true);
  assert.equal(cache.getPage('tab', keys.page, 1200)?.fresh, false);
  assert.deepEqual(cache.getPage('tab', keys.page, 1200)?.value.rows, [[1]]);
});

test('count is shared across pages but not across filters or refreshes', () => {
  const cache = createTablePageCache(2, 4, 1000);
  const key = tablePageKeys(base).count;
  cache.putCount('tab', key, 350, 100);
  assert.equal(cache.getCount('tab', tablePageKeys({ ...base, offset: 200 }).count, 500)?.value, 350);
  assert.equal(cache.getCount('tab', tablePageKeys({ ...base, generation: 1 }).count, 500), undefined);
  assert.equal(cache.getCount('tab', key, 1200)?.fresh, false);
});

test('evicts oldest pages per tab and clears sensitive rows when tab closes', () => {
  const cache = createTablePageCache(2, 4, 1000);
  for (let offset = 0; offset < 300; offset += 100) {
    const key = tablePageKeys({ ...base, offset }).page;
    cache.putPage('tab', key, { columns: ['secret'], rows: [[offset]], time: 1 }, 100);
  }
  assert.equal(cache.getPage('tab', tablePageKeys(base).page, 200), undefined);
  cache.putCount('tab', tablePageKeys(base).count, 3, 100);
  cache.dropTab('tab');
  assert.equal(cache.getPage('tab', tablePageKeys({ ...base, offset: 200 }).page, 200), undefined);
  assert.equal(cache.getCount('tab', tablePageKeys(base).count, 200), undefined);
});
