import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteIdentifier } from '../src/utils/sqlIdentifiers.ts';

test('uses backticks for MySQL and MariaDB identifiers', () => {
  assert.equal(quoteIdentifier('users', 'MySql'), '`users`');
  assert.equal(quoteIdentifier('id', 'MySql'), '`id`');
});

test('escapes the delimiter used by each database dialect', () => {
  assert.equal(quoteIdentifier('user`archive', 'MySql'), '`user``archive`');
  assert.equal(quoteIdentifier('user"archive', 'Postgres'), '"user""archive"');
  assert.equal(quoteIdentifier('user"archive', 'Sqlite'), '"user""archive"');
});
