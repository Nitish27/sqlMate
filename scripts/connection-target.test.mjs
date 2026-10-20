import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/connectionTarget.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { connectionTargetChanged, connectionTargetFingerprint } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('renaming or changing write protection keeps the same target', () => {
  const previous = { type: 'Postgres', host: 'db.example.com', database: 'app', safetyMode: 'Silent' };
  assert.equal(connectionTargetChanged(previous, { ...previous, name: 'Production', safetyMode: 'Alert' }), false);
});

test('database and SSH destination changes cannot silently reuse pending work', () => {
  const previous = { type: 'MySql', host: 'db.example.com', database: 'app', ssh_enabled: true, ssh_host: 'bastion-a' };
  assert.equal(connectionTargetChanged(previous, { ...previous, database: 'other' }), true);
  assert.equal(connectionTargetChanged(previous, { ...previous, ssh_host: 'bastion-b' }), true);
});

test('inactive SSH settings and implicit default ports do not change the target', () => {
  const previous = { type: 'Postgres', host: 'localhost', database: 'app', port: undefined, ssh_enabled: false };
  assert.equal(connectionTargetChanged(previous, { ...previous, port: 5432, ssh_host: 'unused' }), false);
});

test('SQLite metadata does not depend on hidden server fields', () => {
  const previous = { type: 'Sqlite', database: '/tmp/app.db' };
  assert.equal(connectionTargetChanged(previous, { ...previous, host: '127.0.0.1', username: '' }), false);
});

test('saved-query target fingerprint ignores labels but detects a new destination', () => {
  const previous = { type: 'MySql', host: 'db.example.com', port: 3306, username: 'app', database: 'main', ssh_enabled: true, ssh_host: 'bastion-a' };
  assert.equal(connectionTargetFingerprint(previous), connectionTargetFingerprint({ ...previous, name: 'Renamed', safetyMode: 'Safe' }));
  assert.notEqual(connectionTargetFingerprint(previous), connectionTargetFingerprint({ ...previous, ssh_host: 'bastion-b' }));
});
