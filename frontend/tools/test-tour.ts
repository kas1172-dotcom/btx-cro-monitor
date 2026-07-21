import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { executeTourStep, TOUR_STEPS } from "../src/tour/tourSteps.ts";
import { getState, resetUiState } from "../src/store/store.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function loadWorld(city: string | null = null): Promise<World> {
  const adapter = new DemoDataAdapter();
  const filter = city ? { city } : undefined;
  const [companies, rawSignals, contacts, facilities, opportunities, snapshot] = await Promise.all([
    adapter.getCompanies(filter),
    adapter.getSignals(filter),
    adapter.getContacts(filter),
    adapter.getFacilities(filter),
    adapter.getOpportunities(filter),
    adapter.getOperatingSnapshot(),
  ]);
  const newsSignals = deriveNewsSignals(companies, newsData as MarketEvent[], extractedData as ExtractedRow[]);
  const analysis = analyze(companies, [...rawSignals, ...newsSignals]);
  return {
    city,
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
resetUiState();

for (const [index, step] of TOUR_STEPS.entries()) {
  await executeTourStep(step, world);
  const state = getState();
  if (step.completion === "deliverable") {
    assert(state.activeDeliverable !== null, `Step ${index + 1} did not open a deliverable`);
  } else if (step.completion === "analysis") {
    assert(state.activeAnalysisSpec !== null, `Step ${index + 1} did not open an analysis view`);
  } else if (step.completion === "dossier" || step.completion === "hold") {
    assert(state.activeCompanyId !== null, `Step ${index + 1} did not open a dossier`);
  } else if (step.completion === "home") {
    assert(state.activeHome && !state.brainResponse && !state.activeDeliverable && !state.activeAnalysisSpec && !state.activeCompanyId, `Step ${index + 1} did not return home`);
  } else {
    assert(state.brainResponse !== null, `Step ${index + 1} did not produce a brain response`);
  }
}

console.log(`tour ok: ${TOUR_STEPS.length} steps completed through shared brain actions`);
