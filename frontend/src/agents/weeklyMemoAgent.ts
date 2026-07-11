import { z } from "zod";
import type { Deliverable } from "../deliverables/types.ts";
import type { World } from "../app/useWorld.ts";
import { PROFILE } from "../app/config.ts";
import { actionLabel } from "../app/actionLabels.ts";
import { displayLabel } from "../app/displayLabels.ts";
import { signalEvidenceForCompany, signalFigureContext } from "../app/signalProvenance.ts";
import { provenanceForRecord } from "../app/provenance.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  title: z.string().optional(),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sections = [
  { id: "answer", heading: "This Week's Answer", required: true },
  { id: "opportunity", heading: "Top Opportunity", required: true },
  { id: "risk", heading: "Top Risk", required: true },
  { id: "actions", heading: "Recommended Actions", required: true },
];

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1_000)}k`;
}

function stripPeriod(text: string): string {
  return text.replace(/[.?!]\s*$/u, "");
}

function confidence(hasOpportunity: boolean, hasRisk: boolean, hasSignal: boolean): Deliverable["confidence"] {
  if (hasOpportunity && hasRisk && hasSignal) return "high";
  if ((hasOpportunity && hasRisk) || hasSignal) return "medium";
  return "low";
}

export const weeklyMemoAgent: DeliverableAgent<Inputs> = {
  id: "weekly_memo",
  audience: "internal",
  form: "memo",
  inputs: Inputs,
  outputSchema: sections,
  rubric: AGENT_RUBRICS.weekly_memo,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const topOpportunity = world.prospects[0];
    const topRisk = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score)[0];
    const topSignal = topOpportunity?.topSignal ?? [...world.analysis.valid].sort((a, b) => b.confidence - a.confidence)[0];
    const riskSignalId = topRisk?.dimensions.risk.contributions[0]?.signal_id;
    const topRiskSignal = world.analysis.valid.find((signal) => signal.id === riskSignalId) ??
      world.analysis.valid.find((signal) => signal.subject_id === topRisk?.subject_id);
    const topAction = topOpportunity ? world.analysis.recById.get(topOpportunity.company.id) : world.analysis.recommendations[0];
    const pipelineValue = world.opportunities
      .filter((o) => o.stage !== "won" && o.stage !== "lost")
      .reduce((sum, o) => sum + o.value, 0);
    const nameOf = (id?: string | null) => world.companies.find((c) => c.id === id)?.name ?? "No account available";
    const topSignalAccount = nameOf(topSignal?.subject_id);
    const topRiskAccount = nameOf(topRisk?.subject_id);
    const evidenceSignals = [topSignal, topRiskSignal].filter((signal): signal is NonNullable<typeof topSignal> => Boolean(signal));
    const accountSource = topOpportunity && provenanceForRecord(topOpportunity.company) === "CRM" ? "CRM" : "companies.json";
    const opportunitySource = world.opportunities.some((opportunity) => provenanceForRecord(opportunity) === "CRM") ? "CRM" : "opportunities.json";
    const signalSource = topSignal?.artifact ? "monitor-engine artifacts" : "signals.json + news.json";
    const signalDisplay = world.dataMode === "hybrid" ? (topSignal?.artifact ? "Monitor" : "Demo") : topSignal?.artifact ? "Monitor" : "Signals";

    return {
      facts: {
        title: inputs.title ?? "Weekly CRO Memo",
        topOpportunityName: topOpportunity?.company.name ?? "No opportunity available",
        topOpportunityScore: topOpportunity?.opportunity ?? 0,
        topOpportunityFit: topOpportunity?.fit.score ?? 0,
        topRiskName: topRiskAccount,
        topRiskScore: topRisk?.dimensions.risk.score ?? 0,
        topSignalType: topSignal ? displayLabel(topSignal.event_type) : "No signal available",
        topSignalQuote: topSignal ? signalEvidenceForCompany(topSignalAccount, topSignal, "") : "",
        topRiskQuote: topRiskSignal ? signalEvidenceForCompany(topRiskAccount, topRiskSignal, "") : "",
        artifactSignalFigures: signalFigureContext(evidenceSignals),
        openPipelineValue: pipelineValue,
        pipelineScope: "All markets",
        recommendedAction: topAction ? `${actionLabel(topAction.action)}: ${topAction.reason}` : "Monitor the portfolio for new evidence.",
        accountSource,
        opportunitySource,
        signalSource: signalDisplay,
        fallbackDisclosure: world.dataMode === "hybrid" ? "Hybrid mode: internal account/deal facts are CRM when available; external facts are Monitor; capacity and operating context is Demo fallback." : "",
        ...(topRisk?.subject_id ? { [`${topRisk.subject_id}:evidence`]: `${topRiskAccount}::${signalEvidenceForCompany(topRiskAccount, topRiskSignal, topRiskAccount)}` } : {}),
      },
      entityIds: [topOpportunity?.company.id, topRisk?.subject_id, topSignal?.subject_id].filter((id): id is string => Boolean(id)),
      sources: [
        { source: accountSource, records: world.companies.map((c) => c.id), reason: "Account names, markets, and relationship status." },
        { source: signalSource, records: world.analysis.valid.map((s) => s.id).slice(0, 12), reason: topSignal?.artifact ? `Real monitor-engine signal evidence from ${topSignal.artifact.source_name}, run ${topSignal.artifact.run_at}.` : "Validated market and risk evidence used in scores." },
        { source: opportunitySource, records: world.opportunities.map((o) => o.id).slice(0, 12), reason: "Open pipeline value and opportunity context." },
        ...(world.dataMode === "hybrid" ? [{ source: "Demo fallback", records: ["capacity", "operating_snapshot"], reason: "Capacity and operating context not yet integrated." }] : []),
      ],
    };
  },
  async compose(ctx: AgentContext): Promise<Deliverable> {
    const f = ctx.facts;
    const now = new Date().toISOString();
    const conf = confidence(Boolean(f.topOpportunityName && f.topOpportunityName !== "No opportunity available"), Boolean(f.topRiskQuote), Boolean(f.topSignalQuote));
    return {
      id: `deliv-${Date.now()}`,
      type: "weekly_memo",
      title: String(f.title),
      createdAt: now,
      brainArea: "revenue",
      entityIds: ctx.entityIds,
      confidence: conf,
      confidenceReason: conf === "high" ? "High: opportunity, risk, and evidence are all linked." : conf === "medium" ? "Medium: at least one evidence field is incomplete." : "Low: key account evidence is missing.",
      sections: [
        {
          id: "answer",
          heading: "This Week's Answer",
          blocks: [
            { kind: "text", text: `${f.fallbackDisclosure ? `${f.fallbackDisclosure} ` : ""}Verdict: ${PROFILE.name} should focus this week on ${f.topOpportunityName} while protecting ${f.topRiskName} from delivery or account risk. ${f.pipelineScope}: ${money(Number(f.openPipelineValue))} remains open, and the strongest current evidence is [${f.signalSource}] ${String(f.topSignalType).toLowerCase()} tied to ${f.topOpportunityName}.` },
          ],
        },
        {
          id: "opportunity",
          heading: "Top Opportunity",
          blocks: [
            { kind: "table", columns: ["Account", "Opportunity score", "Fit", "Why now", "Source"], rows: [[String(f.topOpportunityName), String(f.topOpportunityScore), `${f.topOpportunityFit}%`, stripPeriod(String(f.topSignalQuote)), String(f.accountSource)]] },
          ],
        },
        {
          id: "risk",
          heading: "Top Risk",
          blocks: [
            { kind: "table", columns: ["Account", "Risk score", "Evidence"], rows: [[String(f.topRiskName), String(f.topRiskScore), stripPeriod(String(f.topRiskQuote))]] },
          ],
        },
        {
          id: "actions",
          heading: "Recommended Actions",
          blocks: [
            { kind: "text", text: String(f.recommendedAction) },
          ],
        },
      ],
      sources: ctx.sources,
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "download", label: "Download Markdown", kind: "download_markdown" },
        { id: "send", label: "Send via Outlook", kind: "simulated_send" },
        { id: "task", label: "Create CRM Task", kind: "simulated_crm_task" },
      ],
    };
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sections.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
  },
};

export type WeeklyMemoInputs = Inputs;
