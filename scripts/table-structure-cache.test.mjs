import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/tableStructureCache.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { createTableStructureCache } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('table structure loads once across tab switches and refreshes after expiry', async () => {
  const cache = createTableStructureCache(2, 10);
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cache.get('conn', 'db', 'users', load), 1);
  assert.equal(await cache.get('conn', 'db', 'users', load), 1);
  assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(await cache.get('conn', 'db', 'users', load), 2);
});

test('concurrent structure requests share one flight and invalidation rejects stale cache', async () => {
  const cache = createTableStructureCache();
  let resolve;
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise(done => { resolve = done; });
  };
  const first = cache.get('conn', 'db', 'users', load);
  const second = cache.get('conn', 'db', 'users', load);
  assert.equal(calls, 1);
  cache.invalidate('conn');
  resolve('old');
  assert.equal(await first, 'old');
  assert.equal(await second, 'old');
  assert.equal(await cache.get('conn', 'db', 'users', async () => 'new'), 'new');
});
