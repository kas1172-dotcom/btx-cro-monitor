import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

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
    dataSource: null,
    loadErrors: [],
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const world = await loadWorld();
const topCustomer = world.prospects.find((p) => p.company.relationship === "customer")?.company.id ?? world.prospects[0]?.company.id;
if (!topCustomer) throw new Error("No account available for sample library");

const samples = [
  await runAgent("board_deck", { quarter: "Q2 2026", audience: "board" }, world),
  await runAgent("itinerary", { city: "Austin", startDate: "2026-07-07", endDate: "2026-07-09", focus: "mixed" }, world),
  await runAgent("meeting_brief", { accountId: topCustomer }, world),
  await runAgent("capabilities_assessment", { accountId: topCustomer }, world),
  await runAgent("sales_pitch", { accountId: topCustomer }, world),
  await runAgent("weekly_memo", { title: "Week of 2026-06-29" }, world),
  await runAgent("outreach", {}, world),
  await runAgent("analysis_annotation", { metric: "revenue", quarter: "Q2 2026" }, world),
  {
    id: "sample-analysis-revenue-heatmap",
    type: "analysis_view",
    title: "Revenue Heatmap by Account and Quarter",
    createdAt: new Date("2026-07-03T12:00:00Z").toISOString(),
    brainArea: "analysis",
    entityIds: world.companies.filter((c) => c.relationship === "customer").map((c) => c.id),
    confidence: "high",
    sections: [{ id: "spec", heading: "Analysis Spec", blocks: [{ kind: "chart-spec", title: "Revenue by account by quarter", spec: { viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter", color: "revenue_yoy_change" } }] }],
    sources: [{ source: "account_monthly_revenue.json", records: ["24-month revenue history"], reason: "Seeded analysis view generated from the metric chart-spec engine." }],
    actions: [{ id: "open", label: "Open", kind: "copy" }],
  },
  {
    id: "sample-analysis-retention-grid",
    type: "analysis_view",
    title: "Repeat Revenue Retention Grid",
    createdAt: new Date("2026-07-03T12:00:00Z").toISOString(),
    brainArea: "analysis",
    entityIds: world.companies.filter((c) => c.relationship === "customer").map((c) => c.id),
    confidence: "high",
    sections: [{ id: "spec", heading: "Analysis Spec", blocks: [{ kind: "chart-spec", title: "Repeat revenue grid", spec: { viz: "retention_grid", metric: "repeat_revenue_rate", rows: "account", cols: "month" } }] }],
    sources: [{ source: "account_monthly_revenue.json", records: ["24-month revenue history"], reason: "Seeded analysis view generated from the metric chart-spec engine." }],
    actions: [{ id: "open", label: "Open", kind: "copy" }],
  },
];

writeFileSync(join(process.cwd(), "data/demo/btx/sample_library.json"), `${JSON.stringify(samples, null, 2)}\n`);
console.log(`generated sample library with ${samples.length} deliverables`);
