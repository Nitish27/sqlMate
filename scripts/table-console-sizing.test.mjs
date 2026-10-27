import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/tableConsoleSizing.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { clampTableConsoleHeight, maxTableConsoleHeight } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('dragging up enlarges the console without hiding the table', () => {
  assert.equal(maxTableConsoleHeight(700), 540);
  assert.equal(clampTableConsoleHeight(600, 700), 540);
});

test('dragging down keeps the SQL log usable', () => {
  assert.equal(clampTableConsoleHeight(20, 700), 80);
  assert.equal(clampTableConsoleHeight(240, 700), 240);
});

test('small windows cannot produce a negative console range', () => {
  assert.equal(maxTableConsoleHeight(180), 80);
  assert.equal(clampTableConsoleHeight(300, 180), 80);
});
