import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/savedQueries.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { parseSavedQueries, upsertSavedQuery, renameSavedQuery, removeSavedQuery, filterSavedQueries } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const first = { id: 'q1', name: 'Recent users', sql: 'select * from users', connectionId: 'a', database: 'app', targetFingerprint: 'target-a', updatedAt: 10 };
const second = { id: 'q2', name: 'Audit', sql: 'select * from audit', connectionId: 'b', database: 'logs', targetFingerprint: 'target-b', updatedAt: 20 };

test('rejects damaged or future library data rather than silently overwriting it', () => {
  assert.deepEqual(parseSavedQueries(null), []);
  assert.deepEqual(parseSavedQueries({ version: 1, queries: [first] }), [first]);
  assert.throws(() => parseSavedQueries({ version: 2, queries: [first] }));
  assert.throws(() => parseSavedQueries({ version: 1, queries: [first, { ...second, sql: null }] }));
});

test('updates a saved query by id without changing its connection or database', () => {
  const result = upsertSavedQuery([first, second], { id: 'q1', name: 'Latest users', sql: 'select 1', connectionId: 'b', database: 'wrong', updatedAt: 30 });
  assert.deepEqual(result, [{ ...first, name: 'Latest users', sql: 'select 1', updatedAt: 30 }, second]);
});

test('renames and deletes only the requested query', () => {
  const renamed = renameSavedQuery([first, second], 'q1', '  New name  ');
  assert.deepEqual(renamed[0], { ...first, name: 'New name', updatedAt: renamed[0].updatedAt });
  assert.ok(renamed[0].updatedAt > first.updatedAt);
  assert.deepEqual(renamed[1], second);
  assert.deepEqual(removeSavedQuery([first, second], 'q2'), [first]);
});

test('filters by connection and matches title or SQL without exposing other connections', () => {
  assert.deepEqual(filterSavedQueries([first, second], 'a', 'users'), [first]);
  assert.deepEqual(filterSavedQueries([first, second], 'a', 'audit'), []);
});
