import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { PROFILE } from "../app/config.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import { healthLabel, pipelineHealth } from "../engine/decision/health.ts";
import { actionLabel } from "../app/actionLabels.ts";
import { signalEvidenceForCompany, signalFigureContext } from "../app/signalProvenance.ts";
import { provenanceForRecord } from "../app/provenance.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  accountId: z.string().min(1),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sectionSpec = [
  { id: "overview", heading: "Overview", required: true },
  { id: "relationship", heading: "Relationship & History", required: true },
  { id: "signals", heading: "Live Signals", required: true },
  { id: "talking-points", heading: "Talking Points", required: true },
  { id: "risks", heading: "Risks & Open Questions", required: true },
];

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1_000)}k`;
}

function riskPhrase(value: unknown): string {
  const score = Number(value);
  return score > 0 ? `risk score is ${score}` : "there are no active risk signals";
}

export function buildMeetingBriefContext(accountId: string, world: World): AgentContext {
  const company = world.companies.find((c) => c.id === accountId);
  if (!company) throw new Error(`Unknown account ${accountId}`);
  const signals = world.analysis.valid.filter((s) => s.subject_id === accountId);
  const fallbackSignal = world.dataMode === "hybrid"
    ? [...world.analysis.valid].filter((signal) => signal.artifact).sort((a, b) => b.confidence - a.confidence)[0]
    : undefined;
  const opportunities = world.opportunities.filter((o) => o.company_id === accountId);
  const contacts = world.contacts.filter((c) => c.company_id === accountId);
  const fit = scoreFit(company.needs, PROFILE.capabilities);
  const health = pipelineHealth(opportunities);
  const rec = world.analysis.recById.get(accountId);
  const score = world.analysis.byId.get(accountId);
  const openPipelineValue = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((sum, o) => sum + o.value, 0);
  const topSignal = signals.sort((a, b) => b.confidence - a.confidence)[0] ?? fallbackSignal;
  const topSignalAccount = world.companies.find((c) => c.id === topSignal?.subject_id)?.name ?? "Portfolio monitor";
  const accountSource = provenanceForRecord(company) === "HubSpot" ? "HubSpot CRM" : "companies.json";
  const contactSource = contacts.some((contact) => provenanceForRecord(contact) === "HubSpot") ? "HubSpot CRM" : "contacts.json";
  const opportunitySource = opportunities.some((opportunity) => provenanceForRecord(opportunity) === "HubSpot") ? "HubSpot CRM" : "opportunities.json";
  const signalSource = topSignal?.artifact ? "monitor-engine artifacts" : "signals.json + news.json";
  const signalDisplay = world.dataMode === "hybrid" ? (topSignal?.artifact ? "Monitor" : "Demo") : topSignal?.artifact ? "Monitor" : "Signals";

  return {
    facts: {
      accountId,
      accountName: company.name,
      city: company.location.city,
      relationship: company.relationship,
      accountStatus: company.account_status ?? "unknown",
      opportunityScore: score?.dimensions.opportunity.score ?? 0,
      riskScore: score?.dimensions.risk.score ?? 0,
      fitScore: fit.score,
      matchedCapabilities: fit.matched.join(", ") || "No direct match recorded",
      missingCapabilities: fit.missing.join(", ") || "No major gaps recorded",
      openPipelineValue,
      pipelineHealth: healthLabel(health),
      contact: contacts[0] ? `${contacts[0].name}, ${contacts[0].title}` : "No contact available",
      accountSource,
      contactSource,
      opportunitySource,
      signalSource: signalDisplay,
      fallbackDisclosure: world.dataMode === "hybrid" ? "Hybrid mode: account, contact, and deal facts are HubSpot; external market facts are Monitor; capacity/operating context is Demo fallback." : "",
      topSignal: topSignal ? signalEvidenceForCompany(topSignalAccount, topSignal) : "No monitor signal available.",
      artifactSignalFigures: signalFigureContext(topSignal ? [topSignal, ...signals] : signals),
      recommendedAction: rec ? `${actionLabel(rec.action)}: ${rec.reason}` : "Monitor until a stronger signal appears.",
    },
    entityIds: [accountId],
    sources: [
      { source: accountSource, records: [accountId], reason: "Account profile, market, relationship, and capability needs." },
      { source: contactSource, records: contacts.map((c) => c.id), reason: "Recommended stakeholder coverage." },
      { source: opportunitySource, records: opportunities.map((o) => o.id), reason: "Open pipeline, stages, close dates, and values." },
      { source: signalSource, records: topSignal ? [topSignal.id] : [], reason: topSignal?.artifact ? "Real monitor-engine evidence with source names, dates, and artifact provenance." : "Validated evidence and timing." },
      ...(world.dataMode === "hybrid" ? [{ source: "Demo fallback", records: ["capacity", "operating_snapshot"], reason: "Capacity and operating context not yet integrated." }] : []),
    ],
  };
}

export function composeMeetingBrief(ctx: AgentContext): Deliverable {
  const f = ctx.facts;
  return {
    id: `deliv-${Date.now()}-${f.accountId}`,
    type: "meeting_brief",
    title: `Meeting Brief - ${f.accountName}`,
    createdAt: new Date().toISOString(),
    brainArea: "customer",
    entityIds: ctx.entityIds,
    confidence: "high",
    sections: [
      {
        id: "overview",
        heading: "Overview",
        blocks: [
          { kind: "text", text: `${f.fallbackDisclosure ? `${f.fallbackDisclosure} ` : ""}[${f.accountSource}] ${f.accountName} is a ${f.relationship} account in ${f.city}. Opportunity score is ${f.opportunityScore}, ${riskPhrase(f.riskScore)}, and ${PROFILE.name} fit is ${f.fitScore}%.` },
        ],
      },
      {
        id: "relationship",
        heading: "Relationship & History",
        blocks: [
          { kind: "table", columns: ["Status", "Contact", "Open pipeline", "Pipeline health", "Source"], rows: [[String(f.accountStatus), String(f.contact), money(Number(f.openPipelineValue)), String(f.pipelineHealth), `${f.contactSource} / ${f.opportunitySource}`]] },
        ],
      },
      {
        id: "signals",
        heading: "Live Signals",
        blocks: [
          { kind: "text", text: `[${f.signalSource}] ${String(f.topSignal)}` },
        ],
      },
      {
        id: "talking-points",
        heading: "Talking Points",
        blocks: [
          { kind: "text", text: `Lead with ${f.matchedCapabilities} because those capabilities match the account's stated needs. Be transparent about gaps such as ${f.missingCapabilities} and frame them as qualification questions or teaming needs.` },
        ],
      },
      {
        id: "risks",
        heading: "Risks & Open Questions",
        blocks: [
          { kind: "text", text: `Confirm decision process, delivery timing, qualification requirements, and whether ${PROFILE.name} capacity can support the next production window.` },
        ],
      },
    ],
    sources: ctx.sources,
    actions: [
      { id: "copy", label: "Copy", kind: "copy" },
      { id: "download", label: "Download Markdown", kind: "download_markdown" },
      { id: "task", label: "Create CRM Task", kind: "simulated_crm_task" },
    ],
  };
}

export const meetingBriefAgent: DeliverableAgent<Inputs> = {
  id: "meeting_brief",
  audience: "internal",
  form: "brief",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.meeting_brief,
  contextRecipe: (inputs, world) => buildMeetingBriefContext(inputs.accountId, world),
  async compose(ctx) {
    return composeMeetingBrief(ctx);
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sectionSpec.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
  },
};
