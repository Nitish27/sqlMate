import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/connectionClarity.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { connectionIdentity, safetyModeDescription, requiresProtectionDowngradeConfirmation } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('connection identity shows the actual environment and database target without secrets', () => {
  const identity = connectionIdentity({
    name: 'Billing', type: 'MySql', environment: 'production', host: 'db.example.com', port: 3306,
    username: 'admin', database: 'billing', password: 'secret', color: 'red',
  });
  assert.equal(identity.environment, 'PRODUCTION');
  assert.equal(identity.target, 'billing @ db.example.com:3306');
  assert.equal(identity.description, 'Billing | PRODUCTION tag | billing @ db.example.com:3306');
  assert.equal(identity.description.includes('secret'), false);
});

test('untagged and SQLite connections do not pretend to be local servers', () => {
  assert.equal(connectionIdentity({ name: 'Archive', type: 'Sqlite', database: '/tmp/archive.db' }).environment, 'UNTAGGED');
  assert.equal(connectionIdentity({ name: 'Archive', type: 'Sqlite', database: '/tmp/archive.db' }).target, '/tmp/archive.db');
});

test('mode descriptions reflect actual SQL approval behavior', () => {
  assert.match(safetyModeDescription('Alert'), /every SQL query and data change/i);
  assert.match(safetyModeDescription('Safe'), /read-only SELECT/i);
  assert.match(safetyModeDescription('Silent'), /without confirmation/i);
});

test('reducing protection requires confirmation, increasing it does not', () => {
  assert.equal(requiresProtectionDowngradeConfirmation('Safe', 'Alert'), true);
  assert.equal(requiresProtectionDowngradeConfirmation('Alert', 'Silent'), true);
  assert.equal(requiresProtectionDowngradeConfirmation('Silent', 'Safe'), false);
});
