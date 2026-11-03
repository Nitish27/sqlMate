import { isSensitiveColumn } from './sensitiveData';

export interface ColumnProfile {
  name: string;
  nullCount: number;
  distinctCount: number;
  commonValues: { value: string; count: number }[];
  numericRange: { min: number; max: number } | null;
}

function valueKey(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

export function profileSample(columns: string[], rows: unknown[][]): ColumnProfile[] {
  return columns.map((name, index) => {
    const frequencies = new Map<string, { value: unknown; count: number }>();
    let nullCount = 0;
    let min = Infinity;
    let max = -Infinity;
    let numericCount = 0;
    let nonNullCount = 0;
    for (const row of rows) {
      const value = row[index];
      if (value === null || value === undefined) { nullCount++; continue; }
      nonNullCount++;
      const key = valueKey(value);
      const existing = frequencies.get(key);
      if (existing) existing.count++;
      else frequencies.set(key, { value, count: 1 });
      if (typeof value === 'number' && Number.isFinite(value)) {
        numericCount++;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    const sensitive = isSensitiveColumn(name);
    const commonValues = sensitive ? [] : [...frequencies.values()]
      .filter(item => typeof item.value === 'string' || typeof item.value === 'number' || typeof item.value === 'boolean')
      .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
      .slice(0, 3)
      .map(item => ({ value: String(item.value).slice(0, 72), count: item.count }));
    return {
      name, nullCount, distinctCount: frequencies.size, commonValues,
      numericRange: !sensitive && numericCount === nonNullCount && numericCount > 0 ? { min, max } : null,
    };
  });
}

export function sampleCoverage(rowCount: number, hasMore: boolean, limit: number): string {
  return hasMore
    ? `First ${limit} rows returned; more rows exist. This is not a full-table profile or a random sample.`
    : `All ${rowCount} rows returned. No additional rows were found.`;
}
