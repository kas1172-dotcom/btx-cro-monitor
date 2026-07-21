import type { World } from "../../app/useWorld.ts";
import { computeChart } from "../../metrics/chartSpec.ts";
import type { ChartSpec } from "../../metrics/types.ts";

const FIGURE_TYPES: Array<{ id: ChartSpec["viz"]; label: string; description: string }> = [
  { id: "heatmap", label: "Heatmap", description: "Account by period intensity." },
  { id: "trend", label: "Trend", description: "Time-series line view." },
  { id: "ranked_bar", label: "Ranked bar", description: "Sorted account comparison." },
  { id: "retention_grid", label: "Retention grid", description: "Repeat-revenue grid view." },
];

function Preview({ spec, world }: { spec: ChartSpec; world: World }) {
  const result = computeChart(spec, world);
  if (spec.viz === "trend") {
    const points = result.series?.[0]?.points.slice(0, 8) ?? [];
    const max = Math.max(1, ...points.map((point) => point.y));
    const coords = points.map((point, index) => `${10 + (index / Math.max(1, points.length - 1)) * 80},${88 - (point.y / max) * 64}`).join(" ");
    return (
      <svg viewBox="0 0 100 100" className="figure-picker-preview" aria-hidden="true">
        <path d="M10 88H90M10 18V88" />
        <polyline points={coords} />
      </svg>
    );
  }
  if (spec.viz === "ranked_bar") {
    const points = result.series?.[0]?.points.slice(0, 5) ?? [];
    const max = Math.max(1, ...points.map((point) => point.y));
    return (
      <svg viewBox="0 0 100 100" className="figure-picker-preview" aria-hidden="true">
        {points.map((point, index) => (
          <rect key={point.x} x="14" y={14 + index * 15} width={(point.y / max) * 72} height="8" rx="2" />
        ))}
      </svg>
    );
  }
  const grid = result.grid;
  const values = grid?.values.slice(0, 4).map((row) => row.slice(0, 4)) ?? [];
  const max = Math.max(1, ...values.flat().filter((value): value is number => value !== null));
  return (
    <svg viewBox="0 0 100 100" className="figure-picker-preview" aria-hidden="true">
      {values.flatMap((row, rowIndex) => row.map((value, colIndex) => (
        <rect
          key={`${rowIndex}-${colIndex}`}
          x={12 + colIndex * 19}
          y={14 + rowIndex * 17}
          width="14"
          height="12"
          rx="2"
          opacity={value === null ? 0.18 : 0.25 + (value / max) * 0.65}
        />
      )))}
    </svg>
  );
}

export function FigureTypePicker({
  spec,
  world,
  onSelect,
}: {
  spec: ChartSpec;
  world: World;
  onSelect(viz: ChartSpec["viz"]): void;
}) {
  return (
    <div className="figure-type-picker" role="radiogroup" aria-label="Figure type">
      {FIGURE_TYPES.map((type) => {
        const candidate = { ...spec, viz: type.id };
        return (
          <button
            key={type.id}
            type="button"
            role="radio"
            aria-checked={spec.viz === type.id}
            className={spec.viz === type.id ? "figure-type-card selected" : "figure-type-card"}
            onClick={() => onSelect(type.id)}
          >
            <Preview spec={candidate} world={world} />
            <strong>{type.label}</strong>
            <span>{type.description}</span>
          </button>
        );
      })}
    </div>
  );
}
