import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/utils/sqlCompletion.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { getSqlCompletionContext, findCompletionTable, getTableSuggestions, getColumnSuggestions } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const items = [
  { name: 'users', schema: 'public', item_type: 'Table' },
  { name: 'users', schema: 'audit', item_type: 'View' },
  { name: 'orders', schema: 'public', item_type: 'Table' },
  { name: 'update_users', item_type: 'Function' },
];

test('offers tables after FROM and JOIN, including a typed prefix', () => {
  const sql = 'SELECT * FROM us';
  assert.deepEqual(getSqlCompletionContext(sql, sql.length, 'Postgres'), {
    kind: 'table', prefix: 'us', replaceStart: 14, schema: undefined,
  });
  assert.equal(getSqlCompletionContext('SELECT * FROM users JOIN ', 25, 'Postgres')?.kind, 'table');
});

test('resolves aliases declared after the cursor', () => {
  const sql = 'SELECT u.na FROM public.users AS u';
  const context = getSqlCompletionContext(sql, sql.indexOf('na') + 2, 'Postgres');
  assert.equal(context?.kind, 'column');
  assert.equal(context?.qualifier, 'u');
  assert.equal(context?.prefix, 'na');
  assert.deepEqual(findCompletionTable(context, items), items[0]);
});

test('limits aliases to the current statement', () => {
  const sql = 'SELECT * FROM orders o; SELECT o.';
  const context = getSqlCompletionContext(sql, sql.length, 'Postgres');
  assert.equal(context?.kind, 'column');
  assert.equal(findCompletionTable(context, items), null);
});

test('ignores comment and string contents', () => {
  const sql = "SELECT * FROM users -- JOIN fake\nWHERE name = 'u.'";
  assert.equal(getSqlCompletionContext(sql, sql.length - 1, 'Postgres'), null);
  assert.equal(getSqlCompletionContext('SELECT * FROM -- users', 22, 'Postgres'), null);
  const dollarSql = 'SELECT $tag$ FROM users $tag$';
  assert.equal(getSqlCompletionContext(dollarSql, dollarSql.indexOf('users') + 3, 'Postgres'), null);
  const nestedComment = 'SELECT /* outer /* inner */ FROM users */ 1';
  assert.equal(getSqlCompletionContext(nestedComment, nestedComment.indexOf('users') + 3, 'Postgres'), null);
});

test('supports schema-qualified tables and quoted aliases', () => {
  const sql = 'SELECT "u". FROM audit.users AS "u"';
  const context = getSqlCompletionContext(sql, sql.indexOf('"u".') + 4, 'Postgres');
  assert.equal(context?.kind, 'column');
  assert.deepEqual(findCompletionTable(context, items), items[1]);
  const tableContext = getSqlCompletionContext('SELECT * FROM audit.us', 22, 'Postgres');
  assert.equal(tableContext?.schema, 'audit');
  const suggestions = getTableSuggestions(tableContext, items, 'Postgres');
  assert.deepEqual(suggestions.map(item => item.label), ['users']);
  assert.equal(suggestions[0].detail, 'audit');
  assert.equal(suggestions[0].insertText, '"users"');
  assert.equal(suggestions[0].filterText, 'users');
});

test('shows duplicate table names with schema context without changing inserted SQL', () => {
  const context = getSqlCompletionContext('SELECT * FROM us', 16, 'Postgres');
  const suggestions = getTableSuggestions(context, items, 'Postgres');
  assert.deepEqual(suggestions.map(item => [item.label, item.detail, item.itemType, item.insertText]), [
    ['users', 'audit', 'View', '"audit"."users"'],
    ['users', 'public', 'Table', '"public"."users"'],
  ]);
});

test('shows only the table name for MySQL suggestions while retaining database context', () => {
  const context = getSqlCompletionContext('SELECT * FROM adm', 17, 'MySql');
  const suggestions = getTableSuggestions(context, [
    { name: 'admins', schema: 'citizenfirewall', item_type: 'Table' },
  ], 'MySql');
  assert.equal(suggestions[0].label, 'admins');
  assert.equal(suggestions[0].detail, 'citizenfirewall');
  assert.equal(suggestions[0].insertText, '`citizenfirewall`.`admins`');
});

test('does not suggest ambiguous unqualified columns or routines as tables', () => {
  const context = getSqlCompletionContext('SELECT users.', 13, 'Postgres');
  assert.equal(findCompletionTable(context, items), null);
  const tableContext = getSqlCompletionContext('SELECT * FROM ', 14, 'Postgres');
  assert.equal(getTableSuggestions(tableContext, items, 'Postgres').some(item => item.label === 'update_users'), false);
});

test('column suggestions preserve exact identifiers and filter case-insensitively', () => {
  assert.deepEqual(getColumnSuggestions('NA', ['Name', 'email'], 'Postgres'), [
    { label: 'Name', insertText: '"Name"' },
  ]);
  assert.deepEqual(getColumnSuggestions('first', ['first_name'], 'MySql'), [
    { label: 'first_name', insertText: '`first_name`' },
  ]);
});
