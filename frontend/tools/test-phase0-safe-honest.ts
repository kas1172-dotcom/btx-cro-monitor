import { backendHeaders } from "../src/app/backendApi.ts";
import { applyScoringConfig, CONFIG, subscribeScoringConfig } from "../src/app/config.ts";
import { defaultTripWindow, latestCompletedQuarter, quarterOptions, sixMonthTrendRangeForQuarter, calendarStartFromDeliverable } from "../src/app/dateDefaults.ts";
import { requestSectionRevision } from "../src/deliverables/editorAssistant.ts";
import { buildArtifactSignals } from "../src/adapters/artifact/artifactSignals.ts";
import { PORTFOLIO_SIGNAL_SUBJECT_ID } from "../src/engine/signals/contract.ts";
import { analyze } from "../src/app/intelligence.ts";
import defaultWeights from "../data/config/scoring-weights.v1.json";
import type { Company } from "../src/engine/brain/entities.ts";
import type { WeightsConfig } from "../src/engine/decision/weights.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function artifactRun(item: Record<string, unknown>): Record<string, unknown> {
  return {
    meta: { run_id: "phase0", run_at: "2026-07-08T12:00:00Z" },
    items: [{
      item_id: "phase0-item",
      raw_title: "Phase 0 item",
      title: "Phase 0 item",
      source_id: "Phase 0 Fixture",
      published_at: "2026-07-08T10:00:00Z",
      per_edition: { bd: { relevance_score: 90, so_what: "", now_what: "", categories: ["Contract Award"] } },
      entities: [],
      ...item,
    }],
  };
}

const companies: Company[] = [
  {
    id: "boeing",
    name: "Boeing",
    relationship: "target",
    account_status: "target_prospect",
    business_motion: "prospect_new_business",
    location: { city: "Pittsburgh", state: "PA", lat: 40, lon: -80, country: "USA" },
    website_url: "https://boeing.example",
    needs: ["AS9100", "spacecraft platform"],
  },
  {
    id: "acme",
    name: "Acme Components",
    relationship: "customer",
    account_status: "current_customer",
    business_motion: "grow_existing_business",
    location: { city: "Pittsburgh", state: "PA", lat: 40, lon: -80, country: "USA" },
    website_url: "https://acme.example",
    needs: ["titanium"],
  },
];

const originalConfig = structuredClone(CONFIG) as WeightsConfig;

try {
  const headers = backendHeaders({ "content-type": "application/json" });
  assert(headers["content-type"] === "application/json", "backendHeaders should preserve caller headers");
  assert(!("authorization" in headers) && !("Authorization" in headers), "browser backend helper must not emit a shared bearer token");

  const related = buildArtifactSignals(artifactRun({
    item_id: "boeing-related",
    raw_title: "Boeing spacecraft platform award",
    per_edition: { bd: { relevance_score: 90, so_what: "Boeing spacecraft platform work needs AS9100 machining.", now_what: "Track RFQ timing.", categories: ["Contract Award"] } },
    entities: [{ name: "Boeing" }],
  }), companies).signals[0];
  assert(related.subject_id === "boeing", `related artifact linked to ${related.subject_id}`);
  assert(related.scope === "account", "related artifact should be account-scoped");

  const unrelated = buildArtifactSignals(artifactRun({
    item_id: "unrelated",
    raw_title: "Cloud software award",
    per_edition: { bd: { relevance_score: 90, so_what: "A cloud analytics office awarded enterprise software support.", now_what: "Monitor market context.", categories: ["Contract Award"] } },
    entities: [{ name: "Cloud Office" }],
  }), companies).signals[0];
  assert(unrelated.subject_id === PORTFOLIO_SIGNAL_SUBJECT_ID, `unrelated artifact linked to ${unrelated.subject_id}`);
  assert(unrelated.scope === "unlinked", "unrelated artifact should be unlinked market context");
  const baseline = analyze(companies, []);
  const withUnrelated = analyze(companies, [unrelated]);
  for (const score of baseline.scores) {
    const next = withUnrelated.byId.get(score.subject_id);
    assert(JSON.stringify(next?.dimensions) === JSON.stringify(score.dimensions), `unlinked signal changed score for ${score.subject_id}`);
  }

  let versionEvents = 0;
  const unsubscribe = subscribeScoringConfig(() => { versionEvents += 1; });
  const signal = {
    id: "weight-test",
    event_type: "government_contract_award",
    entities: ["Boeing"],
    subject_id: "boeing",
    scope: "account" as const,
    confidence: 0.95,
    source_quote: "Boeing award",
    detected_at: "2026-07-08T10:00:00Z",
  };
  const before = analyze(companies, [signal]).byId.get("boeing")?.dimensions.opportunity.score ?? 0;
  applyScoringConfig({
    ...structuredClone(CONFIG),
    weights: {
      ...structuredClone(CONFIG.weights),
      government_contract_award: { ...CONFIG.weights.government_contract_award, opportunity: (CONFIG.weights.government_contract_award.opportunity ?? 0) + 10 },
    },
  });
  const after = analyze(companies, [signal]).byId.get("boeing")?.dimensions.opportunity.score ?? 0;
  unsubscribe();
  assert(after > before, `expected weight edit to change score (${before} -> ${after})`);
  assert(versionEvents === 1, `expected one config-version notification, got ${versionEvents}`);

  const trip = defaultTripWindow(new Date("2026-07-08T12:00:00Z"));
  assert(trip.startDate === "2026-07-09" && trip.endDate === "2026-07-11", `bad trip defaults ${JSON.stringify(trip)}`);
  assert(latestCompletedQuarter(new Date("2026-07-11T00:00:00Z")) === "Q2 2026", "latest completed quarter should use previous quarter");
  assert(JSON.stringify(quarterOptions(new Date("2026-07-11T00:00:00Z"))) === JSON.stringify(["Q2 2026", "Q1 2026", "Q4 2025"]), "quarter options should be rolling");
  assert(JSON.stringify(sixMonthTrendRangeForQuarter("Q2 2026")) === JSON.stringify({ from: "2026-01", to: "2026-06" }), "six-month trend range mismatch");
  assert(calendarStartFromDeliverable("2026-08-05T16:30:00Z").toISOString() === "2026-08-05T09:00:00.000Z", "calendar export should use deliverable date");

  let capturedHeaders: HeadersInit | undefined;
  const revision = await requestSectionRevision({
    endpoint: "https://backend.example/llm",
    deliverable: { title: "Brief", audience: "internal", form: "brief" },
    section: { id: "overview", heading: "Overview", blocks: [{ kind: "text", text: "Original" }] },
    instruction: "tighten",
    fetchImpl: (async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ text: "Revised text" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  assert(revision === "Revised text", "editor helper did not return revised text");
  assert(JSON.stringify(capturedHeaders).includes("content-type"), "editor helper did not use shared headers");
  assert(!JSON.stringify(capturedHeaders).toLowerCase().includes("authorization"), "editor helper emitted authorization header");
  let failed = false;
  try {
    await requestSectionRevision({
      endpoint: "https://backend.example/llm",
      deliverable: { title: "Brief", audience: "internal", form: "brief" },
      section: { id: "overview", heading: "Overview", blocks: [{ kind: "text", text: "Original" }] },
      instruction: "tighten",
      fetchImpl: (async () => new Response("nope", { status: 502 })) as typeof fetch,
    });
  } catch (error) {
    failed = error instanceof Error && error.message.includes("502") && !error.message.includes("Original");
  }
  assert(failed, "editor helper should surface HTTP failures without substituting original text");

  const llmConfig = await import("../src/app/llmConfig.ts");
  assert(Boolean(llmConfig.LLM_MODELS.chatpil && llmConfig.LLM_MODELS.composition), "llmConfig did not load under tsx");
} finally {
  applyScoringConfig(originalConfig);
}

console.log("phase0 safe/honest regressions ok");
