import { ChartNoAxesColumnIncreasing, ChartNoAxesCombined } from 'lucide-react';
import {
  getChartAxes, getChartPoints, lineSegments, makeChartScale, MAX_CHART_ROWS,
  type ChartPoint, type QueryChartKind, type QueryChartSettings,
} from '../utils/queryResultChart';

interface Props {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  maskOverrides: ReadonlySet<string>;
  settings?: QueryChartSettings;
  truncated: boolean;
  onChange: (settings: QueryChartSettings) => void;
}

const tickLabel = (value: number) => value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1_000_000)
  ? value.toExponential(1)
  : value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
const shortLabel = (label: string) => label.length > 14 ? `${label.slice(0, 11)}...` : label;

function ChartPlot({ points, kind, xLabel, yLabel }: {
  points: ChartPoint[]; kind: QueryChartKind; xLabel: string; yLabel: string;
}) {
  const width = 760, height = 254, left = 72, right = width - 20, top = 18, bottom = height - 36;
  const scale = makeChartScale(points.flatMap(point => point.value === null ? [] : [point.value]), kind);
  const slot = (right - left) / points.length;
  const barWidth = Math.min(40, slot * 0.7);
  const x = (index: number) => left + (index + 0.5) * slot;
  const y = (value: number) => bottom - scale.ratio(value) * (bottom - top);
  const zero = kind === 'bar' ? y(0) : bottom;
  const labelCount = Math.min(6, points.length);
  const labelIndices = Array.from({ length: labelCount }, (_, index) =>
    labelCount === 1 ? 0 : Math.round(index * (points.length - 1) / (labelCount - 1)));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${kind === 'bar' ? 'Bar' : 'Line'} chart of ${yLabel} by ${xLabel}`} className="block w-full min-w-[440px]">
      {scale.ticks.map((value, index) => {
        const position = bottom - index * (bottom - top) / (scale.ticks.length - 1);
        return <g key={index}>
          <line x1={left} x2={right} y1={position} y2={position} className="stroke-border" />
          <text x={left - 9} y={position} textAnchor="end" dominantBaseline="middle" fontSize="11" className="fill-text-secondary">{tickLabel(value)}</text>
        </g>;
      })}
      <line x1={left} x2={left} y1={top} y2={bottom} className="stroke-border-strong" />
      <line x1={left} x2={right} y1={zero} y2={zero} className="stroke-border-strong" />
      {kind === 'line' && lineSegments(points).map(segment => segment.length > 1 && (
        <polyline key={segment[0]} points={segment.map(index => `${x(index)},${y(points[index].value!)}`).join(' ')}
          fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {points.map((point, index) => {
        if (point.value === null) return null;
        const position = y(point.value);
        const tooltip = <title>{`${point.label}: ${point.text}`}</title>;
        return kind === 'bar'
          ? <rect key={index} x={x(index) - barWidth / 2} y={Math.min(position, zero)}
              width={barWidth} height={Math.max(1, Math.abs(zero - position))} rx="1.5" className="fill-accent">{tooltip}</rect>
          : <circle key={index} cx={x(index)} cy={position} r={points.length > 80 ? 2 : 3} className="fill-accent">{tooltip}</circle>;
      })}
      {labelIndices.map(index => (
        <text key={index} x={x(index)} y={bottom + 19}
          textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
          fontSize="11" className="fill-text-secondary">
          {shortLabel(points[index].label)}
        </text>
      ))}
    </svg>
  );
}

export function QueryResultChart({ columns, rows, maskOverrides, settings, truncated, onChange }: Props) {
  const axes = getChartAxes(columns, rows, maskOverrides);
  const firstValue = axes.values[0];
  if (!firstValue) {
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-5 text-center text-text-muted">
        <ChartNoAxesColumnIncreasing size={23} className="text-accent" aria-hidden="true" />
        <p className="text-sm text-text-secondary">{rows.length ? 'No numeric columns to chart' : 'No rows to chart'}</p>
        <p className="max-w-sm text-xs">{rows.length
          ? `The first ${Math.min(rows.length, MAX_CHART_ROWS).toLocaleString()} loaded rows need an unmasked numeric column.`
          : 'Run a query that returns rows and at least one numeric column.'}</p>
      </div>
    );
  }

  const kind = settings?.kind ?? 'bar';
  const y = axes.values.find(axis => axis.index === settings?.y) ?? firstValue;
  const suggestedLabel = axes.labels.find(axis => !axes.values.some(value => value.index === axis.index));
  const label = settings?.x === null ? undefined
    : axes.labels.find(axis => axis.index === settings?.x) ?? suggestedLabel;
  const x = label?.index ?? null;
  const xLabel = label?.label ?? 'Row number';
  const points = getChartPoints(rows, x, y.index);
  const plotted = points.filter(point => point.value !== null).length;
  const selectStyle = 'h-8 max-w-full rounded-md border border-border-strong bg-background px-2 font-normal text-text-primary';

  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-surface px-4 py-2.5">
        <div role="group" aria-label="Chart type" className="flex h-8 items-center rounded-md border border-border-strong bg-background p-0.5">
          {(['bar', 'line'] as const).map(option => {
            const Icon = option === 'bar' ? ChartNoAxesColumnIncreasing : ChartNoAxesCombined;
            return <button key={option} type="button" aria-pressed={option === kind}
              onClick={() => onChange({ kind: option, x, y: y.index })}
              className={`flex h-full items-center gap-1.5 rounded px-2.5 text-xs font-medium ${option === kind ? 'bg-accent text-accent-contrast' : 'text-text-secondary hover:bg-hover'}`}>
              <Icon size={13} aria-hidden="true" />{option === 'bar' ? 'Bar' : 'Line'}
            </button>;
          })}
        </div>
        <label className="flex min-w-0 max-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
          X label
          <select value={x ?? ''} onChange={event => onChange({ kind, x: event.target.value === '' ? null : Number(event.target.value), y: y.index })} className={selectStyle}>
            <option value="">Row number</option>
            {axes.labels.map(axis => <option key={axis.index} value={axis.index}>{axis.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 max-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
          Y value
          <select value={y.index} onChange={event => onChange({ kind, x, y: Number(event.target.value) })} className={selectStyle}>
            {axes.values.map(axis => <option key={axis.index} value={axis.index}>{axis.label}</option>)}
          </select>
        </label>
      </div>
      <figure className="px-4 py-3">
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <ChartPlot points={points} kind={kind} xLabel={xLabel} yLabel={y.label} />
        </div>
        <figcaption className="mt-2 text-xs text-text-secondary">
          Plotted {plotted.toLocaleString()} of the {points.length < rows.length ? 'first ' : ''}{points.length.toLocaleString()} loaded rows.
          {plotted !== points.length && ' Rows with NULL or nonnumeric values are not plotted.'}
          {truncated && ' The query result hit its row cap.'}
          {' '}Points follow result order. Use <code>ORDER BY</code> to control it.
        </figcaption>
        <details className="mt-2 text-xs text-text-secondary">
          <summary className="cursor-pointer rounded py-1 hover:text-text-primary">Chart data</summary>
          <table className="mt-1 w-full table-fixed border-collapse text-left">
            <thead className="bg-surface text-text-primary"><tr><th scope="col" className="break-all px-2 py-1">{xLabel}</th><th scope="col" className="break-all px-2 py-1">{y.label}</th></tr></thead>
            <tbody className="divide-y divide-border">{points.map((point, index) =>
              <tr key={index}><th scope="row" className="break-all px-2 py-1 font-normal">{point.label}</th><td className="break-all px-2 py-1 font-mono">{point.text ?? 'Not plotted'}</td></tr>)}</tbody>
          </table>
        </details>
      </figure>
    </div>
  );
}
