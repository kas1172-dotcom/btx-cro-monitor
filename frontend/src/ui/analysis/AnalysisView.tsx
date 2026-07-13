import { useEffect, useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { computeChart, formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartResult, ChartSpec, MetricId } from "../../metrics/types.ts";
import { METRICS } from "../../metrics/catalog.ts";
import type { Deliverable, DeliverableBlock, DeliverableSection } from "../../deliverables/types.ts";
import { createDeliverableRecord, listDeliverableRecords, patchDeliverableRecord, type BackendDeliverableRecord } from "../../app/deliverablesApi.ts";
import { saveDeliverable, useMemory } from "../../memory/localMemory.ts";
import { AnalysisFigure } from "./ChartFigure.tsx";
import { FigureTypePicker } from "./FigureTypePicker.tsx";

const METRIC_IDS = Object.keys(METRICS) as MetricId[];
const DEFAULT_SPEC: ChartSpec = {
  metric: "revenue",
  viz: "heatmap",
  rows: "account",
  cols: "quarter",
};

type SaveDestination = "new" | "insert";
type ModalStep = "configure" | "save";

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
      completeCols.length > 1 ? `Portfolio ${result.meta.label.toLowerCase()} is ${trend}: ${fmtV(firstSum)} in ${completeCols[0]} vs ${fmtV(lastSum)} in ${lastCol ?? ""}.` : "",
      topShare > 30 ? "Concentration risk: the top account holds over 30% of revenue, warranting diversification attention." : "No single account dominates; concentration is within acceptable bounds.",
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

function figureTitle(spec: ChartSpec): string {
  const metric = METRICS[spec.metric].label;
  const viz = spec.viz.replace(/_/g, " ");
  return `${metric} ${viz}`;
}

function chartBlock(spec: ChartSpec): DeliverableBlock {
  return { kind: "chart-spec", title: figureTitle(spec), spec: spec as unknown as Record<string, unknown> };
}

function standaloneDeliverable(spec: ChartSpec, world: World, result: ChartResult, annotation: string): Deliverable {
  const title = figureTitle(spec);
  const entityIds = spec.filters?.accountId ? [spec.filters.accountId] : [];
  return {
    id: `deliv-${Date.now()}-analysis-view`,
    type: "analysis_view",
    title,
    createdAt: new Date().toISOString(),
    brainArea: "decision",
    entityIds,
    sections: [
      {
        id: "figure",
        heading: title,
        blocks: [
          chartBlock(spec),
          { kind: "text", text: annotation },
        ],
        audience: "internal",
      },
    ],
    sources: result.provenance.length ? result.provenance : [{ source: "analysis dashboard", records: [spec.metric], reason: "Computed from the current operating world." }],
    confidence: world.dataMode === "demo" ? "medium" : "high",
    confidenceReason: "Computed through the metrics catalog and chart specification.",
    audience: "internal",
    form: "view",
    actions: [
      { id: "copy", label: "Copy", kind: "copy" },
      { id: "download", label: "Download Markdown", kind: "download_markdown" },
    ],
  };
}

function insertBlock(
  deliverable: Deliverable,
  sectionId: string,
  block: DeliverableBlock,
): Deliverable {
  const updatedAt = new Date().toISOString();
  const sectionExists = deliverable.sections.some((section) => section.id === sectionId);
  const sections: DeliverableSection[] = sectionExists
    ? deliverable.sections.map((section) => section.id === sectionId ? { ...section, blocks: [...section.blocks, block] } : section)
    : [
        ...deliverable.sections,
        {
          id: `figures-${Date.now()}`,
          heading: "Figures",
          blocks: [block],
          audience: "internal",
        },
      ];
  return {
    ...deliverable,
    sections,
    sources: [
      ...deliverable.sources,
      { source: "analysis figure hub", records: [block.kind === "chart-spec" ? block.title : "figure"], reason: `Inserted chart spec on ${updatedAt}.` },
    ],
  };
}

function localRecords(deliverables: Deliverable[]): Array<BackendDeliverableRecord<Deliverable>> {
  return deliverables.map((deliverable) => ({
    id: deliverable.id,
    type: deliverable.type,
    title: deliverable.title,
    canonical_account_id: deliverable.entityIds[0] ?? null,
    entity_ids: deliverable.entityIds,
    document: deliverable,
    created_at: deliverable.createdAt,
    updated_at: deliverable.createdAt,
  }));
}

export function AnalysisView({ world, initialSpec, openOnMount = false }: { world: World; initialSpec: ChartSpec; openOnMount?: boolean }) {
  const memory = useMemory();
  const [open, setOpen] = useState(openOnMount);
  const [step, setStep] = useState<ModalStep>("configure");
  const [spec, setSpec] = useState<ChartSpec>(initialSpec ?? DEFAULT_SPEC);
  const [destination, setDestination] = useState<SaveDestination>("new");
  const [records, setRecords] = useState<Array<BackendDeliverableRecord<Deliverable>>>(() => localRecords(memory.deliverables));
  const [targetId, setTargetId] = useState("");
  const [targetSectionId, setTargetSectionId] = useState("__new__");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const result = useMemo(() => computeChart(spec, world), [spec, world]);
  const annotation = useMemo(() => computeAnnotation(spec, world, result), [spec, world, result]);
  const definition = METRICS[spec.metric].definition;
  const selectedRecord = records.find((record) => record.id === targetId);
  const selectedAccountId = spec.filters?.accountId ?? "__all__";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listDeliverableRecords()
      .then((response) => {
        if (!cancelled) setRecords(response.records as Array<BackendDeliverableRecord<Deliverable>>);
      })
      .catch(() => {
        if (!cancelled) setRecords(localRecords(memory.deliverables));
      });
    return () => {
      cancelled = true;
    };
  }, [open, memory.deliverables]);

  useEffect(() => {
    if (!targetId && records[0]) setTargetId(records[0].id);
  }, [records, targetId]);

  function updateSpec(next: ChartSpec) {
    setSpec(next);
    setStatus("");
    setError("");
  }

  function resetForNextFigure(message: string) {
    setSpec(DEFAULT_SPEC);
    setStep("configure");
    setDestination("new");
    setTargetSectionId("__new__");
    setStatus(message);
    setError("");
  }

  async function saveStandalone() {
    const deliverable = standaloneDeliverable(spec, world, result, annotation);
    try {
      const record = await createDeliverableRecord(deliverable);
      setRecords((items) => [record as BackendDeliverableRecord<Deliverable>, ...items]);
    } catch {
      saveDeliverable(deliverable);
      setRecords((items) => [localRecords([deliverable])[0], ...items.filter((item) => item.id !== deliverable.id)]);
    }
    resetForNextFigure("Saved as a new analysis view. Ready for the next figure.");
  }

  async function insertIntoDeliverable() {
    if (!selectedRecord) {
      setError("Choose a deliverable first.");
      return;
    }
    const updated = insertBlock(selectedRecord.document, targetSectionId, chartBlock(spec));
    try {
      const record = await patchDeliverableRecord(selectedRecord.id, { document: updated, entity_ids: updated.entityIds });
      setRecords((items) => items.map((item) => item.id === selectedRecord.id ? record as BackendDeliverableRecord<Deliverable> : item));
    } catch {
      saveDeliverable(updated);
      setRecords((items) => items.map((item) => item.id === selectedRecord.id ? localRecords([updated])[0] : item));
    }
    resetForNextFigure(`Inserted figure into ${updated.title}. Ready for the next figure.`);
  }

  async function saveFigure() {
    setError("");
    if (destination === "insert") await insertIntoDeliverable();
    else await saveStandalone();
  }

  return (
    <section className="analysis-view analysis-hub">
      <div className="quiet-view-head">
        <p className="eyebrow">Analysis figures</p>
        <h1>Create a board-ready figure.</h1>
      </div>
      <p className="analysis-subtitle">Choose scope, chart type, metric, and save destination without leaving the dashboard.</p>
      <button className="accent-action-button" type="button" onClick={() => { setOpen(true); setStep("configure"); }}>
        Create figure
      </button>
      {status && <div className="live-inline-status">{status}</div>}

      {open && (
        <div className="demo-action-overlay analysis-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="analysis-modal-title">
          <div className="analysis-modal">
            <header className="analysis-modal-head">
              <div>
                <p className="eyebrow">Figure hub</p>
                <h2 id="analysis-modal-title">{step === "configure" ? "Create figure" : "Save destination"}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close figure hub">×</button>
            </header>
            {status && <div className="live-inline-status">{status}</div>}

            {step === "configure" ? (
              <div className="analysis-modal-grid">
                <section className="analysis-modal-controls">
                  <label>
                    Client scope
                    <select
                      value={selectedAccountId}
                      onChange={(event) => {
                        const accountId = event.target.value;
                        updateSpec({
                          ...spec,
                          filters: accountId === "__all__" ? undefined : { ...(spec.filters ?? {}), accountId },
                        });
                      }}
                    >
                      <option value="__all__">All accounts</option>
                      {world.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                    </select>
                  </label>
                  <FigureTypePicker spec={spec} world={world} onSelect={(viz) => updateSpec({ ...spec, viz })} />
                  <div className="analysis-field-grid">
                    <label>
                      Metric
                      <select value={spec.metric} onChange={(event) => updateSpec({ ...spec, metric: event.target.value as MetricId })}>
                        {METRIC_IDS.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
                      </select>
                    </label>
                    <label>
                      Columns
                      <select value={spec.cols ?? "quarter"} onChange={(event) => updateSpec({ ...spec, cols: event.target.value as ChartSpec["cols"] })}>
                        <option value="quarter">Quarter</option>
                        <option value="month">Month</option>
                      </select>
                    </label>
                    <label>
                      Color
                      <select value={spec.color ?? spec.metric} onChange={(event) => updateSpec({ ...spec, color: event.target.value as MetricId })}>
                        {METRIC_IDS.map((id) => <option key={id} value={id}>{METRICS[id].label}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="muted">{definition}</p>
                </section>
                <section className="analysis-modal-preview" aria-label="Figure preview">
                  <div className="panel-head">
                    <h3>{figureTitle(spec)}</h3>
                    <span>{selectedAccountId === "__all__" ? "All accounts" : world.companies.find((company) => company.id === selectedAccountId)?.name}</span>
                  </div>
                  <AnalysisFigure spec={spec} world={world} />
                  {annotation && <div className="analysis-annotation">{annotation}</div>}
                </section>
                <div className="analysis-modal-actions">
                  <button type="button" onClick={() => setStep("save")}>Done</button>
                </div>
              </div>
            ) : (
              <div className="analysis-save-step">
                <fieldset>
                  <legend>Save destination</legend>
                  <label>
                    <input type="radio" checked={destination === "new"} onChange={() => setDestination("new")} />
                    Save as new view
                  </label>
                  <label>
                    <input type="radio" checked={destination === "insert"} onChange={() => setDestination("insert")} />
                    Insert into...
                  </label>
                </fieldset>

                {destination === "insert" && (
                  <div className="analysis-insert-fields">
                    <label>
                      Deliverable
                      <select value={targetId} onChange={(event) => { setTargetId(event.target.value); setTargetSectionId("__new__"); }} disabled={records.length === 0}>
                        {records.length === 0 && <option value="">No deliverables available</option>}
                        {records.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
                      </select>
                    </label>
                    <label>
                      Section
                      <select value={targetSectionId} onChange={(event) => setTargetSectionId(event.target.value)} disabled={!selectedRecord}>
                        <option value="__new__">Append new Figures section</option>
                        {selectedRecord?.document.sections.map((section) => <option key={section.id} value={section.id}>{section.heading}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                <section className="analysis-save-preview">
                  <strong>{figureTitle(spec)}</strong>
                  <span>{spec.viz.replace(/_/g, " ")} · {METRICS[spec.metric].label}</span>
                </section>
                {error && <div className="live-inline-status error">{error}</div>}
                <div className="analysis-modal-actions">
                  <button type="button" onClick={() => setStep("configure")}>Back</button>
                  <button type="button" onClick={() => void saveFigure()} disabled={destination === "insert" && records.length === 0}>Save</button>
                </div>
              </div>
            )}
            <p className="analysis-followup-note">Follow-up: the dashboard heatmap and Steel & Signal retention heatmap still use separate renderers.</p>
          </div>
        </div>
      )}
    </section>
  );
}
