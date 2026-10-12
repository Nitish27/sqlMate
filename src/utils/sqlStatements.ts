import type { DatabaseType } from './sqlIdentifiers';

export interface ActiveSqlStatement {
  sql: string;
  startOffset: number;
  endOffset: number;
}

export interface SqlStatementScan {
  statements: ActiveSqlStatement[];
  reason?: string;
}

export const scanSqlStatements = (sql: string, databaseType: DatabaseType): SqlStatementScan => {
  const statements: ActiveSqlStatement[] = [];
  let statementStart = 0;
  let hasCode = false;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let escapeString = false;
  let lineComment = false;
  let blockDepth = 0;
  let dollarQuote: string | null = null;
  let words: string[] = [];

  const unsupported = (reason: string): SqlStatementScan => ({ statements: [], reason });
  const finishStatement = (end: number) => {
    const raw = sql.slice(statementStart, end);
    const statement = raw.trim();
    if (hasCode && statement) {
      const startOffset = statementStart + raw.indexOf(statement);
      statements.push({ sql: statement, startOffset, endOffset: startOffset + statement.length });
    }
    statementStart = end;
    hasCode = false;
    words = [];
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (databaseType === 'Postgres' && character === '/' && nextCharacter === '*') {
        blockDepth += 1;
        index += 1;
      } else if (character === '*' && nextCharacter === '/') {
        blockDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\' && quote !== ']' && quote !== '`') {
        if (escapeString) {
          index += 1;
          continue;
        }
        if (databaseType !== 'Sqlite') {
          return unsupported('Backslash escaping depends on session settings. Select the complete SQL explicitly.');
        }
      }
      if (character === quote) {
        if (nextCharacter === quote && quote !== ']') index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === '-' && nextCharacter === '-' &&
      (databaseType !== 'MySql' || !sql[index + 2] || /\s/.test(sql[index + 2]))) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '#' && databaseType === 'MySql') {
      lineComment = true;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      if (databaseType === 'MySql' && (sql[index + 2] === '!' || sql.slice(index + 2, index + 4) === 'M!')) {
        return unsupported('Executable MySQL comments require explicit SQL selection.');
      }
      blockDepth = 1;
      index += 1;
      continue;
    }
    if (databaseType === 'Postgres' && character === '$' && !/[\w$\u0080-\uFFFF]/.test(sql[index - 1] || '')) {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9\u0080-\uFFFF]*)?\$/)?.[0];
      if (delimiter) {
        dollarQuote = delimiter;
        hasCode = true;
        index += delimiter.length - 1;
        continue;
      }
    }
    if (character === "'" || character === '"' ||
      (character === '`' && databaseType !== 'Postgres') ||
      (character === '[' && databaseType === 'Sqlite')) {
      hasCode = true;
      quote = character === '[' ? ']' : character;
      escapeString = databaseType === 'Postgres' && character === "'" &&
        /[eE]/.test(sql[index - 1] || '') && !/[\w$]/.test(sql[index - 2] || '');
      continue;
    }
    if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
      const word = sql.slice(index).match(/^[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9$\u0080-\uFFFF]*/)?.[0] || character;
      words.push(word.toUpperCase());
      hasCode = true;
      index += word.length - 1;
      if (databaseType === 'MySql' && words[0] === 'DELIMITER') {
        return unsupported('DELIMITER is a client directive, not executable SQL. Select SQL without the directive.');
      }
      if (databaseType === 'MySql' && words.slice(-3).join(' ') === 'BEGIN NOT ATOMIC') {
        return unsupported('Anonymous block boundaries need explicit selection of the complete statement.');
      }
      if (words[0] === 'CREATE' && (
        (databaseType === 'MySql' && /^(PROCEDURE|FUNCTION|TRIGGER|EVENT)$/.test(word.toUpperCase())) ||
        (databaseType === 'Sqlite' && word.toUpperCase() === 'TRIGGER')
      )) {
        return unsupported('Routine boundaries need explicit selection of the complete statement.');
      }
      if (databaseType === 'Postgres' && words.slice(-2).join(' ') === 'BEGIN ATOMIC') {
        return unsupported('BEGIN ATOMIC bodies need explicit selection of the complete statement.');
      }
      continue;
    }
    if (character === ';') finishStatement(index + 1);
    else if (!/\s/.test(character)) hasCode = true;
  }
  if (quote || blockDepth || dollarQuote) {
    return unsupported('SQL has an unfinished quote or comment. Complete it before running Current.');
  }
  finishStatement(sql.length);
  return { statements };
};

export const resolveActiveSqlStatement = (
  sql: string,
  cursorOffset: number,
  databaseType: DatabaseType,
): ActiveSqlStatement | null => {
  if (!Number.isInteger(cursorOffset) || cursorOffset < 0 || cursorOffset > sql.length) return null;
  const { statements } = scanSqlStatements(sql, databaseType);
  // The caret immediately after a terminator still owns the preceding statement.
  const current = statements.find(({ startOffset, endOffset }) => cursorOffset >= startOffset && cursorOffset <= endOffset);
  if (current) return current;
  const previous = [...statements].reverse().find(({ endOffset }) => endOffset < cursorOffset);
  if (previous && /^[^\S\r\n]*$/.test(sql.slice(previous.endOffset, cursorOffset))) return previous;
  const next = statements.find(({ startOffset }) => startOffset > cursorOffset);
  if (next && /^[^\S\r\n]*$/.test(sql.slice(cursorOffset, next.startOffset))) return next;
  return null;
};
