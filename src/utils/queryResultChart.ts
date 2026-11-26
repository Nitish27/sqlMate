import { uniqueHeaders } from './queryResultCopy';
import { isProtectedResultColumn } from './sensitiveData';

export const MAX_CHART_ROWS = 200;
export type QueryChartKind = 'bar' | 'line';
type Rows = readonly (readonly unknown[])[];

export interface QueryChartSettings {
  kind: QueryChartKind;
  x: number | null;
  y: number;
}

interface ChartAxis {
  index: number;
  label: string;
}

export interface ChartPoint {
  label: string;
  value: number | null;
  text: string | null;
}

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function chartNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.length > 128) return null;
  const text = value.trim();
  if (!numeric.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function labelValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function getChartAxes(columns: readonly string[], rows: Rows, maskOverrides: ReadonlySet<string>) {
  const labels: ChartAxis[] = [];
  const values: ChartAxis[] = [];
  const sample = rows.slice(0, MAX_CHART_ROWS);
  uniqueHeaders(columns).forEach((label, index) => {
    if (isProtectedResultColumn(columns[index], maskOverrides)) return;
    const axis = { index, label };
    if (sample.some(row => labelValue(row[index]))) labels.push(axis);
    if (sample.some(row => chartNumber(row[index]) !== null)) values.push(axis);
  });
  return { labels, values };
}

export function getChartPoints(rows: Rows, x: number | null, y: number): ChartPoint[] {
  return rows.slice(0, MAX_CHART_ROWS).map((row, index) => {
    const labelCell = x === null ? undefined : row[x];
    const label = x === null ? `Row ${index + 1}`
      : labelCell == null ? 'NULL'
      : labelValue(labelCell) ? String(labelCell).slice(0, 120)
      : `Row ${index + 1}`;
    const value = chartNumber(row[y]);
    return { label, value, text: value === null ? null : String(row[y]) };
  });
}

export function makeChartScale(values: readonly number[], kind: QueryChartKind) {
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 0;
  if (kind === 'bar' || min === max) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) max = 1;
  // Normalize before subtracting so extreme, finite values cannot overflow the span.
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const low = min / magnitude;
  const high = max / magnitude;
  return {
    ratio: (value: number) => (value / magnitude - low) / (high - low),
    ticks: [min, ...[0.25, 0.5, 0.75].map(part => (low * (1 - part) + high * part) * magnitude), max],
  };
}

export function lineSegments(points: readonly ChartPoint[]): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < points.length; index++) {
    if (points[index].value !== null) current.push(index);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}
