import React from "react";
import { renderToString } from "react-dom/server";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { deriveWorkItems } from "../src/app/workItems.ts";
import { ALL_SURFACES, countForSurface } from "../src/app/surfaces.ts";
import { deadlinesForAccounts, DeadlinesPanel } from "../src/ui/clients/DeadlinesPanel.tsx";
import { Account360, clientCompaniesForAccount360 } from "../src/ui/surfaces/Account360.tsx";
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
const clients = clientCompaniesForAccount360(world.companies);
const prospects = world.companies.filter((company) => company.business_motion === "prospect_new_business");

assert(clients.length > 0, "Demo world should have client accounts.");
assert(prospects.length > 0, "Demo world should have pure prospect accounts for the filter guard.");
assert(clients.every((company) => company.business_motion !== "prospect_new_business"), "Clients tab must exclude pure prospecting accounts.");
assert(countForSurface("accounts", world, null) === clients.length, "Clients badge count should use the same motion-based scope.");
assert(ALL_SURFACES.find((surface) => surface.id === "accounts")?.label === "Clients", "Accounts surface should be labeled Clients.");

const deadlines = deadlinesForAccounts(clients, world.opportunities, deriveWorkItems(world), new Date("2026-07-13T12:00:00Z"));
assert(deadlines.length > 0, "Clients deadlines should be non-empty for demo data.");
for (let index = 1; index < deadlines.length; index += 1) {
  assert(new Date(deadlines[index - 1].date).getTime() <= new Date(deadlines[index].date).getTime(), "Deadlines must be sorted ascending by date.");
}
assert(deadlines.some((deadline) => deadline.type === "contract renewal"), "Deadlines should include contract renewal dates from opportunities.");
assert(deadlines.some((deadline) => deadline.type === "task due"), "Deadlines should include task due dates from work items.");

const deadlinesHtml = renderToString(<DeadlinesPanel deadlines={deadlines.slice(0, 5)} />);
assert(deadlinesHtml.includes("Upcoming deadlines"), "Deadlines panel should render its heading.");
assert(deadlinesHtml.includes(deadlines[0].accountName), "Deadlines panel should render account names.");
assert(deadlinesHtml.includes(deadlines[0].type), "Deadlines panel should render deadline types.");

const accountHtml = renderToString(<Account360 world={world} />);
assert(accountHtml.includes("Clients / Account 360"), "Account360 should render as the Clients surface.");
assert(accountHtml.includes("Upcoming deadlines"), "Account360 should include the deadlines panel.");
assert(accountHtml.includes("Generate deliverable"), "Clients surface should expose the shared deliverable wizard entry point.");

console.log(`clients surface ok: ${clients.length} clients, ${deadlines.length} deadlines`);
