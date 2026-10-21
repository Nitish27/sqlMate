import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryResultsLayout.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { headerContentWidthForBody } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('header reaches the same horizontal offset as a body with a vertical scrollbar', () => {
  const viewportWidth = 320;
  const gridWidth = 1000;
  const scrollbarWidth = 8;
  const bodyMaxScrollLeft = gridWidth - (viewportWidth - scrollbarWidth);
  const headerMaxScrollLeft = headerContentWidthForBody(gridWidth, scrollbarWidth) - viewportWidth;

  assert.equal(headerMaxScrollLeft, bodyMaxScrollLeft);
});

test('overlay scrollbars do not add an unnecessary header gap', () => {
  assert.equal(headerContentWidthForBody(1000, 0), 1000);
  assert.equal(headerContentWidthForBody(1000, -1), 1000);
});
