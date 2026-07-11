import { useMemo, useState } from "react";
import news from "../../../data/demo/btx/news.json";
import { CONFIG } from "../../app/config.ts";
import type { World } from "../../app/useWorld.ts";
import type { MarketEvent } from "../../engine/brain/entities.ts";
import { businessMotionForAccount, isCurrentBusinessAccount, isProspectingAccount } from "../../brain/classification.ts";
import { PORTFOLIO_SIGNAL_SUBJECT_ID, SCORE_DIMENSIONS } from "../../engine/signals/contract.ts";
import type { ScoreDimension, Signal } from "../../engine/signals/contract.ts";
import { actionLabel } from "../../app/actionLabels.ts";
import { expandSignalPrompt, nextActionPrompt } from "../../app/copilotPrompts.ts";
import { formatAddress } from "../../app/format.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { provenanceForRecord } from "../../app/provenance.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";

const NEWS = news as unknown as MarketEvent[];

type Filter = "all" | "current" | "prospecting" | "revenue" | "risk" | "competitor" | "contract" | "high_confidence";
type Sort = "priority" | "newest" | "confidence" | "impact";
type MotionLabel = "Current Business" | "Prospecting" | "Both" | "Monitor";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "current", label: "Current business" },
  { id: "prospecting", label: "Prospecting" },
  { id: "revenue", label: "Revenue signals" },
  { id: "risk", label: "Risk signals" },
  { id: "competitor", label: "Competitor signals" },
  { id: "contract", label: "Contract signals" },
  { id: "high_confidence", label: "High confidence" },
];

const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreImpact(eventType: string): { text: string; total: number; dimensions: ScoreDimension[] } {
  const row = CONFIG.weights[eventType];
  if (!row) return { text: "No scored effect", total: 0, dimensions: [] };
  const dimensions = SCORE_DIMENSIONS.filter((d) => row[d]);
  return {
    text: dimensions.length ? dimensions.map((d) => `${titleCase(d)} +${row[d]}`).join(", ") : "No scored effect",
    total: dimensions.reduce((sum, d) => sum + Math.abs(row[d] ?? 0), 0),
    dimensions,
  };
}

function isPortfolioSignal(signal: Signal): boolean {
  return signal.scope === "unlinked" || signal.scope === "portfolio" || signal.subject_id === PORTFOLIO_SIGNAL_SUBJECT_ID;
}

function motionForSignal(world: World, signal: Signal): MotionLabel {
  if (isPortfolioSignal(signal)) return "Monitor";
  const company = world.companies.find((c) => c.id === signal.subject_id);
  if (!company) return "Monitor";
  const motion = signal.business_motion ?? businessMotionForAccount(company);
  const current = isCurrentBusinessAccount(company) || motion === "manage_current_business" || motion === "grow_existing_business" || motion === "reduce_risk";
  const prospecting = isProspectingAccount(company) || motion === "prospect_new_business";
  if (current && prospecting) return "Both";
  if (prospecting) return "Prospecting";
  if (current) return "Current Business";
  return "Monitor";
}

function whyItMatters(world: World, signal: Signal): string {
  if (isPortfolioSignal(signal)) return "Market-level monitor signal; not linked to a HubSpot account until identity matching is available.";
  const company = world.companies.find((c) => c.id === signal.subject_id);
  const rec = world.analysis.recById.get(signal.subject_id);
  const impact = scoreImpact(signal.event_type);
  const openPipeline = world.opportunities
    .filter((o) => o.company_id === signal.subject_id && o.stage !== "won" && o.stage !== "lost")
    .reduce((sum, o) => sum + o.value, 0);
  if (rec) return `${actionLabel(rec.action)} is recommended because this signal contributes to the account's current score context.`;
  if (impact.dimensions.includes("opportunity")) return `${company?.name ?? "This account"} has a revenue-related signal that can raise pursuit priority.`;
  if (impact.dimensions.includes("risk") || impact.dimensions.includes("capacityRisk")) return `This signal can affect delivery, capacity, supplier, or account risk.`;
  if (openPipeline > 0) return `${money(openPipeline)} in open pipeline is attached to this account.`;
  return `This signal is validated evidence for monitoring ${company?.name ?? "the account"}.`;
}

function filterRow(filter: Filter, row: SignalRow): boolean {
  switch (filter) {
    case "current":
      return row.motion === "Current Business" || row.motion === "Both";
    case "prospecting":
      return row.motion === "Prospecting" || row.motion === "Both";
    case "revenue":
      return row.impact.dimensions.includes("opportunity") || Boolean(row.signal.value);
    case "risk":
      return row.impact.dimensions.includes("risk") || row.impact.dimensions.includes("capacityRisk");
    case "competitor":
      return row.companyRelationship === "competitor" || row.signal.event_type.includes("competitor");
    case "contract":
      return row.signal.event_type.includes("contract") || row.signal.event_type.includes("award");
    case "high_confidence":
      return row.signal.confidence >= 0.9;
    case "all":
      return true;
  }
}

interface SignalRow {
  signal: Signal;
  companyName: string;
  companyRelationship: string;
  headline: string;
  source: string;
  sourceDate: string;
  sourceUrl: string | undefined;
  documentUrl: string | undefined;
  address: string | null;
  motion: MotionLabel;
  impact: { text: string; total: number; dimensions: ScoreDimension[] };
  priority: "high" | "medium" | "low" | "none";
  actionText: string;
  why: string;
}

export function SignalFeed({ world }: { world: World }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const newsById = new Map(NEWS.map((item) => [`news-sig-${item.id}`, item]));
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;

  const rows = useMemo<SignalRow[]>(() => {
    return world.analysis.valid.map((signal) => {
      const portfolio = isPortfolioSignal(signal);
      const company = world.companies.find((c) => c.id === signal.subject_id);
      const rec = world.analysis.recById.get(signal.subject_id);
      const article = newsById.get(signal.id);
      const impact = portfolio ? { text: "Market-level only; not account-scored", total: 0, dimensions: [] } : scoreImpact(signal.event_type);
      return {
        signal,
        companyName: portfolio ? "Market / portfolio" : nameOf(signal.subject_id),
        companyRelationship: portfolio ? "unlinked" : company?.relationship ?? "unknown",
        address: company ? formatAddress(company.location) : null,
        headline: signal.artifact ? signalHeadline(signal) : article?.headline ?? titleCase(signal.event_type),
        source: signal.artifact ? signalSourceName(signal) : article?.source ?? "Simulated Market Signal Feed",
        sourceDate: signal.artifact ? signalSourceDate(signal) : article?.published_date ?? signal.detected_at.slice(0, 10),
        sourceUrl: signal.artifact?.source_url ?? article?.source_url ?? signal.source_url,
        documentUrl: article?.document_url ?? signal.document_url,
        motion: motionForSignal(world, signal),
        impact,
        priority: portfolio ? "none" : rec?.priority ?? "none",
        actionText: portfolio ? "Review as market context; no account task is recommended." : rec ? `${actionLabel(rec.action)} - ${rec.reason}` : "Monitor this account; no immediate action is recommended.",
        why: whyItMatters(world, signal),
      };
    });
  }, [world]);

  const visible = rows
    .filter((row) => filterRow(filter, row))
    .sort((a, b) => {
      if (sort === "priority") return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.impact.total - a.impact.total;
      if (sort === "newest") return b.signal.detected_at.localeCompare(a.signal.detected_at);
      if (sort === "confidence") return b.signal.confidence - a.signal.confidence;
      return b.impact.total - a.impact.total || b.signal.confidence - a.signal.confidence;
    });

  return (
    <div className="feed signal-inbox">
      <div className="feed-head signal-inbox-head">
        <div>
          <p className="eyebrow">Signal Inbox</p>
          <h1>What changed, who is affected, and what should BTX do?</h1>
          <p>Validated market, contract, risk, and competitor signals currently feeding scores and recommendations.</p>
        </div>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="priority">Action priority</option>
            <option value="newest">Newest</option>
            <option value="confidence">Confidence</option>
            <option value="impact">Score impact</option>
          </select>
        </label>
      </div>

      <div className="signal-filter-bar">
        {FILTERS.map((item) => (
          <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="signal-list">
        {visible.map((row) => (
          <article key={row.signal.id} className="signal-inbox-card">
            <div className="signal-card-head">
              <div>
                <span className="sig-type">{titleCase(row.signal.event_type)}</span>
                <h2>{row.headline}</h2>
                <p>{row.source} · {row.sourceDate}</p>
              </div>
              <div className="card-badge-row">
                {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(row.signal)} />}
                <span className={`motion-pill motion-${row.motion.replace(/\s+/g, "-").toLowerCase()}`}>{row.motion}</span>
              </div>
            </div>

            <div className="signal-card-grid">
              <div>
                <span>Affects</span>
                <strong>{row.companyName}</strong>
                <em>{titleCase(row.companyRelationship)}</em>
                {row.address && <em>{row.address}</em>}
              </div>
              <div>
                <span>Why it matters</span>
                <strong>{row.why}</strong>
              </div>
              <div>
                <span>Recommended action</span>
                <strong>{row.actionText}</strong>
              </div>
              <div>
                <span>Score impact</span>
                <strong>{row.impact.text}</strong>
                <em>Confidence {(row.signal.confidence * 100).toFixed(0)}%{row.signal.value ? ` · value ${money(row.signal.value)}` : ""}</em>
              </div>
            </div>

            <div className="signal-evidence">
              <span>Evidence</span>
              <p>{row.signal.source_quote}</p>
              <div className="link-row">
                <ExternalLink href={row.sourceUrl} label="Open source" />
                <ExternalLink href={row.documentUrl} label="Document" />
              </div>
              {!row.sourceUrl && !row.documentUrl && <em>{row.signal.artifact ? "No source link in monitor-engine artifact" : "No source link in static demo snapshot"}</em>}
            </div>

            <div className="signal-actions">
              <AskChatpilButton label="Explain" prompt={expandSignalPrompt(row.signal, row.companyName)} />
              <AskChatpilButton
                label="What should I do?"
                prompt={nextActionPrompt(row.companyName, `Signal inbox item. Event ${row.signal.event_type}. Motion ${row.motion}. Score impact ${row.impact.text}. Recommended action: ${row.actionText}. Evidence: ${row.signal.source_quote}`)}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
