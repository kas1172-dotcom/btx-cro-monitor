import { Fragment, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { computeChart, formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartResult, ChartSpec } from "../../metrics/types.ts";
import { uiTokens } from "../../app/uiTokens.ts";

function fmt(value: number | null, unit: string): string {
  return formatMetricValue(value, unit);
}

export function Legend({ legend, unit }: { legend: NonNullable<ChartResult["legend"]>; unit: string }) {
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

export function Trend({ result }: { result: ChartResult }) {
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

export function Grid({ result, interactive = true }: { result: ChartResult; interactive?: boolean }) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const grid = result.grid;
  if (!grid) return null;
  const fullPeriodValues = grid.values.flatMap((row) =>
    row.filter((value, index): value is number => value !== null && !grid.qtdCols.includes(grid.cols[index])),
  );
  const max = Math.max(1, ...(fullPeriodValues.length ? fullPeriodValues : grid.values.flat().filter((value): value is number => value !== null)));
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
                style={value !== null ? { backgroundColor: `rgba(${uiTokens.rgb.accent}, ${0.16 + (value / max) * 0.72})` } : {}}
                title={`${row} / ${grid.cols[colIndex]}: ${value !== null ? fmt(value, result.meta.unit) : "-"}`}
                data-provenance={result.provenance.map((p) => p.source).join(", ")}
                onClick={() => interactive && setSelectedCell({ row, col: grid.cols[colIndex], value, provenance: result.provenance })}
              >
                {value !== null ? fmt(value, result.meta.unit) : "-"}
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

export function RankedBar({ result }: { result: ChartResult }) {
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

export function AnalysisFigure({ spec, world, interactive = true }: { spec: ChartSpec; world: World; interactive?: boolean }) {
  const result = computeChart(spec, world);
  return (
    <div className="analysis-figure">
      {spec.viz === "trend" && <Trend result={result} />}
      {spec.viz === "ranked_bar" && <RankedBar result={result} />}
      {(spec.viz === "heatmap" || spec.viz === "retention_grid") && <Grid result={result} interactive={interactive} />}
      {(spec.viz === "heatmap" || spec.viz === "ranked_bar") && result.legend && (
        <Legend legend={result.legend} unit={result.meta.unit} />
      )}
    </div>
  );
}
