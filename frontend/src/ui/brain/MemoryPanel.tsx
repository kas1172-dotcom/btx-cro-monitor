import { useEffect, useMemo, useState } from "react";
import type { BrainArea } from "../../brain/types.ts";
import { BRAIN_AREA_LABELS } from "../../brain/types.ts";
import { useMemory } from "../../memory/localMemory.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import { BACKEND_ENDPOINT, listBackendDeliverables } from "../../app/backendApi.ts";

const AREAS: Array<BrainArea | "all"> = ["all", "revenue", "market", "customer", "capability", "geographic", "decision", "workflow"];

function recordToDeliverable(record: { document: Record<string, unknown>; id: string; type: string; title: string }): Deliverable {
  const document = record.document as unknown as Partial<Deliverable>;
  return {
    id: String(document.id ?? record.id),
    type: document.type as Deliverable["type"] ?? record.type as Deliverable["type"],
    title: String(document.title ?? record.title),
    createdAt: String(document.createdAt ?? new Date().toISOString()),
    brainArea: document.brainArea ?? "workflow",
    entityIds: Array.isArray(document.entityIds) ? document.entityIds : [],
    sections: Array.isArray(document.sections) ? document.sections as Deliverable["sections"] : [],
    sources: Array.isArray(document.sources) ? document.sources as Deliverable["sources"] : [],
    confidence: document.confidence ?? "medium",
    confidenceReason: document.confidenceReason,
    audience: document.audience,
    form: document.form,
    compositionPath: document.compositionPath,
    actions: Array.isArray(document.actions) ? document.actions as Deliverable["actions"] : [],
  };
}

export function MemoryPanel() {
  const memory = useMemory();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<BrainArea | "all">("all");
  const [backendDeliverables, setBackendDeliverables] = useState<Deliverable[] | null>(null);
  const [backendStatus, setBackendStatus] = useState(BACKEND_ENDPOINT ? "Loading backend deliverables..." : "Local deliverables.");

  useEffect(() => {
    let alive = true;
    if (!BACKEND_ENDPOINT) return;
    listBackendDeliverables()
      .then((records) => {
        if (!alive) return;
        setBackendDeliverables(records.map(recordToDeliverable));
        setBackendStatus("Loaded backend deliverables.");
      })
      .catch((error) => {
        if (!alive) return;
        setBackendStatus(error instanceof Error ? error.message : "Could not load backend deliverables.");
        setBackendDeliverables(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const deliverables = backendDeliverables ?? memory.deliverables;
  const activityRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memory.activity.filter((entry) => {
      if (area !== "all" && entry.brainArea !== area) return false;
      if (!q) return true;
      return `${entry.title} ${entry.summary} ${entry.entityIds.join(" ")}`.toLowerCase().includes(q);
    });
  }, [area, memory.activity, query]);
  const deliverableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deliverables.filter((deliverable) => {
      if (area !== "all" && deliverable.brainArea !== area) return false;
      if (!q) return true;
      return `${deliverable.title} ${deliverable.type} ${deliverable.entityIds.join(" ")}`.toLowerCase().includes(q);
    });
  }, [area, deliverables, query]);
  const totalRows = activityRows.length + deliverableRows.length;

  return (
    <section className="memory-panel">
      <div className="quiet-view-head">
        <p className="eyebrow">Decision Brain</p>
        <h1>{totalRows} saved decisions, deliverables, and actions</h1>
        <p className="muted">{backendStatus}. Notes and activity remain local until their backend memory model lands.</p>
      </div>
      <div className="memory-controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory..." />
        <select value={area} onChange={(event) => setArea(event.target.value as BrainArea | "all")}>
          {AREAS.map((item) => <option key={item} value={item}>{item === "all" ? "All areas" : BRAIN_AREA_LABELS[item]}</option>)}
        </select>
      </div>
      <div className="memory-list">
        {deliverableRows.length > 0 && <div className="memory-section-label">Deliverables</div>}
        {deliverableRows.slice(0, 20).map((deliverable) => (
          <article key={deliverable.id} className="memory-row memory-deliverable">
            <span>{BRAIN_AREA_LABELS[deliverable.brainArea]}</span>
            <strong>{deliverable.title}</strong>
            <em>{deliverable.type.replace(/_/g, " ")} · {deliverable.sections.length} sections · {deliverable.confidence} confidence</em>
          </article>
        ))}
        {activityRows.length > 0 && <div className="memory-section-label">Activity</div>}
        {activityRows.slice(0, 20).map((entry) => (
          <article key={entry.id} className="memory-row">
            <span>{BRAIN_AREA_LABELS[entry.brainArea]}</span>
            <strong>{entry.title}</strong>
            <em>{entry.summary}</em>
          </article>
        ))}
        {totalRows === 0 && <div className="memory-empty">No saved memory yet.</div>}
      </div>
    </section>
  );
}
