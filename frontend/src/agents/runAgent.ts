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

const AGENTS = {
  weekly_memo: weeklyMemoAgent,
  meeting_brief: meetingBriefAgent,
  itinerary: itineraryAgent,
  board_deck: boardDeckAgent,
  outreach: outreachAgent,
  analysis_annotation: analysisAnnotationAgent,
  sales_pitch: salesPitchAgent,
  capabilities_assessment: capabilitiesAssessmentAgent,
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
    { source: "composition path", records: [id], reason: deliverable.compositionPath ?? "Composed: template" },
  ];
  const validation = agent.validate(deliverable, ctx);
  if (!validation.valid) {
    throw new Error(`Deliverable ${id} failed validation: ${validation.errors.join("; ")}`);
  }
  const quality = validateAudienceAndForm(deliverable, ctx, agent.audience, agent.form);
  if (!quality.valid) {
    throw new Error(`Deliverable ${id} failed quality validation: ${quality.errors.join("; ")}`);
  }
  return deliverable;
}
