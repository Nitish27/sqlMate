import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryParameters.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { findQueryParameters, parseParameterValue } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('finds unique named parameters in order', () => {
  assert.deepEqual(findQueryParameters('SELECT * FROM users WHERE id = :id OR manager_id = :id AND name = :name'), ['id', 'name']);
});

test('ignores parameters in literals, comments, identifiers, and PostgreSQL casts', () => {
  const sql = `SELECT ':fake', "x:fake", \`x:fake\`, :real::int, $$:fake$$, $tag$:fake$tag$ -- :fake\n/* :fake */ WHERE id = :other`;
  assert.deepEqual(findQueryParameters(sql), ['real', 'other']);
});

test('ignores nested block comments', () => {
  assert.deepEqual(findQueryParameters('SELECT /* outer /* :ignored */ still :ignored */ :active'), ['active']);
});

test('parses typed values without interpolating SQL', () => {
  assert.deepEqual(parseParameterValue('42', 'auto'), { type: 'integer', value: 42 });
  assert.deepEqual(parseParameterValue('0042', 'auto'), { type: 'text', value: '0042' });
  assert.deepEqual(parseParameterValue('0.123456789012345678901', 'auto'), { type: 'text', value: '0.123456789012345678901' });
  assert.deepEqual(parseParameterValue('1.25', 'float'), { type: 'float', value: 1.25 });
  assert.deepEqual(parseParameterValue('false', 'auto'), { type: 'boolean', value: false });
  assert.deepEqual(parseParameterValue('', 'null'), { type: 'null' });
  assert.throws(() => parseParameterValue('1.2', 'integer'), /integer/i);
});
