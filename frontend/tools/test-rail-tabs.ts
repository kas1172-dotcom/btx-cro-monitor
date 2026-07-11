import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { buildRailAuditViews, buildRailView, RAIL_AREAS } from "../src/app/railViews.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";
import type { MemoryState } from "../src/memory/types.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
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
    dataSource: null,
    loadErrors: [],
    dataMode: "demo",
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const memory: MemoryState = {
  notes: [],
  deliverables: [],
  activity: [],
};

const world = await loadWorld();
const views = buildRailAuditViews(world, memory);
const names = new Set(world.companies.map((company) => company.name));
const componentIds = new Set<string>();

assert(views.length === 8, `Expected 8 rail views including Home, got ${views.length}`);

for (const view of views) {
  assert(view.componentId !== "", `${view.area} has no component id`);
  assert(!componentIds.has(view.componentId), `${view.area} reuses component ${view.componentId}`);
  componentIds.add(view.componentId);

  if (view.area !== "home") {
    assert(view.componentId !== "home", `${view.area} rendered the Home component`);
  }

  const hasComputedValue = /\d/.test(view.headline);
  const hasEntityName = [...names].some((name) => view.headline.includes(name));
  assert(hasComputedValue || hasEntityName, `${view.area} headline lacks a computed value or entity name: ${view.headline}`);
}

for (const area of RAIL_AREAS) {
  const view = buildRailView(area, world, memory);
  assert(view.total === view.rows.length || area === "geographic", `${area} badge count ${view.total} does not match rendered rows ${view.rows.length}`);
}

const revenue = buildRailView("revenue", world, memory);
assert(revenue.componentId === "rail-revenue", "Revenue must render the pipeline rail view");
assert(revenue.rows.slice(0, 5).every((row) => row.companyId && row.detailTarget === "pipeline"), "Revenue top rows must open account dossiers at pipeline context");

console.log(`rail tabs ok: ${views.map((view) => `${view.area}:${view.componentId}`).join(", ")}`);
