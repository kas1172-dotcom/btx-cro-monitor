import { Fragment, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { computeChart, formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartResult, ChartSpec, MetricId } from "../../metrics/types.ts";
import { METRICS } from "../../metrics/catalog.ts";
import { openDemoAction, setState } from "../../store/store.ts";

const METRIC_IDS = Object.keys(METRICS) as MetricId[];

function fmt(value: number | null, unit: string): string {
  return formatMetricValue(value, unit);
}

function computeAnnotation(spec: ChartSpec, _world: World, result: ChartResult): string {
  const unit = result.meta.unit;
  const fmtV = (v: number) => formatMetricValue(v, unit);

  if (spec.viz === "heatmap" && result.grid) {
    const grid = result.grid;
    const completeCols = grid.cols.filter((c) => !c.includes("(QTD)"));
    const lastCol = completeCols.at(-1);
    const lastColIdx = lastCol ? grid.cols.indexOf(lastCol) : -1;
    const totals = grid.rows.map((row, ri) => ({
      name: row,
      value: lastColIdx >= 0 ? (grid.values[ri][lastColIdx] ?? 0) : 0,
    }));
    const sorted = [...totals].sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const totalValue = grid.values.flat().filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
    const topShare = totalValue > 0 ? ((top?.value ?? 0) / totalValue) * 100 : 0;

    const firstColIdx = completeCols.length > 1 ? grid.cols.indexOf(completeCols[0]) : -1;
    const firstSum = firstColIdx >= 0 ? grid.values.map((row) => row[firstColIdx] ?? 0).reduce((a, b) => a + b, 0) : 0;
    const lastSum = lastColIdx >= 0 ? grid.values.map((row) => row[lastColIdx] ?? 0).reduce((a, b) => a + b, 0) : 0;
    const trend = lastSum > firstSum ? "growing" : lastSum < firstSum ? "declining" : "flat";

    return [
      top ? `${top.name} is the top account in the latest complete quarter at ${fmtV(top.value)} (${Math.round(topShare)}% of period total).` : "",
      completeCols.length > 1 ? `Portfolio ${result.meta.label.toLowerCase()} is ${trend} — ${fmtV(firstSum)} in ${completeCols[0]} vs ${fmtV(lastSum)} in ${lastCol ?? ""}.` : "",
      topShare > 30 ? `Concentration risk: the top account holds over 30% of revenue, warranting diversification attention.` : `No single account dominates; concentration is within acceptable bounds.`,
    ].filter(Boolean).join(" ");
  }

  if (spec.viz === "trend" && result.series) {
    const points = result.series[0]?.points ?? [];
    if (points.length < 2) return "Insufficient data for trend analysis.";
    const first = points[0];
    const last = points[points.length - 1];
    const direction = last.y > first.y ? "upward" : last.y < first.y ? "downward" : "flat";
    return `${result.meta.label} shows a ${direction} trend from ${fmtV(first.y)} (${first.x}) to ${fmtV(last.y)} (${last.x}) over ${points.length} periods.`;
  }

  if (spec.viz === "ranked_bar" && result.series) {
    const points = result.series[0]?.points ?? [];
    const top3 = points.slice(0, 3).map((p) => p.x).join(", ");
    return `Top accounts by ${result.meta.label.toLowerCase()}: ${top3}. ${points.length} accounts shown, sorted by value.`;
  }

  return `${result.meta.label} analysis across the selected scope and period.`;
}

function Legend({ legend, unit }: { legend: NonNullable<ChartResult["legend"]>; unit: string }) {
  if (legend.min === null && legend.max === null) return null;
  return (
    <div className="analysis-legend">
      <span>{legend.colorEncodes}</span>
      <span className="legend-scale">
        <i className="leg-lo" />
        {formatMetricValue(legend.min, unit)}
        <i className="leg-mid" />
        {legend.midLabel}
        <i className="leg-hi" />
        {formatMetricValue(legend.max, unit)}
      </span>
      {legend.qtdNote && <em>{legend.qtdNote}</em>}
    </div>
  );
}

function Trend({ result }: { result: ChartResult }) {
  const points = result.series?.[0]?.points ?? [];
  const max = Math.max(1, ...points.map((p) => p.y));
  const coords = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * 100},${100 - (p.y / max) * 88}`).join(" ");
  return (
    <div className="analysis-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

interface SelectedCell {
  row: string;
  col: string;
  value: number | null;
  provenance: ChartResult["provenance"];
}

function Grid({ result }: { result: ChartResult }) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const grid = result.grid;
  if (!grid) return null;
  const fullPeriodValues = grid.values.flatMap((row) =>
    row.filter((value, index): value is number => value !== null && !grid.qtdCols.includes(grid.cols[index])),
  );
  const max = Math.max(1, ...(fullPeriodValues.length ? fullPeriodValues : grid.values.flat().filter((v): v is number => v !== null)));
  return (
    <>
      <div className="analysis-grid" style={{ gridTemplateColumns: `180px repeat(${grid.cols.length}, minmax(70px, 1fr))` }}>
        <strong />
        {grid.cols.map((col) => <strong key={col}>{col}</strong>)}
        {grid.rows.map((row, rowIndex) => (
          <Fragment key={`${row}-row`}>
            <span>{row}</span>
            {grid.values[rowIndex].map((value, colIndex) => (
              <button
                key={`${row}-${grid.cols[colIndex]}`}
                className={grid.qtdCols.includes(grid.cols[colIndex]) ? "analysis-cell analysis-cell-qtd" : "analysis-cell"}
                style={value !== null ? { backgroundColor: `rgba(183, 196, 106, ${0.16 + (value / max) * 0.72})` } : {}}
                title={`${row} / ${grid.cols[colIndex]}: ${value !== null ? fmt(value, result.meta.unit) : "—"}`}
                data-provenance={result.provenance.map((p) => p.source).join(", ")}
                onClick={() => setSelectedCell({ row, col: grid.cols[colIndex], value, provenance: result.provenance })}
              >
                {value !== null ? fmt(value, result.meta.unit) : "—"}
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      {selectedCell && (
        <div className="analysis-cell-provenance" role="dialog">
          <strong>{selectedCell.row} · {selectedCell.col}</strong>
          <div>Value: {fmt(selectedCell.value, result.meta.unit)}</div>
          <div className="analysis-cell-sources">
            {selectedCell.provenance.map((p) => (
              <div key={p.source}>{p.source}: {p.reason}</div>
            ))}
          </div>
          <button onClick={() => setSelectedCell(null)}>Close</button>
        </div>
      )}
    </>
  );
}

function RankedBar({ result }: { result: ChartResult }) {
  const points = result.series?.[0]?.points ?? [];
  const max = Math.max(1, ...points.map((p) => p.y));
  return (
    <div className="analysis-bars">
      {points.map((point) => (
        <div key={point.x}>
          <span>{point.x}</span>
          <i style={{ width: `${(point.y / max) * 100}%` }} />
          <strong>{fmt(point.y, result.meta.unit)}</strong>
        </div>
      ))}
    </div>
  );
}

export function AnalysisView({ world, initialSpec }: { world: World; initialSpec: ChartSpec }) {
  const [spec, setSpec] = useState(initialSpec);
  const result = useMemo(() => computeChart(spec, world), [spec, world]);
  const annotation = useMemo(() => computeAnnotation(spec, world, result), [spec, world, result]);
  const definition = METRICS[spec.metric].definition;
  const subtitle = `${definition} (${spec.rows ?? "portfolio"} view, ${spec.cols ?? "monthly"})`;
  const scopeLabel = `All markets · ${spec.timeRange ? `${spec.timeRange.from} – ${spec.timeRange.to}` : "all time"}`;

  return (
    <section className="analysis-view">
      <div className="quiet-view-head">
        <p className="eyebrow">Analysis View</p>
        <h1>{result.meta.label} by {spec.rows ?? "portfolio"}</h1>
      </div>
      <p className="analysis-subtitle">{subtitle}</p>
      <p className="analysis-scope">{scopeLabel}</p>
      {annotation && <div className="analysis-annotation">{annotation}</div>}
      <div className="analysis-controls">
        <select value={spec.metric} onChange={(event) => setSpec({ ...spec, metric: event.target.value as MetricId })}>
          {METRIC_IDS.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
        </select>
        <select value={spec.viz} onChange={(event) => setSpec({ ...spec, viz: event.target.value as ChartSpec["viz"] })}>
          <option value="heatmap">Heatmap</option>
          <option value="trend">Trend</option>
          <option value="ranked_bar">Ranked bar</option>
          <option value="retention_grid">Retention grid</option>
        </select>
        <select value={spec.cols ?? "quarter"} onChange={(event) => setSpec({ ...spec, cols: event.target.value as ChartSpec["cols"] })}>
          <option value="quarter">Quarter</option>
          <option value="month">Month</option>
        </select>
        <button onClick={() => setState({ activeAnalysisSpec: spec })}>Save View</button>
        <button onClick={() => openDemoAction({ title: "Add analysis view to board deck", action: "follow_up", evidence: `${result.meta.label} ${spec.viz}` })}>Add to deck</button>
      </div>
      {spec.viz === "trend" && <Trend result={result} />}
      {spec.viz === "ranked_bar" && <RankedBar result={result} />}
      {(spec.viz === "heatmap" || spec.viz === "retention_grid") && <Grid result={result} />}
      {(spec.viz === "heatmap" || spec.viz === "ranked_bar") && result.legend && (
        <Legend legend={result.legend} unit={result.meta.unit} />
      )}
      <div className="analysis-provenance">
        {result.provenance.map((p) => <span key={p.source}>{p.source}: {p.reason}</span>)}
      </div>
    </section>
  );
}
