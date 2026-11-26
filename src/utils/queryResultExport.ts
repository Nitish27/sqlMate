import { uniqueHeaders } from './queryResultCopy';
import { isSensitiveColumn, shouldMaskColumn } from './sensitiveData';

export type QueryExportFormat = 'csv' | 'json';
export type QueryExportScope = 'loaded' | 'selected';

const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const MASKED = '[MASKED]';
type ResultRows = readonly (readonly unknown[])[];

export interface QueryResultExportSnapshot {
  columns: readonly string[];
  rows: ResultRows;
  selectedRows: ResultRows;
  masked: readonly boolean[];
  maskedColumnCount: number;
  truncated: boolean;
}

export function captureQueryResultExport(
  columns: readonly string[],
  rows: ResultRows,
  selection: readonly number[],
  maskOverrides: ReadonlySet<string>,
  truncated: boolean,
): QueryResultExportSnapshot {
  const selectedRows = [...new Set(selection)]
    .filter(index => Number.isInteger(index) && index >= 0 && index < rows.length)
    .sort((a, b) => a - b)
    .map(index => rows[index]);
  const masked = columns.map(name => isSensitiveColumn(name) || shouldMaskColumn(name, maskOverrides));
  return { columns, rows, selectedRows, masked, maskedColumnCount: masked.filter(Boolean).length, truncated };
}

const serializeJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

function csvField(value: unknown): string {
  if (value == null) return '';
  let text = typeof value === 'object' ? serializeJson(value) : String(value);
  if (typeof value === 'string' && (/^[\t\r\n]/.test(text) || /^[\s\x00-\x1f\x7f]*[=+\-@\uff1d\uff0b\uff0d\uff20]/.test(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeQueryResultExport(
  snapshot: QueryResultExportSnapshot,
  format: QueryExportFormat,
  scope: QueryExportScope,
  maxBytes = MAX_EXPORT_BYTES,
): string {
  const { columns, masked } = snapshot;
  const rows = scope === 'selected' ? snapshot.selectedRows : snapshot.rows;
  if (scope === 'selected' && !rows.length) throw new Error('No rows selected.');
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let remaining = maxBytes;
  const append = (chunk: string) => {
    if (chunk.length > remaining || (remaining -= encoder.encode(chunk).length) < 0) {
      throw new Error('Export is too large. Select fewer rows or run a smaller query before exporting.');
    }
    chunks.push(chunk);
  };
  const valueAt = (row: readonly unknown[], index: number) => masked[index] ? MASKED : row[index] ?? null;
  if (format === 'csv') {
    append(columns.map(csvField).join(',') + '\r\n');
    for (const row of rows) append(columns.map((_, index) => csvField(valueAt(row, index))).join(',') + '\r\n');
  } else {
    const keys = uniqueHeaders(columns);
    append('[');
    rows.forEach((row, index) => append(
      (index === 0 ? '\n  ' : ',\n  ') + serializeJson(Object.fromEntries(keys.map((key, column) => [key, valueAt(row, column)]))),
    ));
    append(rows.length ? '\n]\n' : ']\n');
  }
  return chunks.join('');
}
