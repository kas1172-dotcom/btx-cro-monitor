import { type ReactNode } from "react";
import type { World } from "../../app/useWorld.ts";
import { setState, requestTour } from "../../store/store.ts";
import { processBrainQuestion } from "../../brain/brainEngine.ts";
import { saveBrainMemoryNote, useMemory } from "../../memory/localMemory.ts";
import { signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import sampleLibraryData from "../../../data/demo/btx/sample_library.json";
import type { Deliverable } from "../../deliverables/types.ts";
import type { ChartSpec } from "../../metrics/types.ts";

const SAMPLE_LIBRARY = sampleLibraryData as Deliverable[];

function money(value?: number): string | null {
  if (value === undefined) return null;
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1_000)}k`;
}

function conciseQuote(text?: string): string {
  if (!text) return "No validated signal";
  return text.replace(/\s+/g, " ").replace(/\.$/, "").slice(0, 92);
}

export function BrainHome({ world, askBar }: { world: World; askBar?: ReactNode }) {
  const memory = useMemory();
  const topSignal = [...world.analysis.valid].sort((a, b) => b.confidence - a.confidence)[0];
  const topOpportunity = world.prospects[0];
  const topRisk = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score)[0];
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const topSignalCompany = topSignal ? nameOf(topSignal.subject_id) : "None";
  const topSignalValue = money(topSignal?.value);
  const topSignalLabel = topSignal
    ? `${topSignalCompany} ${topSignal.event_type === "contract_win" ? "books" : topSignal.event_type === "government_contract_award" ? "wins" : "signals"} ${topSignalValue ?? conciseQuote(topSignal.source_quote)} · ${signalSourceName(topSignal)} ${signalSourceDate(topSignal)}`
    : "No validated signal";
  const topOpportunityLabel = topOpportunity
    ? `${topOpportunity.company.name}: opp ${topOpportunity.opportunity}, fit ${topOpportunity.fit.score}%`
    : "No ranked opportunity";
  const topRiskDriver = topRisk?.dimensions.risk.contributions[0]?.event_type?.replace(/_/g, " ") ?? "validated risk signal";
  const topRiskLabel = topRisk ? `${nameOf(topRisk.subject_id)}: risk ${topRisk.dimensions.risk.score}, ${topRiskDriver}` : "No elevated risk";

  function ask(question: string) {
    const response = processBrainQuestion(question, world);
    saveBrainMemoryNote(response.savedNote);
    setState({ brainResponse: response, activeBrainArea: response.activatedBrainAreas[0] ?? "revenue" });
  }

  function openSample(sample: Deliverable) {
    const chartBlock = sample.sections.flatMap((section) => section.blocks).find((block) => block.kind === "chart-spec");
    if (sample.type === "analysis_view" && chartBlock?.kind === "chart-spec") {
      setState({ activeAnalysisSpec: chartBlock.spec as unknown as ChartSpec, activeBrainArea: "decision", brainResponse: null, activeDeliverable: null });
      return;
    }
    setState({ activeDeliverable: sample, activeBrainArea: sample.brainArea, brainResponse: null, activeAnalysisSpec: null });
  }

  const recent = memory.activity[0];
  function recentLine(): string {
    if (!recent) return "Recent activity and notes will appear here as the brain starts saving work.";
    // Deduplicate: if summary starts with the title, show just the summary
    const summary = recent.summary.startsWith(recent.title) ? recent.summary : `${recent.title}: ${recent.summary}`;
    return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary;
  }

  return (
    <div className="quiet-home">
      <p className="home-welcome">Welcome to Chatpil, your personal assistant</p>
      <div className="today-strip">
        <button title={topSignalLabel} onClick={() => ask("What market signals should BTX care about this week?")}>
          <span>Top signal</span>
          <strong>{topSignalLabel}</strong>
        </button>
        <button title={topOpportunityLabel} onClick={() => setState({ activeCompanyId: topOpportunity?.company.id ?? null })}>
          <span>Top opportunity</span>
          <strong>{topOpportunityLabel}</strong>
        </button>
        <button title={topRiskLabel} onClick={() => ask("Which accounts are at risk this quarter?")}>
          <span>Top risk</span>
          <strong>{topRiskLabel}</strong>
        </button>
      </div>
      {askBar}
      <div className="recent-line" title={recent ? `${recent.title}: ${recent.summary}` : undefined}>
        {recentLine()}
      </div>
      <div className="sample-library">
        <div className="sample-library-head">
          <span>Library</span>
          <button onClick={requestTour}>Demo tour</button>
        </div>
        <div className="sample-library-list">
          {SAMPLE_LIBRARY.slice(0, 6).map((sample) => (
            <button key={sample.id} title={sample.title} onClick={() => openSample(sample)}>
              <strong>{sample.title}</strong>
              <em>{sample.type.replace(/_/g, " ")}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
