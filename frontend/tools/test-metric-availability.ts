import { parseLlmComposeText } from "../src/agents/llmCompose.ts";
import { computeMetric } from "../src/metrics/catalog.ts";
import { assessDeliverableQuality, invalidateLegacyDeliverable } from "../src/deliverables/quality.ts";
import type { World } from "../src/app/useWorld.ts";
import type { Deliverable } from "../src/deliverables/types.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const emptyWorld = {
  opportunities: [],
  sources: [],
  analysis: { scores: [] },
  worldSnapshot: null,
} as unknown as World;
assert(computeMetric("pipeline_by_stage", emptyWorld).state === "unavailable", "Empty pipeline must be unavailable, not zero.");

const zeroWorld = {
  ...emptyWorld,
  opportunities: [{ id: "zero-deal", stage: "qualified", value: 0 }],
} as unknown as World;
const zero = computeMetric("pipeline_by_stage", zeroWorld);
assert(zero.state === "available" && zero.value === 0, "A sourced zero must remain an available real value.");

const base: Deliverable = {
  id: "d1",
  type: "weekly_memo",
  title: "Test",
  createdAt: "2026-07-27T00:00:00Z",
  brainArea: "analysis",
  entityIds: [],
  sections: [{ id: "summary", heading: "Summary", blocks: [{ kind: "text", text: "Demand is strong and capacity is available." }] }],
  sources: [],
  confidence: "low",
  actions: [],
};
const partial = assessDeliverableQuality(base, {
  facts: {},
  entityIds: [],
  sources: [],
  metricStates: {
    pipeline_by_stage: computeMetric("pipeline_by_stage", emptyWorld),
    capacity_utilization: computeMetric("capacity_utilization", emptyWorld),
  },
});
assert(!partial.valid && !partial.dataAvailable, "Partial datasets must block unsupported demand and capacity conclusions.");

const missingDisclosure = assessDeliverableQuality(
  { ...base, sections: [{ id: "missing", heading: "Missing", blocks: [{ kind: "text", text: "Missing required inputs: Margin trend: no approved revenue records were available." }] }] },
  {
    facts: {},
    entityIds: [],
    sources: [],
    metricStates: {
      margin_trend: computeMetric("margin_trend", emptyWorld),
    },
  },
);
assert(missingDisclosure.valid, "Missing-data disclosure must not be treated as an unsupported margin conclusion.");

const inventedMargin = assessDeliverableQuality(
  { ...base, sections: [{ id: "margin", heading: "Margin", blocks: [{ kind: "text", text: "Margin is improving." }] }] },
  {
    facts: {},
    entityIds: [],
    sources: [],
    metricStates: {
      margin_trend: computeMetric("margin_trend", emptyWorld),
    },
  },
);
assert(!inventedMargin.valid && inventedMargin.errors.some((error) => error.includes("margin conclusion")), "Unsupported margin conclusions must still fail.");

const contradictory = assessDeliverableQuality(
  { ...base, sections: [{ id: "missing", heading: "Missing", blocks: [{ kind: "text", text: "Required sections are unavailable." }] }] },
  {
    facts: {},
    entityIds: [],
    sources: [
      { source: "ERP", records: ["capacity-1"], reason: "Capacity source unavailable." },
      { source: "ERP", records: ["capacity-1"], reason: "Capacity source verified and available." },
    ],
  },
);
assert(!contradictory.valid && contradictory.errors.some((error) => error.includes("Contradictory")), "Contradictory source status must fail quality validation.");

assert(!parseLlmComposeText("not json").ok, "LLM parse failure must be explicit.");
assert(!parseLlmComposeText('{"sections":[{"id":4}]}').ok, "Malformed LLM sections must fail the contract.");

const invalidated = invalidateLegacyDeliverable({ ...base, title: "Q2 2026 Revenue Review" });
assert(Boolean(invalidated.invalidatedAt) && invalidated.quality?.valid === false, "Affected Q2 review must be invalidated.");

console.log("metric availability ok: empty, partial, parse failure, real zero, contradiction, and legacy invalidation covered");
