import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { PROFILE } from "../app/config.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import { healthLabel, pipelineHealth } from "../engine/decision/health.ts";
import { actionLabel } from "../app/actionLabels.ts";
import { displayLabel } from "../app/displayLabels.ts";
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
  { id: "cover", heading: "Cover", required: true },
  { id: "executive-summary", heading: "Executive Summary", required: true },
  { id: "account-context", heading: "Account Context", required: true },
  { id: "recent-developments", heading: "Recent Developments", required: true },
  { id: "decision-summary", heading: "Decision Summary", required: true },
  { id: "meeting-preparation", heading: "Meeting Preparation", required: true },
  { id: "current-work", heading: "Current Work", required: true },
  { id: "sources-and-data-notes", heading: "Sources And Data Notes", required: true },
];

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1_000)}k`;
}

function riskPhrase(value: unknown): string {
  const score = Number(value);
  return score > 0 ? `risk score is ${score}` : "there are no active risk signals";
}

function scoreSnapshot(world: World, accountId: string, family: keyof NonNullable<World["scoreResults"]>) {
  return world.scoreResults?.[family]
    .filter((score) => score.entityType === "account" && score.entityId === accountId)
    .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0] ?? null;
}

function scoreBrief(snapshot: ReturnType<typeof scoreSnapshot>, label: string): string {
  if (!snapshot || snapshot.score === null || snapshot.result.status === "insufficient_data") return `${label}: unavailable. Missing information remains.`;
  const value = snapshot.result.status === "provisional" ? `${Math.round(snapshot.score)} provisional` : snapshot.result.status === "disqualified" ? "disqualified" : String(Math.round(snapshot.score));
  const factor = snapshot.result.positiveFactors[0]?.label ?? snapshot.result.negativeFactors[0]?.label ?? "current evidence set";
  const missing = snapshot.result.missingInputs[0] ?? "no major missing input surfaced";
  return `${label}: ${value}. Main factor: ${factor}. Missing: ${missing}.`;
}

function evidenceConfidence(input: { hasVerifiedLink: boolean; hasContact: boolean; hasPipeline: boolean; hasDatedSignal: boolean }): { confidence: Deliverable["confidence"]; reason: string } {
  const missing = [
    input.hasVerifiedLink ? "" : "verified account link",
    input.hasContact ? "" : "named contact",
    input.hasPipeline ? "" : "open pipeline",
    input.hasDatedSignal ? "" : "dated signal",
  ].filter(Boolean);
  if (missing.length === 0) return { confidence: "high", reason: "High: verified account link, contact, open pipeline, and dated signal are available." };
  if (missing.length <= 2) return { confidence: "medium", reason: `Medium: missing ${missing.join(", ")}.` };
  return { confidence: "low", reason: `Low, needs qualification: missing ${missing.join(", ")}.` };
}

export function buildMeetingBriefContext(accountId: string, world: World): AgentContext {
  const company = world.companies.find((c) => c.id === accountId);
  if (!company) throw new Error(`Unknown account ${accountId}`);
  const signals = world.analysis.valid.filter((s) => s.subject_id === accountId);
  const opportunities = world.opportunities.filter((o) => o.company_id === accountId);
  const contacts = world.contacts.filter((c) => c.company_id === accountId);
  const fit = scoreFit(company.needs, PROFILE.capabilities);
  const health = pipelineHealth(opportunities);
  const rec = world.analysis.recById.get(accountId);
  const score = world.analysis.byId.get(accountId);
  const openPipelineValue = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((sum, o) => sum + (o.value ?? 0), 0);
  const topSignal = signals.sort((a, b) => b.confidence - a.confidence)[0];
  const confidence = evidenceConfidence({
    hasVerifiedLink: company.relationship === "customer" || Boolean(topSignal?.relationships?.some((relationship) => relationship.canonical_account_id === accountId && relationship.review_status === "accepted")),
    hasContact: contacts.length > 0,
    hasPipeline: openPipelineValue > 0,
    hasDatedSignal: Boolean(topSignal?.detected_at || topSignal?.artifact?.source_date),
  });
  const topSignalAccount = world.companies.find((c) => c.id === topSignal?.subject_id)?.name ?? "Portfolio monitor";
  const accountSource = provenanceForRecord(company) === "CRM" ? "HubSpot CRM" : "Account baseline";
  const contactSource = contacts.some((contact) => provenanceForRecord(contact) === "CRM") ? "HubSpot CRM" : "Contact baseline";
  const opportunitySource = opportunities.some((opportunity) => provenanceForRecord(opportunity) === "CRM") ? "HubSpot CRM" : "Pipeline baseline";
  const signalSource = topSignal?.artifact ? "Monitor engine" : "Monitor engine + public sources";
  const workItems = (world.worldSnapshot?.workItems ?? []).filter((item) => item.canonical_account_id === accountId);
  const freshness = [
    `Prepared date ${new Date().toISOString().slice(0, 10)}`,
    `Workspace generated ${world.worldSnapshot?.generatedAt ? world.worldSnapshot.generatedAt.slice(0, 10) : "unavailable"}`,
    `Monitor run ${world.snapshot?.publicSignals.run_at ? world.snapshot.publicSignals.run_at.slice(0, 10) : "unavailable"}`,
  ].join("; ");
  const classification = world.worldSnapshot?.tenant.isDemonstration
    ? "Demonstration workspace. Internal CRM, work, and operating records are illustrative."
    : "Internal workspace record.";
  const decisionScoreText = [
    scoreBrief(scoreSnapshot(world, accountId, "accountAttractiveness"), "Strategic attractiveness"),
    scoreBrief(scoreSnapshot(world, accountId, "signalConfidence"), "Evidence strength"),
    scoreBrief(scoreSnapshot(world, accountId, "pursuitPwin"), "Likelihood to win"),
    scoreBrief(scoreSnapshot(world, accountId, "deliveryFeasibility"), "Ability to deliver"),
    scoreBrief(scoreSnapshot(world, accountId, "relationshipHealth"), "Relationship strength"),
  ].join(" ");

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
      signalSource,
      freshness,
      classification,
      topSignal: topSignal ? signalEvidenceForCompany(topSignalAccount, topSignal) : "No monitor signal available.",
      artifactSignalFigures: signalFigureContext(topSignal ? [topSignal, ...signals] : signals),
      recommendedAction: rec ? `${actionLabel(rec.action)}: ${rec.reason}` : "Monitor until a stronger signal appears.",
      decisionScoreText,
      workSummary: workItems.length
        ? workItems.slice(0, 4).map((item) => `${item.recommended_action} Owner: ${item.owner ?? "Unassigned"}. Due: ${item.due_date ?? "not set"}. Approval: ${item.approval_state.replace(/_/g, " ")}.`).join(" ")
        : "No open account-specific work items are available.",
      deliverableConfidence: confidence.confidence,
      deliverableConfidenceReason: confidence.reason,
    },
    entityIds: [accountId],
    sources: [
      { source: accountSource, records: [accountId], reason: "Account profile, market, relationship, and capability needs." },
      { source: contactSource, records: contacts.map((c) => c.id), reason: "Recommended stakeholder coverage." },
      { source: opportunitySource, records: opportunities.map((o) => o.id), reason: "Open pipeline, stages, close dates, and values." },
      { source: signalSource, records: topSignal ? [topSignal.id] : [], reason: topSignal?.artifact ? "Monitor engine evidence with source names and dates." : "Validated evidence and timing." },
      { source: "Operating baseline", records: ["capacity", "operating_baseline"], reason: "Capacity and operating context come from the approved baseline until ERP integration is connected." },
    ],
  };
}

export function composeMeetingBrief(ctx: AgentContext): Deliverable {
  const f = ctx.facts;
  return {
    id: `deliv-${Date.now()}-${f.accountId}`,
    type: "meeting_brief",
    title: `Executive Account and Meeting Brief - ${f.accountName}`,
    createdAt: new Date().toISOString(),
    brainArea: "accounts",
    entityIds: ctx.entityIds,
    confidence: String(f.deliverableConfidence) as Deliverable["confidence"],
    confidenceReason: String(f.deliverableConfidenceReason),
    sections: [
      {
        id: "cover",
        heading: "Cover",
        blocks: [
          { kind: "table", columns: ["Field", "Value"], rows: [
            ["Account", String(f.accountName)],
            ["Meeting purpose", "Prepare an evidence-backed account discussion."],
            ["Meeting date", "Not supplied"],
            ["Prepared for", "BTX leadership and revenue team"],
            ["Prepared date and data freshness", String(f.freshness)],
            ["Classification", String(f.classification)],
          ] },
        ],
      },
      {
        id: "executive-summary",
        heading: "Executive Summary",
        blocks: [
          { kind: "text", text: `${f.accountName} matters because it combines ${money(Number(f.openPipelineValue))} open pipeline, ${String(f.pipelineHealth).toLowerCase()} pipeline health, and ${Number(f.fitScore) >= 70 ? "strong" : Number(f.fitScore) >= 45 ? "partial" : "limited"} capability alignment with ${PROFILE.name}. What changed: ${String(f.topSignal)} Recommended posture: ${String(f.recommendedAction)} Most important uncertainty: confirm decision process, timing, qualification requirements, and delivery window before overcommitting.` },
        ],
      },
      {
        id: "account-context",
        heading: "Account Context",
        blocks: [
          { kind: "table", columns: ["Status", "Contact", "Open pipeline", "Pipeline health", "Source"], rows: [[displayLabel(String(f.accountStatus)), String(f.contact), money(Number(f.openPipelineValue)), String(f.pipelineHealth), `${f.contactSource} / ${f.opportunitySource}`]] },
          { kind: "text", text: `Capabilities aligned to stated needs: ${f.matchedCapabilities}. Gaps or qualification topics: ${f.missingCapabilities}.` },
        ],
      },
      {
        id: "recent-developments",
        heading: "Recent Developments",
        blocks: [
          { kind: "text", text: `${String(f.topSignal)} Program and market context should remain separate unless an account relationship is confirmed in the source records.` },
        ],
      },
      {
        id: "decision-summary",
        heading: "Decision Summary",
        blocks: [
          { kind: "text", text: String(f.decisionScoreText) },
        ],
      },
      {
        id: "meeting-preparation",
        heading: "Meeting Preparation",
        blocks: [
          { kind: "text", text: `Objectives: confirm account timing, validate the opportunity, identify stakeholders, and define the next qualified action. Talking points: lead with ${f.matchedCapabilities}; ask about decision criteria, print package readiness, certifications, timing, pricing expectations, and follow-up ownership. Risks to avoid: unsupported capacity claims, invented savings, or treating attractiveness as win probability. Desired outcome: a qualified next step with evidence, owner, due date, and approval state.` },
        ],
      },
      {
        id: "current-work",
        heading: "Current Work",
        blocks: [
          { kind: "text", text: String(f.workSummary) },
        ],
      },
      {
        id: "sources-and-data-notes",
        heading: "Sources And Data Notes",
        blocks: [
          { kind: "text", text: `Sources: ${ctx.sources.map((source) => `${source.source} (${source.records.length} records)`).join("; ")}. Data notes: ${String(f.freshness)}. Classification: ${String(f.classification)} Missing systems: live ERP/MES capacity and autonomous email/calendar execution are not available in this brief.` },
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
