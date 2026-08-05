import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { recordToDeliverable, saveStoredDeliverable } from "../../app/deliverablesApi.ts";
import { computeChart, formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartResult, ChartSpec, MetricId } from "../../metrics/types.ts";
import { METRICS } from "../../metrics/catalog.ts";
import { runAgent } from "../../agents/runAgent.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { openDemoAction } from "../../store/store.ts";
import { deliverablePath, navigateTo } from "../../app/router.ts";
import { AnalysisFigure } from "./ChartFigure.tsx";
import { FigureTypePicker } from "./FigureTypePicker.tsx";
import { humanSourceLabel, humanSourceReason } from "../../app/sourceLabels.ts";
import { userFacingError } from "../../app/userFacingError.ts";

const METRIC_IDS = Object.keys(METRICS) as MetricId[];

function computeAnnotation(spec: ChartSpec, result: ChartResult): string {
  if (result.state !== "available") {
    return `${result.meta.label} is ${result.state}. ${result.reason} No trend, concentration, demand, risk, margin, pipeline, or capacity conclusion was generated.`;
  }
  const unit = result.meta.unit;
  const fmtV = (value: number) => formatMetricValue(value, unit);

  if (spec.viz === "heatmap" && result.grid) {
    const grid = result.grid;
    if (grid.values.some((row) => row.some((value) => value === null))) {
      return `${result.meta.label} is only partially available. Missing cells are not treated as zero, so portfolio totals, trends, and concentration conclusions are suppressed.`;
    }
    const completeCols = grid.cols.filter((col) => !col.includes("(QTD)"));
    const lastCol = completeCols.at(-1);
    const lastColIndex = lastCol ? grid.cols.indexOf(lastCol) : -1;
    const totals = grid.rows.map((row, rowIndex) => ({
      name: row,
      value: lastColIndex >= 0 ? grid.values[rowIndex][lastColIndex] : null,
    }));
    const sorted = totals.filter((row): row is { name: string; value: number } => row.value !== null).sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const totalValue = grid.values.flat().filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0);
    const topShare = totalValue > 0 ? ((top?.value ?? 0) / totalValue) * 100 : 0;

    const firstColIndex = completeCols.length > 1 ? grid.cols.indexOf(completeCols[0]) : -1;
    const firstSum = firstColIndex >= 0 ? grid.values.map((row) => row[firstColIndex] as number).reduce((sum, value) => sum + value, 0) : 0;
    const lastSum = lastColIndex >= 0 ? grid.values.map((row) => row[lastColIndex] as number).reduce((sum, value) => sum + value, 0) : 0;
    const trend = lastSum > firstSum ? "growing" : lastSum < firstSum ? "declining" : "flat";

    return [
      top ? `${top.name} is the top account in the latest complete quarter at ${fmtV(top.value)} (${Math.round(topShare)}% of period total).` : "",
      completeCols.length > 1 ? `Portfolio ${result.meta.label.toLowerCase()} is ${trend}: ${fmtV(firstSum)} in ${completeCols[0]} vs ${fmtV(lastSum)} in ${lastCol ?? ""}.` : "",
      "Concentration assessment unavailable until an approved threshold is configured.",
    ].filter(Boolean).join(" ");
  }

  if (spec.viz === "trend" && result.series) {
    const points = result.series[0]?.points ?? [];
    if (points.length < 2) return "Insufficient data for trend analysis.";
    const first = points[0];
    const last = points[points.length - 1];
    const direction = last.y > first.y ? "upward" : last.y < first.y ? "downward" : "flat";
    const article = direction === "upward" ? "an" : "a";
    return `${result.meta.label} shows ${article} ${direction} trend from ${fmtV(first.y)} (${first.x}) to ${fmtV(last.y)} (${last.x}) over ${points.length} periods.`;
  }

  if (spec.viz === "ranked_bar" && result.series) {
    const points = result.series[0]?.points ?? [];
    const top3 = points.slice(0, 3).map((point) => point.x).join(", ");
    return `Top accounts by ${result.meta.label.toLowerCase()}: ${top3}. ${points.length} accounts shown, sorted by value.`;
  }

  return `${result.meta.label} analysis across the selected scope and period.`;
}

function quarterFromSpec(spec: ChartSpec): string {
  const to = spec.timeRange?.to ?? "2026-06";
  const [year, monthText] = to.split("-");
  const quarter = Math.floor((Number(monthText || "6") - 1) / 3) + 1;
  return `Q${quarter} ${year || "2026"}`;
}

async function saveAnalysisFigure(deliverable: Deliverable): Promise<Deliverable> {
  const local = saveDeliverable(deliverable);
  try {
    const record = await saveStoredDeliverable(local);
    const persisted = recordToDeliverable(record);
    saveDeliverable(persisted);
    return persisted;
  } catch {
    return local;
  }
}

export function AnalysisView({ world, initialSpec, onCancel, onSpecChange }: { world: World; initialSpec: ChartSpec; onCancel?: () => void; onSpecChange?: (spec: ChartSpec) => void }) {
  const [spec, setSpec] = useState(initialSpec);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const result = useMemo(() => computeChart(spec, world), [spec, world]);
  const annotation = useMemo(() => computeAnnotation(spec, result), [spec, result]);
  const definition = METRICS[spec.metric].definition;
  const subtitle = `${definition} (${spec.rows ?? "portfolio"} view, ${spec.cols ?? "monthly"})`;
  const scopeLabel = `All markets · ${spec.timeRange ? `${spec.timeRange.from} to ${spec.timeRange.to}` : "all time"}`;

  async function saveFigure() {
    if (result.state !== "available") {
      setSaveStatus(`Generation blocked: ${result.meta.label} is ${result.state}. ${result.reason}`);
      return;
    }
    setSaving(true);
    setSaveStatus("Saving figure...");
    try {
      const generated = await runAgent("analysis_annotation", {
        metric: spec.metric,
        quarter: quarterFromSpec(spec),
        instructions: `${result.meta.label} ${spec.viz} figure. ${annotation}`,
      }, world);
      const withFigure: Deliverable = {
        ...generated,
        title: `${result.meta.label} ${spec.viz.replace(/_/g, " ")} figure`,
        sections: [
          {
            id: "figure",
            heading: "Saved Figure",
            blocks: [
              { kind: "chart-spec", title: `${result.meta.label} ${spec.viz.replace(/_/g, " ")}`, spec: { ...spec } as Record<string, unknown> },
            ],
          },
          ...generated.sections,
        ],
      };
      const saved = await saveAnalysisFigure(withFigure);
      setSaveStatus("Saved figure.");
      navigateTo(deliverablePath(saved.backendRecordId ?? saved.id), { replace: true });
    } catch (error) {
      setSaveStatus(userFacingError(error, "The figure could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="analysis-view">
      <div className="quiet-view-head">
        <p className="eyebrow">Analysis Figure Hub</p>
        <h1>{result.meta.label} by {spec.rows ?? "portfolio"}</h1>
        {onCancel && <button type="button" onClick={onCancel} aria-label="Cancel figure insertion">Back / Cancel</button>}
      </div>
      <p className="analysis-subtitle">{subtitle}</p>
      <p className="analysis-scope">{scopeLabel}</p>

      <div className="analysis-workspace">
        <aside className="analysis-control-panel surface-panel">
          <div className="panel-head">
            <h2>Figure setup</h2>
            <span>{result.meta.unit}</span>
          </div>
          <label>
            Metric
            <select value={spec.metric} onChange={(event) => {
              const next = { ...spec, metric: event.target.value as MetricId };
              setSpec(next);
              onSpecChange?.(next);
            }}>
              {METRIC_IDS.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
            </select>
          </label>
          <label>
            Period
            <select value={spec.cols ?? "quarter"} onChange={(event) => {
              const next = { ...spec, cols: event.target.value as ChartSpec["cols"] };
              setSpec(next);
              onSpecChange?.(next);
            }}>
              <option value="quarter">Quarter</option>
              <option value="month">Month</option>
            </select>
          </label>
          <FigureTypePicker spec={spec} world={world} onSelect={(viz) => {
            const next = { ...spec, viz };
            setSpec(next);
            onSpecChange?.(next);
          }} />
          <div className="analysis-control-actions">
            <button onClick={() => void saveFigure()} disabled={saving || result.state !== "available"}>{saving ? "Saving..." : "Save figure deliverable"}</button>
            <button onClick={() => openDemoAction({ title: "Add analysis view to board deck", action: "follow_up", evidence: `${result.meta.label} ${spec.viz}` })}>Add to deck</button>
          </div>
          {saveStatus && <div className={saveStatus.startsWith("Saved") || saveStatus.startsWith("Saving") ? "live-inline-status" : "live-inline-status error"}>{saveStatus}</div>}
        </aside>

        <div className="analysis-figure-stage surface-panel">
          <div className="panel-head">
            <h2>{result.meta.label} figure</h2>
            <span>{spec.viz.replace(/_/g, " ")}</span>
          </div>
          <AnalysisFigure spec={spec} world={world} />
          <div className="analysis-annotation">{annotation}</div>
          <div className="analysis-provenance">
            {result.provenance.map((provenance) => <span key={provenance.source}>{humanSourceLabel(provenance.source)}: {humanSourceReason(provenance.reason)}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}
