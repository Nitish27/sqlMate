import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/urlParser.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { parseConnectionUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('SQLite URL import preserves an absolute path', () => {
  assert.equal(parseConnectionUrl('sqlite:///tmp/test.db')?.database, '/tmp/test.db');
});

test('URL import retains the requested TLS verification mode', () => {
  assert.deepEqual(parseConnectionUrl('postgres://user:pass@db.example.com/app?sslmode=verify-full'), {
    db_type: 'Postgres',
    host: 'db.example.com',
    port: undefined,
    username: 'user',
    password: 'pass',
    database: 'app',
    ssl_enabled: true,
    ssl_mode: 'verify-full',
  });
});
