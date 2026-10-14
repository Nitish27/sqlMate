import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/generatedSql.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { planGeneratedSqlAppend } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('generated SQL appends without replacing existing statements', () => {
  const existing = 'SELECT * FROM users;\n\nSELECT * FROM admins;';
  const edit = planGeneratedSqlAppend(existing, ' SELECT * FROM logs; ');
  assert.deepEqual(edit, { offset: existing.length, text: '\n\nSELECT * FROM logs;' });
  assert.equal(existing.slice(0, edit.offset) + edit.text, `${existing}\n\nSELECT * FROM logs;`);
});

test('generated SQL uses only the missing separator newlines', () => {
  assert.deepEqual(planGeneratedSqlAppend('SELECT 1;\n', 'SELECT 2;'), {
    offset: 10, text: '\nSELECT 2;',
  });
  assert.deepEqual(planGeneratedSqlAppend('SELECT 1;\n\n', 'SELECT 2;'), {
    offset: 11, text: 'SELECT 2;',
  });
  assert.deepEqual(planGeneratedSqlAppend('', ' SELECT 2; '), {
    offset: 0, text: 'SELECT 2;',
  });
});

test('generated SQL cannot merge with an unterminated existing statement', () => {
  const existing = 'SELECT 1 -- keep this comment';
  const edit = planGeneratedSqlAppend(existing, 'SELECT 2;');
  assert.deepEqual(edit, { offset: existing.length, text: '\n;\n\nSELECT 2;' });
});
