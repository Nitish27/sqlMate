import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/sensitiveData.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { isSensitiveColumn, hasSensitiveColumns, shouldMaskColumn } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('detects common secret column names without masking ordinary identifiers', () => {
  for (const name of ['password', 'password_hash', 'client_secret', 'apiKey', 'access_token', 'twofa_secret', 'private_key', 'credentials']) {
    assert.equal(isSensitiveColumn(name), true, name);
  }
  for (const name of ['id', 'primary_key', 'token_count', 'secretary', 'email', 'auth_method']) {
    assert.equal(isSensitiveColumn(name), false, name);
  }
});

test('detects whether a result contains any sensitive columns', () => {
  assert.equal(hasSensitiveColumns(['id', 'client_secret']), true);
  assert.equal(hasSensitiveColumns(['id', 'email']), false);
});

test('a manual toggle corrects both false positives and aliased secrets', () => {
  assert.equal(shouldMaskColumn('password', new Set()), true);
  assert.equal(shouldMaskColumn('password', new Set(['password'])), false);
  assert.equal(shouldMaskColumn('pw', new Set()), false);
  assert.equal(shouldMaskColumn('pw', new Set(['pw'])), true);
});
