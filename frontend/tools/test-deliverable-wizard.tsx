import React from "react";
import { renderToString } from "react-dom/server";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { DELIVERABLE_AGENT_OPTIONS } from "../src/agents/deliverableRegistry.ts";
import { Dossier } from "../src/ui/company/Dossier.tsx";
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

const expectedAgentIds = [
  "meeting_brief",
  "weekly_memo",
  "board_deck",
  "itinerary",
  "outreach",
  "analysis_annotation",
  "sales_pitch",
  "capabilities_assessment",
];

const registeredIds = DELIVERABLE_AGENT_OPTIONS.map((option) => option.id);
assert(registeredIds.join(",") === expectedAgentIds.join(","), "Deliverable wizard registry must cover the existing eight agent ids in order.");
assert(new Set(registeredIds).size === registeredIds.length, "Deliverable wizard registry must not duplicate agent ids.");

const world = await loadWorld();
const companyId = world.prospects[0]?.company.id ?? world.companies[0]?.id;
assert(companyId, "Fixture world needs at least one company.");

const html = renderToString(<Dossier world={world} companyId={companyId} />);
assert(html.includes("Generate deliverable"), "Dossier must render the shared deliverable wizard entry point.");
assert(!html.includes("Creating..."), "Dossier should not use direct per-agent creation state.");

console.log(`deliverable wizard ok: ${registeredIds.length} agent types, Dossier wizard entry mounted`);
