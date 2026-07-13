import React from "react";
import { renderToString } from "react-dom/server";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { ALL_SURFACES, countForSurface } from "../src/app/surfaces.ts";
import { ProspectDetail } from "../src/ui/prospecting/ProspectDetail.tsx";
import { industryUpdatesForProspects, prospectCompaniesForWorld, prospectRowsForWorld } from "../src/ui/prospecting/prospectingModel.ts";
import { Prospecting } from "../src/ui/surfaces/Prospecting.tsx";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

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

const world = await loadWorld();
const prospects = prospectCompaniesForWorld(world);
const rows = prospectRowsForWorld(world);
const updates = industryUpdatesForProspects(world);

assert(prospects.length > 0, "Demo data should include prospecting accounts.");
assert(prospects.every((company) => company.business_motion === "prospect_new_business"), "Prospecting tab must only contain prospect_new_business accounts.");
assert(!prospects.some((company) => ["manage_current_business", "grow_existing_business", "reduce_risk"].includes(company.business_motion ?? "")), "Prospecting tab must exclude current-business motions.");
assert(rows.length === prospects.length, "Every prospect account should have one ranked row.");
assert(rows[0].relationship || rows[0].topSignal, "Top prospect should carry resolver-backed or signal-backed confidence detail.");
assert(updates.length > 0, "Industry updates should include prospect-relevant program or contract signals.");
assert(countForSurface("prospecting", world, null) === prospects.length, "Prospecting badge count should match prospect-motion scope.");
assert(ALL_SURFACES.find((surface) => surface.id === "prospecting")?.componentId === "surface-prospecting", "Prospecting must be registered as a surface.");

const detailHtml = renderToString(
  <ProspectDetail
    world={world}
    row={rows[0]}
    hasGenerated={false}
    onGenerate={() => undefined}
    onNavigateDeliverables={() => undefined}
  />,
);
assert(detailHtml.includes("Why this ranks here"), "Prospect detail should expose the collapsed why-ranked expansion.");
assert(detailHtml.includes("See more"), "Prospect detail should expose a separate see-more expansion.");
assert(!detailHtml.includes("data-prospect-expanded=\"why\""), "Why-ranked detail must be collapsed by default.");
if (rows[0].topSignal?.source_quote) {
  assert(!detailHtml.includes(rows[0].topSignal.source_quote), "Collapsed prospect detail must not render evidence text by default.");
}

const surfaceHtml = renderToString(<Prospecting world={world} />);
assert(surfaceHtml.includes("surface-prospecting"), "Prospecting surface should render its component id.");
assert(surfaceHtml.includes("Industry updates"), "Prospecting surface should render industry updates.");
assert(surfaceHtml.includes("Ranked prospects"), "Prospecting surface should render ranked prospects.");
assert((surfaceHtml.match(/class=\"prospecting-list-row/g) ?? []).length <= 20, "Prospecting list should cap initial rows at 20.");
for (const row of rows.slice(0, 5)) {
  if (row.topSignal?.source_quote) {
    const rowStart = surfaceHtml.indexOf(row.company.name);
    const rowEnd = surfaceHtml.indexOf("</button>", rowStart);
    const rowHtml = rowStart >= 0 && rowEnd >= 0 ? surfaceHtml.slice(rowStart, rowEnd) : "";
    assert(!rowHtml.includes(row.topSignal.source_quote), `Prospecting row for ${row.company.name} should not render evidence text.`);
  }
}

console.log(`prospecting surface ok: ${rows.length} prospects, ${updates.length} updates`);
