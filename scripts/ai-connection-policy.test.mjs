import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/aiConnectionPolicy.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { effectiveAiAccess, aiAccessAfterEnvironmentChange } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('known non-production connections default to AI enabled, while untagged and production do not', () => {
  for (const environment of ['local', 'test', 'dev', 'staging']) {
    assert.equal(effectiveAiAccess(environment), true);
  }
  for (const environment of ['production', undefined, '', 'other']) {
    assert.equal(effectiveAiAccess(environment), false);
  }
});

test('production access requires explicit enablement and ordinary access can be disabled', () => {
  assert.equal(effectiveAiAccess('production', true), true);
  assert.equal(effectiveAiAccess('production', false), false);
  assert.equal(effectiveAiAccess('dev', false), false);
  assert.equal(effectiveAiAccess('other', true), false);
});

test('changing a connection to production clears previously granted AI access', () => {
  assert.equal(aiAccessAfterEnvironmentChange('dev', 'production', true), false);
  assert.equal(aiAccessAfterEnvironmentChange('production', 'production', true), true);
  assert.equal(aiAccessAfterEnvironmentChange('dev', 'staging', false), false);
});
