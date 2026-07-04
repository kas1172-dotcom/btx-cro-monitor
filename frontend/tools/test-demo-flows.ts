import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { processBrainQuestion } from "../src/brain/brainEngine.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";
import { PROFILE } from "../src/app/config.ts";
import { DELIVERABLE_DOWNLOAD_FORMATS } from "../src/deliverables/export.ts";
import { AREA_MARKET_SCOPING, isMarketScopedView } from "../src/app/viewScope.ts";

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
  };
}

const world = await loadWorld();

assert(!world.companies.some((company) => company.name === PROFILE.name), "Client company must not appear as a scored account");
assert(AREA_MARKET_SCOPING.geographic && AREA_MARKET_SCOPING.market, "Map and signal views must be market-scoped");
assert(!AREA_MARKET_SCOPING.revenue && !AREA_MARKET_SCOPING.decision && !AREA_MARKET_SCOPING.customer, "Home, memory, and current business must not be market-scoped");
assert(!isMarketScopedView({ activeBrainArea: "geographic", brainResponse: null, activeDeliverable: { id: "doc" }, activeAnalysisSpec: null }), "Deliverables must hide market dropdown and use all-markets scope");

const questions = [
  ["What defense funding signals should BTX care about?", "market"],
  ["I'm in Austin next week. Who should I talk to?", "geographic"],
  ["Which deals are at risk this quarter?", "revenue"],
  ["What should sales focus on based on what we can actually produce?", "capability"],
  ["What should I care about this week?", "market"],
  ["Who should I meet in San Antonio?", "geographic"],
  ["Show me Houston targets", "geographic"],
  ["What account has the biggest risk?", "revenue"],
  ["Give me a production fit focus", "capability"],
  ["Create a board summary", "revenue"],
  ["Draft a note for the best prospect", "workflow"],
] as const;

for (const [question, expectedArea] of questions) {
  const response = processBrainQuestion(question, world);
  assert(response.directAnswer.length > 0, `${question} returned no answer`);
  assert(response.activatedBrainAreas.includes(expectedArea), `${question} did not activate ${expectedArea}`);
  assert(response.contextUsed.length > 0, `${question} missing context provenance`);
  const responseText = [
    response.directAnswer,
    response.whyThisMatters,
    ...response.recommendedActions,
    ...response.relatedOpportunities.flatMap((card) => [
      card.accountStatus ?? "",
      card.whySurfaced,
      card.topSignal ?? "",
      ...card.scoreBreakdown.map((item) => item.note),
    ]),
  ].join(" ");
  assert(!/\b[a-z]+_[a-z_]+\b/.test(responseText), `${question} leaked snake_case in rendered response text: ${responseText}`);
}

const maxScore = Math.max(...world.analysis.scores.flatMap((score) => Object.values(score.dimensions).map((dimension) => dimension.score)));
assert(maxScore <= 97, `score cap exceeded: ${maxScore}`);

const itinerary = await runAgent("itinerary", { city: "Austin", startDate: "2026-07-07", endDate: "2026-07-09", focus: "mixed" }, world);
assert(itinerary.entityIds.length >= 6, "Austin itinerary has fewer than 6 stops");
assert(itinerary.sources.length > 0, "Austin itinerary missing provenance");
const mapStops = itinerary.sections.flatMap((section) => section.blocks).filter((block) => block.kind === "map-ref").flatMap((block) => block.stops ?? []);
assert(mapStops.every((stop) => !/^\d+\.\s/.test(stop.label)), "Itinerary map labels must not duplicate pin numbers");

const memo = await runAgent("weekly_memo", { title: "Weekly CRO Memo" }, world);
assert(memo.sections.length >= 4, "Weekly memo missing sections");

const outreach = await runAgent("outreach", {}, world);
const instructedOutreach = await runAgent("outreach", { instructions: "Lead with ITAR angle" }, world);
const outreachHeadings = outreach.sections.map((section) => section.heading);
assert(JSON.stringify(outreachHeadings) === JSON.stringify(["Recipient", "Subject", "Body", "Why This Works", "Provenance"]), `Outreach headings corrupted: ${outreachHeadings.join(", ")}`);
assert(!outreachHeadings.some((heading) => ["Day-by-Day Schedule", "Visit Map", "Per-Stop Briefs"].includes(heading)), "Outreach must not render itinerary sections");
assert(DELIVERABLE_DOWNLOAD_FORMATS.outreach.includes("docx") && DELIVERABLE_DOWNLOAD_FORMATS.outreach.includes("pdf"), "Outreach missing Word/PDF downloads");
assert(DELIVERABLE_DOWNLOAD_FORMATS.itinerary.includes("ics"), "Itinerary missing calendar download");
assert(DELIVERABLE_DOWNLOAD_FORMATS.analysis_view.includes("xlsx") && DELIVERABLE_DOWNLOAD_FORMATS.analysis_view.includes("csv"), "Analysis view missing spreadsheet downloads");
assert(DELIVERABLE_DOWNLOAD_FORMATS.board_deck.includes("pptx"), "Board deck missing PPTX download");
assert(instructedOutreach.sources.some((source) => source.source === "user instructions" && source.reason.includes("ITAR")), "Deliverable instructions were not recorded in provenance");
const deliverableText = [itinerary, memo, outreach]
  .flatMap((deliverable) => deliverable.sections)
  .flatMap((section) => section.blocks)
  .map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return block.rows.flat().join(" ");
    if (block.kind === "map-ref") return `${block.title} ${(block.stops ?? []).map((stop) => stop.label).join(" ")}`;
    return block.title;
  })
  .join(" ");
assert(!/\b[a-z]+_[a-z_]+\b/.test(deliverableText), `Rendered deliverables leaked snake_case: ${deliverableText.match(/\b[a-z]+_[a-z_]+\b/)?.[0]}`);

console.log(`demo flows ok: ${questions.length} questions, itinerary ${itinerary.entityIds.length} stops, weekly memo ${memo.sections.length} sections, outreach ${outreach.sections.length} sections`);
