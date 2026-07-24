import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import { METRICS, computeMetric } from "../src/metrics/catalog.ts";
import { computeChart } from "../src/metrics/chartSpec.ts";
import { quarterWindow } from "../src/metrics/time.ts";
import { scoreFit } from "../src/engine/decision/fit.ts";
import { PROFILE } from "../src/app/config.ts";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";
import type { ChartSpec, MetricId } from "../src/metrics/types.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function valueIsNullOrFinite(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

async function loadWorld(): Promise<World> {
  const adapter = new DemoDataAdapter();
  const [companies, rawSignals, contacts, facilities, opportunities, snapshot] = await Promise.all([
    adapter.getCompanies(),
    adapter.getSignals(),
    adapter.getContacts(),
    adapter.getFacilities(),
    adapter.getOpportunities(),
    adapter.getOperatingSnapshot(),
  ]);
  const newsSignals = deriveNewsSignals(companies, newsData as MarketEvent[], extractedData as ExtractedRow[]);
  const analysis = analyze(companies, [...rawSignals, ...newsSignals]);
  return {
    city: null,
    companies,
    contacts,
    facilities,
    opportunities,
    analysis,
    prospects: buildProspects(companies, contacts, analysis.valid, analysis.byId),
    snapshot,
    worldSnapshot: null,
    dataSource: null,
    loadErrors: [],
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const specs: ChartSpec[] = [
  { viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter" },
  { viz: "trend", metric: "bookings" },
  { viz: "ranked_bar", metric: "revenue", rows: "account" },
  { viz: "retention_grid", metric: "repeat_revenue_rate", rows: "account", cols: "month" },
];

const world = await loadWorld();
const metricIds = Object.keys(METRICS) as MetricId[];
assert(metricIds.length === 14, `expected 14 metrics, got ${metricIds.length}`);

for (const id of metricIds) {
  const result = computeMetric(id, world, undefined, quarterWindow("Q2 2026"));
  assert(valueIsNullOrFinite(result.value), `${id} produced an invalid value`);
  assert(result.provenance.length > 0, `${id} missing provenance`);
}

const pipelineByStage = computeMetric("pipeline_by_stage", world).value;
const expectedPipeline = world.opportunities
  .filter((opp) => opp.stage !== "won" && opp.stage !== "lost")
  .reduce((sum, opp) => sum + (opp.value ?? 0), 0);
assert(pipelineByStage === expectedPipeline, `pipeline_by_stage ${pipelineByStage} != expected ${expectedPipeline}`);

for (const id of ["revenue", "bookings", "backlog", "capacity_utilization"] as const) {
  assert(computeMetric(id, world, undefined, quarterWindow("Q2 2026")).value === null, `${id} should stay unavailable without operating data`);
}

for (const spec of specs) {
  const result = computeChart(spec, world);
  assert(result.provenance.length > 0, `${spec.viz} missing provenance`);
  assert(Boolean(result.grid || result.series), `${spec.viz} produced no result shell`);
}

const fitScores = world.prospects.map((p) => scoreFit(p.company.needs, PROFILE.capabilities).score);
const perfectFits = fitScores.filter((score) => score > 90).length;
assert(perfectFits <= 2, `too many >90 fit scores: ${perfectFits}`);
assert(Math.min(...fitScores) <= 50 && Math.max(...fitScores) >= 75, "fit score distribution is too narrow");

console.log(`metrics ok: ${metricIds.length} metrics handle unavailable operating data and live pipeline values`);
