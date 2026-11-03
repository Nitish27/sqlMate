import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['src/utils/dataProfiler.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { profileSample, sampleCoverage } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);

test('profiles nulls, distinct values, common values, and numeric ranges from sampled rows', () => {
  const result = profileSample(['id', 'status', 'score'], [
    [1, 'open', 2], [2, 'open', null], [3, 'closed', 8], [4, null, 4],
  ]);
  assert.equal(result[1].nullCount, 1);
  assert.equal(result[1].distinctCount, 2);
  assert.deepEqual(result[1].commonValues, [{ value: 'open', count: 2 }, { value: 'closed', count: 1 }]);
  assert.deepEqual(result[2].numericRange, { min: 2, max: 8 });
});

test('never exposes common values or ranges for sensitive columns', () => {
  const result = profileSample(['api_key', 'password'], [['secret-1', 123], ['secret-2', 456]]);
  assert.deepEqual(result.map(column => column.commonValues), [[], []]);
  assert.deepEqual(result.map(column => column.numericRange), [null, null]);
  assert.equal(result[0].distinctCount, 2);
});

test('handles empty and structured samples without treating objects as display values', () => {
  assert.deepEqual(profileSample(['id'], []), [{ name: 'id', nullCount: 0, distinctCount: 0, commonValues: [], numericRange: null }]);
  const result = profileSample(['data'], [[{ a: 1 }], [{ a: 1 }], [{ a: 2 }]]);
  assert.equal(result[0].distinctCount, 2);
  assert.deepEqual(result[0].commonValues, []);
});

test('coverage labels bounded samples and full returns without implying randomness', () => {
  assert.match(sampleCoverage(100, true, 100), /first 100 rows/i);
  assert.match(sampleCoverage(100, true, 100), /not a full-table profile/i);
  assert.match(sampleCoverage(3, false, 100), /All 3 rows returned/);
});
