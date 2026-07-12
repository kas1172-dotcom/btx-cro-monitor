import type { World } from "../../app/useWorld.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { EmptyState, SignalCard, SurfaceHeader } from "../primitives.tsx";

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
      <SurfaceHeader
        eyebrow="Program / contract tracker"
        headline={`${programSignals.length} program, award, and recompete signals relevant to BTX capabilities.`}
        subline="Program and award evidence stays market-level unless a relationship record links it to a canonical account."
      />
      <div className="signal-mini-list">
        {programSignals.map((signal) => (
          <SignalCard
            key={signal.id}
            title={signalHeadline(signal)}
            scope={signal.scope}
            source={`${signal.scope === "specific_account" ? accountName(world, signal.subject_id) : "Market / program"} · ${signalSourceName(signal)}`}
            date={signalSourceDate(signal)}
            body={signal.source_quote}
            provenance={{
              entity: signal.entities[0] ?? (signal.scope === "specific_account" ? accountName(world, signal.subject_id) : "Market / program"),
              method: signal.relationships?.[0]?.match_method,
              confidence: signal.relationships?.[0]?.confidence ?? signal.confidence,
            }}
          />
        ))}
        {programSignals.length === 0 && <EmptyState headline="No program signals" body="Contract and program signals will appear after the monitor validates new evidence." icon="signal" />}
      </div>
    </section>
  );
}
