import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { outputFiles } = await build({
  entryPoints: ['src/utils/queryResultChart.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
});
const { getChartAxes, getChartPoints, makeChartScale, lineSegments, MAX_CHART_ROWS } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);
const chartBundle = await build({
  entryPoints: ['src/components/QueryResultChart.tsx'], bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  plugins: [{
    name: 'node-renderer-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^(react(?:\/.*)?|lucide-react)$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
    },
  }],
});
const { QueryResultChart } = await import(
  `data:text/javascript;base64,${Buffer.from(chartBundle.outputFiles[0].contents).toString('base64')}`
);

test('axis choices never include sensitive or manually masked result columns', () => {
  const axes = getChartAxes(
    ['date', 'total', 'total', 'api_token', 'hidden_alias', 'info'],
    [['Jan', '12.50', 4, 8, 9, { project: 'A' }]],
    new Set(['api_token', 'hidden_alias']),
  );
  assert.deepEqual(axes.labels, [{ index: 0, label: 'date' }, { index: 1, label: 'total' }, { index: 2, label: 'total (2)' }]);
  assert.deepEqual(axes.values, axes.labels.slice(1));
});

test('points use result order, preserve SQL decimal display values, and leave gaps for missing numerics', () => {
  const points = getChartPoints([['B', '-1.50'], ['A', null], ['C', '2e1'], ['D', true], ['E', '0x10'], ['F', '   ']], 0, 1);
  assert.deepEqual(points.map(point => [point.label, point.value, point.text]), [
    ['B', -1.5, '-1.50'], ['A', null, null], ['C', 20, '2e1'],
    ['D', null, null], ['E', null, null], ['F', null, null],
  ]);
  assert.deepEqual(lineSegments(points), [[0], [2]]);
  assert.equal(getChartPoints([[0]], null, 0)[0].label, 'Row 1');
  assert.equal(getChartPoints([[null, 2]], 0, 1)[0].label, 'NULL');
});

test('charts and axis detection are capped to the first loaded rows', () => {
  const rows = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, index) => [index, index === MAX_CHART_ROWS ? 1 : null]);
  assert.equal(getChartPoints(rows, null, 0).length, MAX_CHART_ROWS);
  assert.deepEqual(getChartAxes(['id', 'late'], rows, new Set()).values.map(axis => axis.index), [0]);
});

test('bar scales include zero and keep extreme values and constant lines drawable', () => {
  const positive = makeChartScale([4, 8], 'bar');
  assert.equal(positive.ratio(0), 0);
  assert.equal(positive.ratio(8), 1);
  const extreme = makeChartScale([-Number.MAX_VALUE, Number.MAX_VALUE], 'line');
  assert.equal(extreme.ratio(0), 0.5);
  assert.ok(extreme.ticks.every(Number.isFinite));
  const constant = makeChartScale([0, 0], 'line');
  assert.ok(Number.isFinite(constant.ratio(0)));
});

test('renders both chart views, capped-result notice, and accessible data without protected values', () => {
  const props = {
    columns: ['api_token', 'day', 'total'],
    rows: [['do-not-render', 'Mon', 4], ['another-secret', 'Tue', 8]],
    maskOverrides: new Set(['api_token']),
    truncated: true,
    onChange() {},
  };
  const bars = renderToStaticMarkup(createElement(QueryResultChart, props));
  assert.match(bars, /aria-label="Bar chart of total by day"/);
  assert.match(bars, /<rect/);
  assert.match(bars, /<title>Mon: 4<\/title>/);
  assert.match(bars, /The query result hit its row cap/);
  assert.match(bars, /<summary[^>]*>Chart data<\/summary>/);
  const line = renderToStaticMarkup(createElement(QueryResultChart, {
    ...props, settings: { kind: 'line', x: 0, y: 2 },
  }));
  assert.match(line, /aria-label="Line chart of total by day"/);
  assert.match(line, /<polyline/);
  assert.doesNotMatch(bars + line, /api_token|do-not-render|another-secret/);
});
