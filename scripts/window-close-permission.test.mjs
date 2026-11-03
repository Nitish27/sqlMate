import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('main window can finish a close request after workspace recovery flushes', () => {
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  assert.ok(capability.permissions.includes('core:window:allow-destroy'));
});
