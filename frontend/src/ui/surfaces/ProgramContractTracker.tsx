import type { World } from "../../app/useWorld.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";
import { provenanceForRecord } from "../../app/provenance.ts";

function accountName(world: World, id: string): string {
  return world.companies.find((company) => company.id === id)?.name ?? "Portfolio";
}

export function ProgramContractTracker({ world }: { world: World }) {
  const programSignals = world.analysis.valid
    .filter((signal) =>
      signal.scope === "program" ||
      signal.event_type.includes("contract") ||
      signal.event_type.includes("award") ||
      signal.entities.some((entity) => /\b(f-35|b-21|hypersonic|missile|space|program)\b/i.test(entity))
    )
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  return (
    <section className="surface-page" data-surface-component="surface-program-contract-tracker">
      <div className="quiet-view-head">
        <p className="eyebrow">Program / Contract Tracker</p>
        <h1>{programSignals.length} program, award, and recompete signals relevant to BTX capabilities.</h1>
      </div>
      <div className="signal-mini-list">
        {programSignals.map((signal) => (
          <article key={signal.id}>
            <strong>{signalHeadline(signal)}</strong>
            <span>
              {signal.scope === "specific_account" ? accountName(world, signal.subject_id) : "Market / program"}
              {" · "}{signalSourceName(signal)} {signalSourceDate(signal)}
            </span>
            <em>{signal.source_quote}</em>
            {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(signal)} />}
          </article>
        ))}
        {programSignals.length === 0 && <div className="rail-quiet-empty">No program or contract tracker signals yet.</div>}
      </div>
    </section>
  );
}
