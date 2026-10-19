import { hasSensitiveColumns } from './sensitiveData';

export type ResultCopyFormat = 'plain' | 'csv' | 'csv-with-headers' | 'json' | 'markdown';

export function rowsForCopy(data: unknown[][], clickedIndex: number, selectedIndices: number[]): unknown[][] {
  if (!data[clickedIndex]) return [];
  if (selectedIndices.length < 2 || !selectedIndices.includes(clickedIndex)) return [data[clickedIndex]];
  return [...new Set(selectedIndices)]
    .sort((a, b) => a - b)
    .map(index => data[index])
    .filter((row): row is unknown[] => Array.isArray(row));
}

const displayValue = (value: unknown): string => value == null ? 'NULL' : String(value);

const csvValue = (value: unknown): string => {
  if (value == null) return 'NULL';
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
  return String(value);
};

const markdownValue = (value: unknown): string => displayValue(value)
  .replace(/\\/g, '\\\\')
  .replace(/\|/g, '\\|')
  .replace(/\r?\n/g, '<br>');

const uniqueHeaders = (columns: string[]): string[] => {
  const used = new Set<string>();
  return columns.map((name) => {
    let candidate = name;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${name} (${suffix++})`;
    used.add(candidate);
    return candidate;
  });
};

export function serializeResultRows(columns: string[], rows: unknown[][], format: ResultCopyFormat): string {
  if (rows.length === 0) return '';
  if (format === 'json') {
    const headers = uniqueHeaders(columns);
    return JSON.stringify(rows.map(row => Object.fromEntries(headers.map((name, index) =>
      [name, row[index] === undefined ? null : row[index]]))),
    (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  }
  if (format === 'markdown') {
    return [
      `| ${columns.map(markdownValue).join(' | ')} |`,
      `| ${columns.map(() => '---').join(' | ')} |`,
      ...rows.map(row => `| ${columns.map((_, index) => markdownValue(row[index])).join(' | ')} |`),
    ].join('\n');
  }
  if (format === 'plain') {
    return rows.map(row => columns.map((_, index) => displayValue(row[index])
      .replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')).join('\t')).join('\n');
  }
  const lines = rows.map(row => columns.map((_, index) => csvValue(row[index])).join(','));
  if (format === 'csv-with-headers') lines.unshift(columns.map(name =>
    /[",\r\n]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name).join(','));
  return lines.join('\n');
}

export function needsRawCopyConfirmation(columns: string[], maskedColumns: string[]): boolean {
  return hasSensitiveColumns(columns) || maskedColumns.length > 0;
}
