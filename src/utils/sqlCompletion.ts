import type { SidebarItem } from '../store/databaseStore';
import { quoteIdentifier, type DatabaseType } from './sqlIdentifiers';

type Token = { value: string; start: number; end: number; kind: 'word' | 'quoted' | 'symbol' };
type TableRef = { name: string; schema?: string };

export type SqlCompletionContext =
  | { kind: 'table'; prefix: string; replaceStart: number; schema?: string }
  | { kind: 'column'; prefix: string; replaceStart: number; qualifier: string; source?: TableRef };

const aliasStops = new Set([
  'AS', 'ON', 'USING', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING',
  'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'OUTER', 'CROSS', 'UNION', 'EXCEPT',
  'INTERSECT', 'FOR', 'RETURNING', 'SET', 'AND', 'OR',
]);

const isName = (token?: Token): token is Token => token?.kind === 'word' || token?.kind === 'quoted';
const isKeyword = (token: Token | undefined, keyword: string) => token?.kind === 'word' && token.value.toUpperCase() === keyword;
const matches = (value: string, prefix: string) => value.toLowerCase().startsWith(prefix.toLowerCase());
const fromEnd = (tokens: Token[], index: number) => tokens[tokens.length - index];

const tokenize = (sql: string, databaseType: DatabaseType) => {
  const tokens: Token[] = [];
  const suppressed: { start: number; end: number }[] = [];
  let index = 0;

  while (index < sql.length) {
    const start = index;
    const char = sql[index];
    const next = sql[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ((char === '-' && next === '-' && (databaseType !== 'MySql' || !sql[index + 2] || /\s/.test(sql[index + 2])))
      || (char === '#' && databaseType === 'MySql')) {
      index += char === '#' ? 1 : 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      suppressed.push({ start, end: index });
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (databaseType === 'Postgres' && sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      suppressed.push({ start, end: index });
      continue;
    }
    if (char === '$' && databaseType === 'Postgres') {
      const delimiter = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (delimiter) {
        const close = sql.indexOf(delimiter, index + delimiter.length);
        index = close < 0 ? sql.length : close + delimiter.length;
        suppressed.push({ start, end: index });
        continue;
      }
    }
    const quoteEnd = char === '[' && databaseType === 'Sqlite' ? ']'
      : char === '`' && databaseType === 'MySql' ? '`'
        : char === '"' && databaseType !== 'MySql' ? '"' : null;
    if (char === '\'' || (char === '"' && databaseType === 'MySql') || quoteEnd) {
      const delimiter = quoteEnd || char;
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === delimiter) {
          if (sql[index + 1] === delimiter && delimiter !== ']') {
            value += delimiter;
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        if (!quoteEnd && sql[index] === '\\' && index + 1 < sql.length) {
          index += 2;
        } else {
          value += sql[index];
          index += 1;
        }
      }
      if (quoteEnd && closed) tokens.push({ value, start, end: index, kind: 'quoted' });
      else suppressed.push({ start, end: index });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      index += 1;
      while (index < sql.length && /[A-Za-z_0-9$]/.test(sql[index])) index += 1;
      tokens.push({ value: sql.slice(start, index), start, end: index, kind: 'word' });
      continue;
    }
    tokens.push({ value: char, start, end: ++index, kind: 'symbol' });
  }

  return { tokens, suppressed };
};

const tableReferences = (tokens: Token[]) => {
  const references = new Map<string, TableRef>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isKeyword(tokens[index], 'FROM') && !isKeyword(tokens[index], 'JOIN')) continue;
    const first = tokens[index + 1];
    if (!isName(first)) continue;
    let table: TableRef = { name: first.value };
    let end = index + 1;
    if (tokens[end + 1]?.value === '.' && isName(tokens[end + 2])) {
      table = { schema: first.value, name: tokens[end + 2].value };
      end += 2;
    }
    references.set(table.name.toLowerCase(), table);
    const aliasIndex = isKeyword(tokens[end + 1], 'AS') ? end + 2 : end + 1;
    const alias = tokens[aliasIndex];
    if (isName(alias) && (alias.kind === 'quoted' || !aliasStops.has(alias.value.toUpperCase()))) {
      references.set(alias.value.toLowerCase(), table);
    }
  }
  return references;
};

export const getSqlCompletionContext = (
  sql: string, cursorOffset: number, databaseType: DatabaseType,
): SqlCompletionContext | null => {
  if (cursorOffset < 0 || cursorOffset > sql.length) return null;
  const { tokens, suppressed } = tokenize(sql, databaseType);
  if (suppressed.some(span => span.start < cursorOffset && cursorOffset <= span.end)) return null;

  const previousSeparator = [...tokens].reverse().find(token => token.value === ';' && token.end <= cursorOffset);
  const nextSeparator = tokens.find(token => token.value === ';' && token.start >= cursorOffset);
  const statement = tokens.filter(token => token.start >= (previousSeparator?.end || 0)
    && token.end <= (nextSeparator?.start ?? sql.length));
  const before = statement.filter(token => token.start < cursorOffset).map(token => token.end > cursorOffset
    ? { ...token, value: sql.slice(token.start, cursorOffset), end: cursorOffset } : token);
  const last = fromEnd(before, 1);
  const hasPrefix = last?.kind === 'word' && last.end === cursorOffset;
  const prefix = hasPrefix ? last.value : '';
  const replaceStart = hasPrefix ? last.start : cursorOffset;
  const prior = before.slice(0, hasPrefix ? -1 : undefined);
  const tail = fromEnd(prior, 1);

  if (isKeyword(tail, 'FROM') || isKeyword(tail, 'JOIN')) {
    return { kind: 'table', prefix, replaceStart, schema: undefined };
  }
  if (tail?.value === '.' && isName(fromEnd(prior, 2))
    && (isKeyword(fromEnd(prior, 3), 'FROM') || isKeyword(fromEnd(prior, 3), 'JOIN'))) {
    return { kind: 'table', prefix, replaceStart, schema: fromEnd(prior, 2)!.value };
  }
  if (tail?.value !== '.' || !isName(fromEnd(prior, 2))) return null;
  const qualifier = fromEnd(prior, 2)!.value;
  return {
    kind: 'column', prefix, replaceStart, qualifier,
    source: tableReferences(statement).get(qualifier.toLowerCase()),
  };
};

export const findCompletionTable = (context: SqlCompletionContext | null, items: SidebarItem[]): SidebarItem | null => {
  if (context?.kind !== 'column') return null;
  const source = context.source || { name: context.qualifier };
  const matches = items.filter(item => (item.item_type === 'Table' || item.item_type === 'View')
    && item.name.toLowerCase() === source.name.toLowerCase()
    && (!source.schema || item.schema?.toLowerCase() === source.schema.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
};

export const getTableSuggestions = (context: SqlCompletionContext | null, items: SidebarItem[], databaseType: DatabaseType) => {
  if (context?.kind !== 'table') return [];
  return items.filter(item => (item.item_type === 'Table' || item.item_type === 'View')
    && (!context.schema || item.schema?.toLowerCase() === context.schema.toLowerCase())
    && matches(item.name, context.prefix))
    .sort((a, b) => `${a.schema || ''}.${a.name}`.localeCompare(`${b.schema || ''}.${b.name}`))
    .slice(0, 100)
    .map(item => ({
      label: item.schema ? `${item.schema}.${item.name}` : item.name,
      filterText: item.name,
      insertText: context.schema || !item.schema ? quoteIdentifier(item.name, databaseType)
        : `${quoteIdentifier(item.schema, databaseType)}.${quoteIdentifier(item.name, databaseType)}`,
      detail: item.item_type,
    }));
};

export const getColumnSuggestions = (prefix: string, columns: string[], databaseType: DatabaseType) =>
  columns.filter(column => matches(column, prefix)).slice(0, 100).map(column => ({
    label: column,
    insertText: quoteIdentifier(column, databaseType),
  }));
