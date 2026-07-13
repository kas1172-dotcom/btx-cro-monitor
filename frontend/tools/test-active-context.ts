import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { activeContextFromState, describeActiveContext } from "../src/app/useActiveContext.ts";
import { processBrainQuestionAsync } from "../src/brain/brainEngine.ts";
import { GROUNDING_CONTRACT } from "../src/app/promptContract.ts";
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
const activeAccount = world.companies.find((company) => company.relationship === "customer") ?? world.companies[0];
assert(Boolean(activeAccount), "expected demo account");

const homeContext = activeContextFromState({
  activeSurface: "brief",
  activeCompanyId: null,
  activeDeliverable: null,
  activeAnalysisSpec: null,
});
const accountContext = activeContextFromState({
  activeSurface: "accounts",
  activeCompanyId: activeAccount.id,
  activeDeliverable: null,
  activeAnalysisSpec: null,
});

assert(homeContext.tabId === "brief", "home context tab mismatch");
assert(accountContext.accountId === activeAccount.id, "account context did not preserve activeCompanyId");
assert(describeActiveContext(accountContext, world).includes(activeAccount.name), "context description did not name active account");
assert(GROUNDING_CONTRACT.includes("Chief Revenue Officer"), "prompt contract missing CRO audience framing");
assert(GROUNDING_CONTRACT.includes("grow defense revenue"), "prompt contract missing BTX mission/goals");

const question = "What should I do next?";
const homeAnswer = await processBrainQuestionAsync(question, world, homeContext);
const accountAnswer = await processBrainQuestionAsync(question, world, accountContext);

assert(!homeAnswer.directAnswer.includes(`${activeAccount.name} is the active account`), "home answer should not claim active account context");
assert(accountAnswer.directAnswer.includes(`${activeAccount.name} is the active account`), "account answer did not use active account context");
assert(homeAnswer.directAnswer !== accountAnswer.directAnswer, "home and account-context answers should differ");
assert(accountAnswer.contextUsed.some((source) => source.source === "active cockpit context"), "active context should be cited as a source");

console.log(`active context ok: Home and ${activeAccount.name} Dossier produce distinct grounded answers`);
