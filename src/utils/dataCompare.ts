import type { SchemaSnapshot, SchemaTable } from './schemaCompare';

export interface ComparisonRows {
  columns: string[];
  column_types: string[];
  primary_key: string[];
  rows: (string | null)[][];
  has_more: boolean;
}

export function comparisonCoverage(source: ComparisonRows, target: ComparisonRows, limit: number): string {
  const counts = `Source: ${source.rows.length}${source.has_more ? '+' : ''}; target: ${target.rows.length}${target.has_more ? '+' : ''}.`;
  if (!source.has_more && !target.has_more) {
    return `All rows returned from both tables. ${counts} Reads across connections are not atomic.`;
  }
  return `Up to ${limit} primary-key-ordered rows per side. ${counts} Partial comparison: a key beyond the other side's sample is not called missing. Reads across connections are not atomic.`;
}

export interface ComparableTable {
  key: string;
  schema: string | null;
  name: string;
  primaryKey: string[];
}

export type RowStatus = 'changed' | 'unchanged' | 'source-only' | 'target-only' | 'not-checked';
export interface ComparedRow {
  key: string;
  label: string;
  status: RowStatus;
  source?: (string | null)[];
  target?: (string | null)[];
  changedColumns: string[];
}

const tableKey = (table: SchemaTable) => JSON.stringify([table.schema ?? '', table.name]);
const typeSupported = (type: string) => !!type && !/(blob|binary|bytea|json|array|geometry|geography|vector|image|xml|bit|\[\]$)/i.test(type);

export function comparableTables(source: SchemaSnapshot, target: SchemaSnapshot): ComparableTable[] {
  if (source.engine !== target.engine) return [];
  const targets = new Map(target.tables.map(table => [tableKey(table), table]));
  return source.tables.flatMap(table => {
    const other = targets.get(tableKey(table));
    if (!other || !table.columns.length || table.columns.length !== other.columns.length) return [];
    const left = new Map(table.columns.map(column => [column.name, column]));
    const right = new Map(other.columns.map(column => [column.name, column]));
    if (left.size !== table.columns.length || right.size !== other.columns.length) return [];
    if ([...left].some(([name, column]) => {
      const peer = right.get(name);
      return !peer || column.data_type.toLowerCase() !== peer.data_type.toLowerCase()
        || column.is_primary_key !== peer.is_primary_key || !typeSupported(column.data_type);
    })) return [];
    const primaryKey = table.columns.filter(column => column.is_primary_key).map(column => column.name).sort();
    return primaryKey.length ? [{ key: tableKey(table), schema: table.schema, name: table.name, primaryKey }] : [];
  }).sort((left, right) => left.key.localeCompare(right.key));
}

export function compareRows(source: ComparisonRows, target: ComparisonRows): { columns: string[]; rows: ComparedRow[] } {
  if (source.columns.length !== target.columns.length
    || source.column_types.length !== source.columns.length
    || target.column_types.length !== target.columns.length
    || new Set(source.columns).size !== source.columns.length
    || new Set(target.columns).size !== target.columns.length
    || source.columns.some(name => !target.columns.includes(name))
    || JSON.stringify(source.primary_key) !== JSON.stringify(target.primary_key)
    || !source.primary_key.length) {
    throw new Error('The table definition changed during comparison. Compare again.');
  }
  const columns = source.columns;
  const reorder = target.columns.map((_, index) => index);
  const targetByName = new Map(target.columns.map((name, index) => [name, index]));
  for (let i = 0; i < columns.length; i++) reorder[i] = targetByName.get(columns[i])!;
  if (columns.some((_, index) => source.column_types[index].toLowerCase() !== target.column_types[reorder[index]].toLowerCase())) {
    throw new Error('A column type changed during comparison. Reload the tables.');
  }
  const positions = source.primary_key.map(name => columns.indexOf(name));
  if (positions.some(index => index < 0)) throw new Error('Primary-key columns are missing from the result.');
  const collect = (sample: ComparisonRows, normalize: (values: (string | null)[]) => (string | null)[]) => {
    const found = new Map<string, { label: string; values: (string | null)[] }>();
    for (const row of sample.rows) {
      const values = normalize(row);
      if (values.length !== columns.length) throw new Error('A comparison row has an unexpected column count.');
      const keyValues = positions.map(index => values[index]);
      if (keyValues.some(value => value === null)) throw new Error('A primary-key value is NULL.');
      const key = JSON.stringify(keyValues);
      if (found.has(key)) throw new Error('Duplicate primary-key values in the sample.');
      found.set(key, { label: keyValues.join(' / '), values });
    }
    return found;
  };
  const left = collect(source, values => values);
  const right = collect(target, values => reorder.map(index => values[index]));
  const rows = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b)).map(key => {
    const sourceRow = left.get(key);
    const targetRow = right.get(key);
    const changedColumns = sourceRow && targetRow
      ? columns.filter((_, index) => sourceRow.values[index] !== targetRow.values[index]) : [];
    const status: RowStatus = sourceRow && targetRow ? changedColumns.length ? 'changed' : 'unchanged'
      : sourceRow ? target.has_more ? 'not-checked' : 'source-only'
        : source.has_more ? 'not-checked' : 'target-only';
    return { key, label: (sourceRow ?? targetRow)!.label, status,
      source: sourceRow?.values, target: targetRow?.values, changedColumns };
  });
  return { columns, rows };
}
