import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/appearance.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { DEFAULT_SQL_EDITOR_APPEARANCE, previewSyntaxColors } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('light SQL preview substitutes legible defaults without changing saved colors', () => {
  const defaults = DEFAULT_SQL_EDITOR_APPEARANCE.syntaxColors;
  const light = previewSyntaxColors(defaults, 'light');
  assert.notEqual(light.identifiers, defaults.identifiers);
  assert.notEqual(light.operators, defaults.operators);
  assert.notEqual(light.keywords, defaults.keywords);
  assert.deepEqual(previewSyntaxColors(defaults, 'dark'), defaults);

  const custom = { ...defaults, identifiers: '#123456' };
  assert.equal(previewSyntaxColors(custom, 'light').identifiers, '#123456');
  assert.deepEqual(custom, { ...defaults, identifiers: '#123456' });
});
