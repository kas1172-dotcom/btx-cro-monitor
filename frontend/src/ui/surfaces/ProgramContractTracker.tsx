import { useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { displayLabel } from "../../app/displayLabels.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { qualitativeSignalConfidence } from "../../app/confidence.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import { EmptyState, ProvenanceStrip, ScopePill, SurfaceHeader, UiIcon } from "../primitives.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";

function accountName(world: World, id: string): string {
  return world.companies.find((company) => company.id === id)?.name ?? "Portfolio";
}

function signalOwner(world: World, signal: Signal): string {
  return signal.scope === "specific_account" ? accountName(world, signal.subject_id) : "Market / program";
}

function soWhat(signal: Signal): string {
  const event = signal.event_type;
  if (event.includes("award") || event.includes("contract_win")) {
    return "Award activity may create supplier capacity needs or follow-on account motion.";
  }
  if (event.includes("recompete") || event.includes("contract_loss")) {
    return "Contract movement is worth tracking for timing, displacement, or replacement demand.";
  }
  if (event.includes("demand") || event.includes("capacity")) {
    return "Demand or capacity pressure can open a practical qualification conversation.";
  }
  return "Monitor this program signal for account links, timing, and capacity-fit implications.";
}

export function ProgramContractTracker({ world }: { world: World }) {
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);
  const programSignals = [...world.analysis.valid].sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  return (
    <section className="surface-page" data-surface-component="surface-program-contract-tracker">
      <SurfaceHeader
        eyebrow="Signals"
        headline={`${programSignals.length} signals relevant to BTX capabilities.`}
        subline="Funding, contract, and program news stays market-level until a verified account link is available."
      />
      <div className="program-signal-list">
        {programSignals.map((signal) => {
          const expanded = expandedSignalId === signal.id;
          const owner = signalOwner(world, signal);
          const sourceName = signalSourceName(signal);
          const sourceDate = signalSourceDate(signal);
          const confidence = qualitativeSignalConfidence(signal);
          return (
            <article key={signal.id} className={expanded ? "program-signal-card expanded" : "program-signal-card"}>
              <div className="program-signal-summary">
                <span className="program-event-tag">{displayLabel(signal.event_type)}</span>
                <div className="program-signal-main">
                  <strong>{signalHeadline(signal)}</strong>
                  <p>{soWhat(signal)}</p>
                  <div className="meta-row"><ScopePill scope={signal.scope} /><span>{owner}</span><span>{sourceName}</span><span>{sourceDate}</span></div>
                </div>
                <span className="confidence-chip">{confidence.label}</span>
                <button
                  type="button"
                  className="accent-action"
                  onClick={() => setExpandedSignalId(expanded ? null : signal.id)}
                  aria-expanded={expanded}
                >
                  {expanded ? "Hide" : "Review"}<UiIcon name="chevron" />
                </button>
              </div>
              {expanded && (
                <div className="program-signal-detail">
                  <ProvenanceStrip
                    entity={signal.entities[0] ?? owner}
                    method={signal.relationships?.[0]?.match_method}
                    confidence={signal.relationships?.[0]?.confidence ?? signal.confidence}
                  />
                  <div className="signal-evidence">
                    <span>Evidence</span>
                    <p>{signal.source_quote}</p>
                    <div className="link-row">
                      <ExternalLink href={signal.source_url} label="Open source" />
                      <ExternalLink href={signal.document_url} label="Document" />
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {programSignals.length === 0 && <EmptyState headline="No program signals" body="Contract and program signals will appear after the monitor validates new evidence." icon="signal" />}
      </div>
    </section>
  );
}
