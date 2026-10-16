export type ParameterValue =
  | { type: 'text'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'float'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' };

export interface QueryParameter {
  name: string;
  value: ParameterValue;
}

export type ParameterInputType = 'auto' | ParameterValue['type'];

export function parseParameterValue(input: string, type: ParameterInputType): ParameterValue {
  if (type === 'null') return { type: 'null' };
  if (type === 'auto') {
    if (/^(?:0|-?[1-9]\d*)$/.test(input) && Number.isSafeInteger(Number(input))) {
      return { type: 'integer', value: Number(input) };
    }
    if (/^(true|false)$/i.test(input)) return { type: 'boolean', value: input.toLowerCase() === 'true' };
    return { type: 'text', value: input };
  }
  if (type === 'text') return { type: 'text', value: input };
  if (type === 'integer') {
    if (!/^-?\d+$/.test(input) || !Number.isSafeInteger(Number(input))) throw new Error('Enter a valid integer');
    return { type, value: Number(input) };
  }
  if (type === 'float') {
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(input) || !Number.isFinite(Number(input))) throw new Error('Enter a valid floating-point number');
    return { type, value: Number(input) };
  }
  if (!/^(true|false)$/i.test(input)) throw new Error('Enter true or false');
  return { type: 'boolean', value: input.toLowerCase() === 'true' };
}

const identifierStart = (char: string) => /[A-Za-z_]/.test(char);
const identifierPart = (char: string) => /[A-Za-z0-9_]/.test(char);

export function findQueryParameters(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let state: 'code' | 'single' | 'double' | 'backtick' | 'line' | 'block' | 'dollar' = 'code';
  let blockDepth = 0;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1] || '';
    if (state === 'line') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (char === '/' && next === '*') { blockDepth++; i++; }
      else if (char === '*' && next === '/') { blockDepth--; i++; if (blockDepth === 0) state = 'code'; }
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; state = 'code'; }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (char === '\\') { i++; continue; }
      if (char === quote) {
        if (next === quote) i++;
        else state = 'code';
      }
      continue;
    }
    if (char === "'") { state = 'single'; continue; }
    if (char === '"') { state = 'double'; continue; }
    if (char === '`') { state = 'backtick'; continue; }
    if ((char === '-' && next === '-') || char === '#') { state = 'line'; if (char === '-') i++; continue; }
    if (char === '/' && next === '*') { state = 'block'; blockDepth = 1; i++; continue; }
    if (char === '$') {
      const tag = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) { dollarTag = tag; state = 'dollar'; i += tag.length - 1; continue; }
    }
    if (char === ':' && sql[i - 1] !== ':' && next !== ':' && identifierStart(next)) {
      let end = i + 2;
      while (end < sql.length && identifierPart(sql[end])) end++;
      const name = sql.slice(i + 1, end);
      if (!seen.has(name)) { names.push(name); seen.add(name); }
      i = end - 1;
    }
  }
  return names;
}
