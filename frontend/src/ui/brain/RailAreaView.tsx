import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { buildRailView, buildRevenuePipelineRows, money } from "../../app/railViews.ts";
import type { World } from "../../app/useWorld.ts";
import type { BrainArea } from "../../brain/types.ts";
import { useMemory } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";
import { CurrentBusiness } from "../current/CurrentBusiness.tsx";
import { SignalFeed } from "../feed/SignalFeed.tsx";
import { OperatingSnapshot } from "../operating/OperatingSnapshot.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { Integrations } from "../integrations/Integrations.tsx";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function detailFor(area: BrainArea, world: World): ReactNode {
  switch (area) {
    case "market": return <SignalFeed world={world} />;
    case "customer": return <CurrentBusiness world={world} />;
    case "capability": return <OperatingSnapshot />;
    case "revenue": return <RevenuePipelineTable world={world} />;
    case "decision": return <MemoryPanel />;
    case "workflow": return <Integrations />;
    case "geographic": return null;
  }
}

function areaProvenance(area: BrainArea): "HubSpot" | "Monitor" | "Demo" {
  if (area === "market") return "Monitor";
  if (area === "capability" || area === "workflow" || area === "decision") return "Demo";
  return "HubSpot";
}

function openRow(companyId: string | undefined, target: "dossier" | "pipeline" | "detail" | undefined): void {
  if (!companyId) return;
  setState({ activeCompanyId: companyId });
  if (target === "pipeline") {
    window.setTimeout(() => document.getElementById("dossier-pipeline")?.scrollIntoView({ block: "start" }), 0);
  }
}

export function RailAreaView({ area, world }: { area: BrainArea; world: World }) {
  const memory = useMemory();
  const [showAll, setShowAll] = useState(false);
  const model = useMemo(() => buildRailView(area, world, memory), [area, memory, world]);
  const topRows = model.rows.slice(0, 5);
  const canExpand = area !== "geographic" && model.total > 0;

  if (showAll) {
    return (
      <div className="rail-detail-view">
        <button className="quiet-expander" onClick={() => setShowAll(false)}>Show top 5</button>
        {detailFor(area, world)}
      </div>
    );
  }

  return (
    <section className="rail-quiet-view" data-rail-component={model.componentId}>
      <div className="quiet-view-head">
        <p className="eyebrow">{model.eyebrow}</p>
        <h1>{model.headline}</h1>
      </div>
      {world.dataSource && !world.loadErrors.length && (
        <div className="live-inline-status">Live: {world.dataSource}</div>
      )}
      {world.dataMode === "hybrid" && (
        <div className="hybrid-inline-status">
          <span>{world.provenanceSources.length} sources</span>
          <strong>{world.provenanceSummary}</strong>
        </div>
      )}
      {world.loadErrors.length > 0 && (
        <div className="live-inline-status error" role="status">{world.loadErrors[0]}</div>
      )}
      <div className="rail-quiet-list">
        {topRows.map((row) => (
          <button
            key={row.id}
            className="rail-quiet-row"
            onClick={() => openRow(row.companyId, row.detailTarget)}
          >
            <span>
              <strong>{row.primary}</strong>
              <em>{row.secondary}</em>
            </span>
            <span>{row.meta}</span>
            {row.badge && <b>{row.badge}</b>}
            {world.dataMode === "hybrid" && <ProvenanceBadge label={areaProvenance(area)} />}
          </button>
        ))}
        {topRows.length === 0 && (
          <div className="rail-quiet-empty">No rows available yet.</div>
        )}
      </div>
      {canExpand && (
        <button className="quiet-expander" onClick={() => setShowAll(true)}>
          {model.viewAllLabel}
        </button>
      )}
    </section>
  );
}

function RevenuePipelineTable({ world }: { world: World }) {
  const rows = buildRevenuePipelineRows(world);
  return (
    <section className="pipeline-table-view">
      <div className="quiet-view-head">
        <p className="eyebrow">Full pipeline</p>
        <h1>{rows.length} open deals in the pipeline table</h1>
      </div>
      <div className="pipeline-table">
        <div className="pipeline-table-head">
          <span>Account</span>
          <span>Stage</span>
          <span>Value</span>
          <span>Score</span>
          <span>Next step</span>
        </div>
        {rows.map((row) => {
          const [stage, value, score] = row.secondary.split(" · ");
          return (
            <button key={row.id} className="pipeline-table-row" onClick={() => openRow(row.companyId, "pipeline")}>
              <strong>{row.primary}</strong>
              <span>{stage ? titleCase(stage) : "Open"}</span>
              <span>{value ?? money(0)}</span>
              <span>{score?.replace("score ", "") ?? "0"}</span>
              <em>{row.meta}</em>
              {world.dataMode === "hybrid" && <ProvenanceBadge label="HubSpot" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
