import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { PROFILE } from "../app/config.ts";
import { signalEvidenceForCompany, signalFigureContext } from "../app/signalProvenance.ts";
import { scoreFit } from "../engine/decision/fit.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  accountId: z.string().min(1),
  programNeed: z.string().optional(),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sectionSpec = [
  { id: "likely-need", heading: "What They Likely Need", required: true },
  { id: "fit-lines", heading: "BTX Fit, Line by Line", required: true },
  { id: "gaps-risks", heading: "Gaps and Risks", required: true },
  { id: "capacity-check", heading: "Capacity Check", required: true },
  { id: "verdict", heading: "Verdict", required: true },
];

function rating(covered: boolean, capacityStatus: string): string {
  if (!covered) return "Weak";
  if (capacityStatus.includes("limited")) return "Moderate";
  return "Strong";
}

function verdictFor(input: { fitScore: number; missingCount: number; total5Axis: number; totalTurning: number; constraints: string[] }): "pursue" | "pursue-with-caution" | "pass" {
  if (input.fitScore < 45 || (input.missingCount >= 3 && input.total5Axis < 160)) return "pass";
  if (input.fitScore < 75 || input.constraints.length >= 2 || input.total5Axis < 220 || input.totalTurning < 120) return "pursue-with-caution";
  return "pursue";
}

function confidence(value: string): Deliverable["confidence"] {
  if (value === "pursue") return "high";
  if (value === "pursue-with-caution") return "medium";
  return "medium";
}

export const capabilitiesAssessmentAgent: DeliverableAgent<Inputs> = {
  id: "capabilities_assessment",
  audience: "internal",
  form: "brief",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.capabilities_assessment,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const company = world.companies.find((item) => item.id === inputs.accountId);
    if (!company) throw new Error(`Unknown account ${inputs.accountId}`);
    const fit = scoreFit(company.needs, PROFILE.capabilities);
    const signals = world.analysis.valid.filter((item) => item.subject_id === company.id);
    const topSignal = signals.sort((a, b) => b.confidence - a.confidence)[0];
    const opportunities = world.opportunities.filter((item) => item.company_id === company.id);
    const capacity = world.snapshot?.capacity ?? [];
    const localCapacity = capacity.find((item) => item.city === company.location.city);
    const relevantCapacity = localCapacity ? [localCapacity, ...capacity.filter((item) => item.facility_id !== localCapacity.facility_id)] : capacity;
    const total5Axis = relevantCapacity.reduce((sum, item) => sum + item.available_5_axis_hours_next_30d, 0);
    const totalTurning = relevantCapacity.reduce((sum, item) => sum + item.available_turning_hours_next_30d, 0);
    const constraints = [...new Set(relevantCapacity.map((item) => item.constraint).filter(Boolean))].slice(0, 4);
    const verdict = verdictFor({ fitScore: fit.score, missingCount: fit.missing.length, total5Axis, totalTurning, constraints });
    return {
      facts: {
        accountId: company.id,
        accountName: company.name,
        city: company.location.city,
        relationship: company.relationship,
        needs: company.needs.join(", "),
        programNeed: inputs.programNeed ?? signalEvidenceForCompany(company.name, topSignal, opportunities[0]?.name ?? "Need inferred from account profile and recent evidence"),
        artifactSignalFigures: signalFigureContext(signals),
        fitScore: fit.score,
        matchedCapabilities: fit.matched.join(", ") || "No direct match recorded",
        missingCapabilities: fit.missing.join(", ") || "No major gaps recorded",
        missingCount: fit.missing.length,
        opportunityCount: opportunities.length,
        total5Axis,
        totalTurning,
        capacityStatus: relevantCapacity[0]?.capacity_status ?? "capacity not available",
        quotedLeadTimeDays: relevantCapacity[0]?.quoted_lead_time_days ?? 0,
        constraints: constraints.join(", ") || "No major constraints recorded",
        verdict,
        decidingFactor: verdict === "pursue"
          ? "fit is high and capacity appears available enough for qualification"
          : verdict === "pursue-with-caution"
            ? "fit or capacity is workable but constraints must be cleared before committing"
            : "capability gaps are too large for a direct pursuit",
        fitRows: JSON.stringify(company.needs.map((need) => {
          const covered = fit.matched.includes(need);
          return [need, covered ? need : "No direct BTX match", rating(covered, relevantCapacity[0]?.capacity_status ?? ""), covered ? "Need maps to a listed BTX capability." : "Treat as a gap, partner need, or disqualifier."];
        })),
      },
      entityIds: [company.id],
      sources: [
        { source: "companies.json", records: [company.id], reason: "Account needs, segment, and relationship." },
        { source: signals.some((signal) => signal.artifact) ? "monitor-engine artifacts" : "signals.json + news.json", records: signals.map((item) => item.id), reason: signals.some((signal) => signal.artifact) ? "Real monitor-engine evidence used to infer need, with source dates and artifact provenance." : "Recent evidence used to infer need." },
        { source: "opportunities.json", records: opportunities.map((item) => item.id), reason: "Program and pipeline context." },
        { source: "erp_capacity.json", records: relevantCapacity.map((item) => item.facility_id), reason: "Capacity availability, lead time, and constraints." },
      ],
    };
  },
  async compose(ctx): Promise<Deliverable> {
    const f = ctx.facts;
    const verdict = String(f.verdict);
    return {
      id: `deliv-${Date.now()}-capabilities-assessment`,
      type: "capabilities_assessment",
      title: `Capabilities Assessment - ${f.accountName}`,
      createdAt: new Date().toISOString(),
      brainArea: "capability",
      entityIds: ctx.entityIds,
      confidence: confidence(verdict),
      confidenceReason: `Verdict ${verdict}: based on fit ${f.fitScore}%, capacity hours, constraints, and known needs.`,
      sections: [
        {
          id: "likely-need",
          heading: "What They Likely Need",
          blocks: [{ kind: "text", text: `Inference: ${f.accountName} likely needs support around ${f.programNeed}. This is inferred from the account's needs (${f.needs}), recent evidence, and ${f.opportunityCount} opportunity record(s), not from a confirmed statement of work.` }],
        },
        {
          id: "fit-lines",
          heading: "BTX Fit, Line by Line",
          blocks: [{
            kind: "table",
            columns: ["Their need", "BTX capability", "Strength", "Reason"],
            rows: JSON.parse(String(f.fitRows)) as string[][],
          }],
        },
        {
          id: "gaps-risks",
          heading: "Gaps and Risks",
          blocks: [{ kind: "text", text: `Capability gaps: ${f.missingCapabilities}. Production constraints to clear before quoting: ${f.constraints}. Be honest about any gap that requires a partner, qualification work, or schedule buffer.` }],
        },
        {
          id: "capacity-check",
          heading: "Capacity Check",
          blocks: [{ kind: "text", text: `Current capacity context shows ${f.total5Axis} available 5-axis hours and ${f.totalTurning} available turning hours in the next 30 days. The first quoted lead time is ${f.quotedLeadTimeDays} days, with status "${f.capacityStatus}".` }],
        },
        {
          id: "verdict",
          heading: "Verdict",
          blocks: [{ kind: "text", text: `Verdict: ${verdict}. Deciding factor: ${f.decidingFactor}. Next step: qualify drawings, materials, certifications, timing, and whether constrained work should be pursued directly, partnered, or declined.` }],
        },
      ],
      sources: ctx.sources,
      actions: [
        { id: "copy", label: "Copy", kind: "copy" },
        { id: "task", label: "Create CRM Task", kind: "simulated_crm_task" },
      ],
    };
  },
  validate(deliverable, ctx) {
    const base = validateRequiredSections(deliverable, sectionSpec.map((section) => ({ id: section.id, heading: section.heading, blocks: [] })), ctx);
    const verdictText = deliverable.sections.find((section) => section.id === "verdict")?.blocks
      .filter((block) => block.kind === "text")
      .map((block) => block.text)
      .join(" ") ?? "";
    if (!/\b(pursue|pursue-with-caution|pass)\b/.test(verdictText)) base.errors.push("Assessment missing computed verdict");
    return base;
  },
};
