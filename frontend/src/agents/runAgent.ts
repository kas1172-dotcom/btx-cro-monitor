import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateAudienceAndForm } from "./contract.ts";
import { weeklyMemoAgent } from "./weeklyMemoAgent.ts";
import { meetingBriefAgent } from "./meetingBriefAgent.ts";
import { itineraryAgent } from "./itineraryAgent.ts";
import { boardDeckAgent } from "./boardDeckAgent.ts";
import { maybeComposeWithLlm } from "./llmCompose.ts";
import { outreachAgent } from "./outreachAgent.ts";
import { analysisAnnotationAgent } from "./analysisAnnotationAgent.ts";
import { salesPitchAgent } from "./salesPitchAgent.ts";
import { capabilitiesAssessmentAgent } from "./capabilitiesAssessmentAgent.ts";
import { tripBriefAgent } from "./tripBriefAgent.ts";
import { computeMetric } from "../metrics/catalog.ts";
import { assessDeliverableQuality } from "../deliverables/quality.ts";

const AGENTS = {
  weekly_memo: weeklyMemoAgent,
  meeting_brief: meetingBriefAgent,
  itinerary: itineraryAgent,
  board_deck: boardDeckAgent,
  outreach: outreachAgent,
  analysis_annotation: analysisAnnotationAgent,
  sales_pitch: salesPitchAgent,
  capabilities_assessment: capabilitiesAssessmentAgent,
  trip_brief: tripBriefAgent,
};

export type AgentId = keyof typeof AGENTS;

export async function runAgent(id: AgentId, rawInputs: unknown, world: World): Promise<Deliverable> {
  const agent = AGENTS[id] as DeliverableAgent<unknown> & {
    contextRecipe: (inputs: unknown, world: World) => AgentContext;
  };
  const parsed = agent.inputs.safeParse(rawInputs);
  if (!parsed.success) {
    throw new Error(`Invalid ${id} inputs: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  }

  const ctx = agent.contextRecipe(parsed.data, world);
  ctx.metricStates = {
    revenue: computeMetric("revenue", world),
    bookings: computeMetric("bookings", world),
    backlog: computeMetric("backlog", world),
    pipeline_by_stage: computeMetric("pipeline_by_stage", world),
    pipeline_coverage: computeMetric("pipeline_coverage", world),
    margin_trend: computeMetric("margin_trend", world),
    capacity_utilization: (world.snapshot?.capacity?.length ?? 0) > 0
      ? {
          state: "available",
          value: world.snapshot!.capacity.reduce((sum, row) => sum + row.available_5_axis_hours_next_30d + row.available_turning_hours_next_30d, 0),
          label: "Capacity evidence",
          unit: "count",
          provenance: [{ source: "operating capacity", records: world.snapshot!.capacity.map((row) => row.facility_id), reason: "Recorded available machining hours for the next 30 days." }],
          reason: "Available from approved capacity records.",
          asOf: world.snapshot?.pipeline.as_of ?? world.worldSnapshot?.generatedAt ?? null,
        }
      : computeMetric("capacity_utilization", world),
    risk: world.analysis.scores.length
      ? {
          state: "available",
          value: Math.max(...world.analysis.scores.map((score) => score.dimensions.risk.score)),
          label: "Account risk",
          unit: "%",
          provenance: [{ source: "scoring trace", records: world.analysis.scores.map((score) => score.subject_id), reason: "Rule-based account risk scores." }],
          reason: "Available from scoring traces.",
          asOf: world.worldSnapshot?.generatedAt ?? world.analysis.valid.map((signal) => signal.detected_at).filter(Boolean).sort().at(-1) ?? null,
        }
      : {
          state: "unavailable",
          value: null,
          label: "Account risk",
          unit: "%",
          provenance: [],
          reason: "No account risk score records are available.",
          asOf: null,
        },
    health: {
      state: "unavailable",
      value: null,
      label: "Relationship health",
      unit: "%",
      provenance: [],
      reason: "No approved relationship-health metric is available.",
      asOf: null,
    },
  };
  const maybeInstructions = parsed.data && typeof parsed.data === "object" && "instructions" in parsed.data
    ? String((parsed.data as { instructions?: unknown }).instructions ?? "").trim()
    : "";
  if (maybeInstructions) {
    ctx.facts.instructions = maybeInstructions;
    ctx.sources = [
      ...ctx.sources,
      { source: "user instructions", records: [id], reason: maybeInstructions },
    ];
  }
  const template = await agent.compose(ctx);
  const deliverable = await maybeComposeWithLlm({
    agentId: id,
    template,
    ctx,
    outputSchema: agent.outputSchema,
    rubric: agent.rubric,
    validate: agent.validate,
  });
  deliverable.audience = agent.audience;
  deliverable.form = agent.form;
  deliverable.sources = [
    ...deliverable.sources,
    { source: "composition path", records: [id], reason: deliverable.compositionPath ?? "Template fallback (LLM unavailable: composition status unavailable)" },
  ];
  const validation = agent.validate(deliverable, ctx);
  if (!validation.valid) {
    throw new Error(`Deliverable ${id} failed validation: ${validation.errors.join("; ")}`);
  }
  const quality = validateAudienceAndForm(deliverable, ctx, agent.audience, agent.form);
  if (!quality.valid) {
    throw new Error(`Deliverable ${id} failed quality validation: ${quality.errors.join("; ")}`);
  }
  const semanticQuality = assessDeliverableQuality(deliverable, ctx);
  deliverable.quality = semanticQuality;
  if (!semanticQuality.valid) {
    throw new Error(`Deliverable ${id} failed semantic grounding: ${semanticQuality.errors.join("; ")}`);
  }
  return deliverable;
}
