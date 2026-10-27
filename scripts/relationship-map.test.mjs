import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/relationshipMap.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { buildRelationshipMap, relationshipTableKey, resolveRelationshipFocus, canOpenRelationshipNode, relationshipContextAvailable } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const table = (name, schema = null) => ({ name, schema, columns: [{
  name: 'id', data_type: 'integer', is_nullable: false, default_value: null, is_primary_key: true,
}] });
const snapshot = (tables) => ({ engine: 'Postgres', database: 'app', tables });
const edge = (source_table, target_table, extra = {}) => ({
  name: `${source_table}_fk`, source_schema: 'public', source_table,
  source_columns: ['target_id'], target_schema: 'public', target_table,
  target_columns: ['id'], ...extra,
});

test('relationship map keeps incoming and outgoing edges around the focused table', () => {
  const graph = buildRelationshipMap(
    snapshot([table('users', 'public'), table('posts', 'public'), table('teams', 'public'), table('unrelated', 'public')]),
    [edge('posts', 'users'), edge('users', 'teams')],
    { schema: 'public', name: 'users' },
  );
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.edges.map(item => [item.sourceKey, item.targetKey]), [
    [relationshipTableKey('public', 'posts'), relationshipTableKey('public', 'users')],
    [relationshipTableKey('public', 'users'), relationshipTableKey('public', 'teams')],
  ]);
  assert.equal(graph.nodes.find(node => node.name === 'posts').direction, 'incoming');
  assert.equal(graph.nodes.find(node => node.name === 'teams').direction, 'outgoing');
});

test('relationship map groups composite keys and keeps same-name PostgreSQL schemas apart', () => {
  const graph = buildRelationshipMap(
    snapshot([table('orders', 'public'), table('accounts', 'public'), table('accounts', 'archive')]),
    [edge('orders', 'accounts', {
      source_columns: ['tenant_id', 'account_id'],
      target_columns: ['tenant_id', 'id'],
    }), edge('orders', 'accounts', {
      name: 'archive_account_fk', target_schema: 'archive', source_columns: ['old_account_id'],
    })],
    { schema: 'public', name: 'orders' },
  );
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges[0].relationship.source_columns.length, 2);
  assert.notEqual(graph.edges[0].targetKey, graph.edges[1].targetKey);
});

test('relationship map exposes missing targets and an empty declared-key state', () => {
  const graph = buildRelationshipMap(
    snapshot([table('events', 'public')]),
    [edge('events', 'missing')],
    { schema: 'public', name: 'events' },
  );
  assert.equal(graph.nodes.find(node => node.name === 'missing').missing, true);
  assert.equal(buildRelationshipMap(snapshot([table('events', 'public')]), [], { schema: 'public', name: 'events' }).edges.length, 0);
});

test('relationship navigation only opens tables supported by the existing browser', () => {
  const schema = snapshot([table('users', 'public'), table('users', 'audit')]);
  assert.deepEqual(resolveRelationshipFocus(schema, 'users'), { schema: 'public', name: 'users' });
  assert.deepEqual(resolveRelationshipFocus(schema, 'audit.users'), { schema: 'audit', name: 'users' });
  assert.equal(canOpenRelationshipNode({ schema: 'public', missing: false }, 'Postgres'), true);
  assert.equal(canOpenRelationshipNode({ schema: 'audit', missing: false }, 'Postgres'), false);
  assert.equal(canOpenRelationshipNode({ schema: null, missing: true }, 'Sqlite'), false);
  assert.equal(canOpenRelationshipNode({ schema: null, missing: false }, 'Sqlite'), true);
});

test('stale relationship maps cannot navigate after a connection or database switch', () => {
  const context = { openConnectionIds: ['one'], activeConnectionId: 'one', activeDatabases: { one: 'app' } };
  assert.equal(relationshipContextAvailable(context, 'one', 'app'), true);
  assert.equal(relationshipContextAvailable({ ...context, activeConnectionId: 'other' }, 'one', 'app'), false);
  assert.equal(relationshipContextAvailable({ ...context, openConnectionIds: [] }, 'one', 'app'), false);
  assert.equal(relationshipContextAvailable({ ...context, activeDatabases: { one: 'other' } }, 'one', 'app'), false);
});
