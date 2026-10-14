import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/connectionCredentials.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { sanitizeConnections, needsCredentialPrompt } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('saved connection metadata never contains legacy SSH passwords', () => {
  const [connection] = sanitizeConnections([{ id: 'one', name: 'db', type: 'MySql', ssh_password: 'secret' }]);
  assert.equal(connection.ssh_password, undefined);
});

test('remembered connections skip the prompt only when every required secret exists', () => {
  const connection = { id: 'one', type: 'MySql', rememberCredentials: true, ssh_enabled: true, ssh_auth_method: 'password' };
  assert.equal(needsCredentialPrompt(connection, { database: true, ssh: true }), false);
  assert.equal(needsCredentialPrompt(connection, { database: true, ssh: false }), true);
  assert.equal(needsCredentialPrompt(connection, { database: false, ssh: true }), true);
});

test('unremembered connections still request credentials', () => {
  assert.equal(needsCredentialPrompt({ type: 'Postgres' }, { database: true, ssh: true }), true);
  assert.equal(needsCredentialPrompt({ type: 'Sqlite' }, null), false);
});
