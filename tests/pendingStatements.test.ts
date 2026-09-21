import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSyncPendingStatements } from '../src/utils/pendingStatements.ts';

test('syncs regenerated SQL when the pending editor is unchanged', () => {
  const previousStatements = ['UPDATE "users" SET "first_name" = \'Victory\' WHERE "id" = 1069;'];
  const editedStatements = [...previousStatements];
  const nextStatements = ['UPDATE `users` SET `first_name` = \'Victory\' WHERE `id` = 1069;'];

  assert.equal(
    shouldSyncPendingStatements(previousStatements, editedStatements, nextStatements),
    true
  );
});

test('preserves SQL that the user edited manually', () => {
  const previousStatements = ['UPDATE "users" SET "first_name" = \'Victory\' WHERE "id" = 1069;'];
  const editedStatements = ['UPDATE users SET first_name = \'Custom\' WHERE id = 1069;'];
  const nextStatements = ['UPDATE `users` SET `first_name` = \'Victory\' WHERE `id` = 1069;'];

  assert.equal(
    shouldSyncPendingStatements(previousStatements, editedStatements, nextStatements),
    false
  );
});
