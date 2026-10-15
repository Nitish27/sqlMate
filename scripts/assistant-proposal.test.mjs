import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/assistantProposal.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false,
});
const { canEditAssistantProposal } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

test('assistant proposals are editable only in the exact prepared editor context', () => {
  const prepared = { connectionId: 'one', database: 'db', version: 12 };
  assert.equal(canEditAssistantProposal(prepared, { ...prepared }), true);
  assert.equal(canEditAssistantProposal(prepared, { ...prepared, version: 13 }), false);
  assert.equal(canEditAssistantProposal(prepared, { ...prepared, connectionId: 'two' }), false);
  assert.equal(canEditAssistantProposal(prepared, { ...prepared, database: 'other' }), false);
  assert.equal(canEditAssistantProposal({ ...prepared, version: null }, prepared), false);
});
