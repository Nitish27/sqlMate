import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveActiveSqlStatement } from '../src/utils/sqlStatements.ts';

const dialects = ['Postgres', 'MySql', 'Sqlite'] as const;

for (const dialect of dialects) {
  test(`${dialect}: cursor boundaries and ranges agree`, () => {
    const sql = 'select 1;\n\nselect 2;';
    for (const cursorOffset of [0, 4, 8, 9]) {
      assert.deepEqual(resolveActiveSqlStatement(sql, cursorOffset, dialect), {
        sql: 'select 1;', startOffset: 0, endOffset: 9,
      });
    }
    for (const cursorOffset of [11, 15, 19, 20]) {
      assert.deepEqual(resolveActiveSqlStatement(sql, cursorOffset, dialect), {
        sql: 'select 2;', startOffset: 11, endOffset: 20,
      });
    }
    assert.equal(resolveActiveSqlStatement(sql, 10, dialect), null);
  });

  test(`${dialect}: same-line, CRLF, indentation, and multiline whitespace`, () => {
    assert.equal(resolveActiveSqlStatement('select 1; select 2;', 9, dialect)?.sql, 'select 1;');
    assert.equal(resolveActiveSqlStatement('select 1; select 2;', 10, dialect)?.sql, 'select 2;');
    assert.equal(resolveActiveSqlStatement('select 1;   ', 12, dialect)?.sql, 'select 1;');
    assert.equal(resolveActiveSqlStatement('select 1;\r\n\r\n  select 2;', 11, dialect), null);
    assert.equal(resolveActiveSqlStatement('select 1;\r\n\r\n  select 2;', 14, dialect)?.sql, 'select 2;');
    assert.equal(resolveActiveSqlStatement('select\n\n1;\nselect 2;', 7, dialect)?.sql, 'select\n\n1;');
  });

  test(`${dialect}: quoted semicolons, doubled quotes, Unicode, and attached comments`, () => {
    const sql = `-- attached\nselect '😀;it''s', "a;b";\nselect 2`;
    const first = sql.slice(0, sql.indexOf('\nselect 2'));
    assert.deepEqual(resolveActiveSqlStatement(sql, sql.indexOf('it'), dialect), {
      sql: first, startOffset: 0, endOffset: first.length,
    });
    assert.equal(resolveActiveSqlStatement(sql, sql.length, dialect)?.sql, 'select 2');
    assert.equal(resolveActiveSqlStatement(sql, -1, dialect), null);
    assert.equal(resolveActiveSqlStatement(sql, sql.length + 1, dialect), null);
    assert.equal(resolveActiveSqlStatement(sql, 1.5, dialect), null);
  });
}

test('MySql hash comments and arithmetic double-minus use MySQL rules', () => {
  const sql = 'select\n# ignored ;\n1;\nselect 2;';
  assert.equal(resolveActiveSqlStatement(sql, sql.indexOf('1;'), 'MySql')?.sql, 'select\n# ignored ;\n1;');
  assert.equal(resolveActiveSqlStatement('select 2--1; select 3;', 8, 'MySql')?.sql, 'select 2--1;');
});

test('SQLite identifier brackets and literal backslashes use SQLite rules', () => {
  const sql = "select [a;b], `c;d`, 'path\\';\nselect 2;";
  assert.equal(resolveActiveSqlStatement(sql, 10, 'Sqlite')?.sql, sql.split('\n')[0]);
});

test('Postgres explicit escape strings and untagged dollar quotes remain intact', () => {
  const sql = String.raw`select E'a\';b'; select 2;`;
  assert.equal(resolveActiveSqlStatement(sql, 13, 'Postgres')?.sql, String.raw`select E'a\';b';`);
  const body = 'DO $$ BEGIN PERFORM 1; END $$; select 2;';
  assert.equal(resolveActiveSqlStatement(body, 24, 'Postgres')?.sql, 'DO $$ BEGIN PERFORM 1; END $$;');
});

test('after the first semicolon the cursor still belongs to the first query', () => {
  const sql = 'select 1;\n\nselect 2;';
  assert.deepEqual(resolveActiveSqlStatement(sql, 9, 'MySql'), {
    sql: 'select 1;', startOffset: 0, endOffset: 9,
  });
});

test('blank separator lines have no active query and EOF belongs to the final query', () => {
  const sql = 'select 1;\n\nselect 2;';
  assert.equal(resolveActiveSqlStatement(sql, 10, 'MySql'), null);
  assert.equal(resolveActiveSqlStatement(sql, sql.length, 'MySql')?.sql, 'select 2;');
});

test('standalone comments and terminators are not executable queries', () => {
  for (const sql of ['  ', '-- note ;', '/* note */', '; ;', '# note ;']) {
    assert.equal(resolveActiveSqlStatement(sql, sql.length, 'MySql'), null);
  }
});

test('Postgres dollar quotes and nested comments do not split the current statement', () => {
  const sql = 'DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$;\nselect 3;';
  assert.equal(resolveActiveSqlStatement(sql, sql.indexOf('PERFORM 2'), 'Postgres')?.sql,
    'DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$;');
  const commented = 'select /* outer /* inner */ ; outer */ 1;\nselect 2;';
  assert.equal(resolveActiveSqlStatement(commented, commented.indexOf('1;'), 'Postgres')?.sql,
    'select /* outer /* inner */ ; outer */ 1;');
});

test('unsupported routines, unfinished quotes, and ambiguous escapes never guess a current query', () => {
  for (const sql of [
    'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$',
    'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END;',
    "select 'unterminated; select 2;",
    "select 'back\\\\slash'; select 2;",
    '/*!40101 SET x = 1 */; select 2;',
  ]) assert.equal(resolveActiveSqlStatement(sql, 4, 'MySql'), null);
});

test('Postgres Unicode dollar tags protect semicolons in function bodies', () => {
  const sql = 'DO $é$ BEGIN PERFORM 1; PERFORM 2; END $é$; select 3;';
  assert.equal(resolveActiveSqlStatement(sql, sql.indexOf('PERFORM 2'), 'Postgres')?.sql,
    'DO $é$ BEGIN PERFORM 1; PERFORM 2; END $é$;');
});

test('MariaDB anonymous blocks and SQLite triggers require complete explicit selection', () => {
  assert.equal(resolveActiveSqlStatement('BEGIN NOT ATOMIC select 1; select 2; END;', 22, 'MySql'), null);
  assert.equal(resolveActiveSqlStatement('CREATE TRIGGER t AFTER INSERT ON a BEGIN select 1; select 2; END;', 45, 'Sqlite'), null);
});
