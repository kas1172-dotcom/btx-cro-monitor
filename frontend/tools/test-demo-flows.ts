import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { processBrainQuestion } from "../src/brain/brainEngine.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import miniRunOutput from "../data/test/artifacts/mini-run_output.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";
import { PROFILE } from "../src/app/config.ts";
import { DELIVERABLE_DOWNLOAD_FORMATS } from "../src/deliverables/export.ts";
import { AREA_MARKET_SCOPING, isMarketScopedView } from "../src/app/viewScope.ts";
import { buildArtifactSignals } from "../src/adapters/artifact/artifactSignals.ts";
import { provenanceCounts, provenanceSummary } from "../src/app/provenance.ts";

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
    dataMode: "demo",
    provenanceSources: [],
    provenanceSummary: null,
  };
}

async function loadArtifactFixtureWorld(): Promise<World> {
  const adapter = new DemoDataAdapter();
  const [demoCompanies, contacts, facilities, opportunities, snapshot] = await Promise.all([
    adapter.getCompanies(),
    adapter.getContacts(),
    adapter.getFacilities(),
    adapter.getOpportunities(),
    adapter.getOperatingSnapshot(),
  ]);
  const companies = [...demoCompanies, {
    id: "fixture-boeing",
    name: "Boeing",
    relationship: "target" as const,
    account_status: "target_prospect" as const,
    business_motion: "prospect_new_business" as const,
    location: { city: "Pittsburgh", state: "PA", lat: 40.44, lon: -79.99, country: "USA" },
    website_url: "https://boeing.com",
    domains: ["boeing.com"],
    aliases: ["Boeing", "The Boeing Company"],
    known_programs: ["MUOS"],
    needs: ["AS9100", "precision machining"],
  }];
  const artifact = buildArtifactSignals(miniRunOutput, companies);
  assert(artifact.signals.length === 1, `Expected 1 artifact signal, got ${artifact.signals.length}`);
  const signal = artifact.signals[0];
  assert(signal.artifact?.source_name === "SpaceNews Mini", "Artifact source name was not preserved");
  assert(signal.artifact?.source_date.startsWith("2026-07-08"), "Artifact source date was not preserved");
  assert(signal.artifact?.dollar_figures.includes(250000000), "Artifact dollar figure was not preserved");
  assert(signal.source_url === "https://example.com/boeing-muos", "Artifact source URL was not mapped");
  const analysis = analyze(companies, artifact.signals);
  const world: World = {
    city: null,
    companies,
    contacts,
    facilities,
    opportunities,
    analysis,
    prospects: buildProspects(companies, contacts, analysis.valid, analysis.byId),
    snapshot: {
      ...snapshot,
      publicSignals: {
        signal_count: artifact.signals.length,
        news_count: artifact.signals.length,
        latest_signal_at: artifact.latestPublishedAt,
        latest_news_date: artifact.latestPublishedAt,
        source_name: "Monitor engine artifacts (fixture)",
        source_mode: "artifact",
        run_at: artifact.runAt,
        archive_run_count: 0,
        artifact_path: "frontend/data/test/artifacts/mini-run_output.json",
        stale: false,
        notice: null,
      },
    },
    dataSource: null,
    loadErrors: [],
    dataMode: "artifact",
    provenanceSources: [],
    provenanceSummary: null,
  };
  return world;
}

async function loadHybridFixtureWorld(): Promise<World> {
  const demo = new DemoDataAdapter();
  const [facilities, demoSnapshot] = await Promise.all([
    demo.getFacilities(),
    demo.getOperatingSnapshot(),
  ]);
  const companies = [{
    id: "hubspot-company-9001",
    name: "Boeing",
    canonical_account_id: "hubspot-company-9001",
    hubspot_company_id: "9001",
    relationship: "customer" as const,
    account_status: "active_pipeline" as const,
    business_motion: "grow_existing_business" as const,
    location: { city: "Pittsburgh", state: "PA", lat: 40.44, lon: -79.99, country: "USA" },
    website_url: "https://boeing.com",
    domains: ["boeing.com"],
    aliases: ["Boeing", "The Boeing Company"],
    known_programs: ["MUOS"],
    needs: ["ITAR", "precision machining"],
    data_provenance: "HubSpot",
    source_name: "HubSpot",
    source_mode: "live",
  }];
  const artifact = buildArtifactSignals(miniRunOutput, companies);
  const contacts = [{
    id: "hubspot-contact-9002",
    company_id: "hubspot-company-9001",
    name: "Riley Buyer",
    title: "Procurement Director",
    data_provenance: "HubSpot",
    source_name: "HubSpot",
    source_mode: "live",
  }];
  const opportunities = [{
    id: "hubspot-deal-9003",
    company_id: "hubspot-company-9001",
    name: "Prototype machining package",
    value: 250000,
    stage: "qualified" as const,
    close_date: "2026-09-30",
    data_provenance: "HubSpot",
    source_name: "HubSpot",
    source_mode: "live",
  }];
  const analysis = analyze(companies, artifact.signals);
  const world: World = {
    city: null,
    companies,
    contacts,
    facilities,
    opportunities,
    analysis,
    prospects: buildProspects(companies, contacts, analysis.valid, analysis.byId),
    snapshot: {
      ...demoSnapshot,
      publicSignals: {
        signal_count: artifact.signals.length,
        news_count: artifact.signals.length,
        latest_signal_at: artifact.latestPublishedAt,
        latest_news_date: artifact.latestPublishedAt,
        source_name: "Monitor engine artifacts (fixture)",
        source_mode: "artifact",
        run_at: artifact.runAt,
        archive_run_count: 0,
        artifact_path: "frontend/data/test/artifacts/mini-run_output.json",
        stale: false,
        notice: null,
      },
    },
    dataSource: null,
    loadErrors: [],
    dataMode: "hybrid",
    provenanceSources: [],
    provenanceSummary: null,
  };
  world.provenanceSources = provenanceCounts(world);
  world.provenanceSummary = provenanceSummary(world);
  return world;
}

const world = await loadWorld();
const artifactWorld = await loadArtifactFixtureWorld();
const hybridWorld = await loadHybridFixtureWorld();

assert(!world.companies.some((company) => company.name === PROFILE.name), "Client company must not appear as a scored account");
assert(AREA_MARKET_SCOPING.map && AREA_MARKET_SCOPING.trip_planner && AREA_MARKET_SCOPING.programs, "Map, Trip Planner, and program views must be market-scoped");
assert(!AREA_MARKET_SCOPING.analysis && !AREA_MARKET_SCOPING.settings && !AREA_MARKET_SCOPING.accounts, "Analysis, settings, and accounts must not be market-scoped");
assert(!isMarketScopedView({ activeTab: "map", brainResponse: null, activeDeliverable: { id: "doc" }, activeAnalysisSpec: null }), "Deliverables must hide market dropdown and use all-markets scope");

const questions = [
  ["What defense funding signals should BTX care about?", "programs"],
  ["I'm in Austin next week. Who should I talk to?", "map"],
  ["Which deals are at risk this quarter?", "analysis"],
  ["What should sales focus on based on what we can actually produce?", "capacity"],
  ["What should I care about this week?", "brief"],
  ["Who should I meet in San Antonio?", "map"],
  ["Show me Houston targets", "map"],
  ["What account has the biggest risk?", "analysis"],
  ["Give me a production fit focus", "capacity"],
  ["Create a board summary", "analysis"],
  ["Draft a note for the best prospect", "work_queue"],
] as const;

for (const [question, expectedArea] of questions) {
  const response = processBrainQuestion(question, world);
  assert(response.directAnswer.length > 0, `${question} returned no answer`);
  assert(response.activatedTabs.includes(expectedArea), `${question} did not activate ${expectedArea}`);
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
assert(itinerary.brainArea === "trip_planner", "Itinerary must belong to the Trip Planner tab.");
const mapStops = itinerary.sections.flatMap((section) => section.blocks).filter((block) => block.kind === "map-ref").flatMap((block) => block.stops ?? []);
assert(mapStops.every((stop) => !/^\d+\.\s/.test(stop.label)), "Itinerary map labels must not duplicate pin numbers");
const firstStopBrief = await runAgent("meeting_brief", { accountId: itinerary.entityIds[0] }, world);
const tripBrief = await runAgent("trip_brief", { itinerary, meetingBriefs: [firstStopBrief], logistics: "Confirm meeting owners before departure." }, world);
assert(tripBrief.brainArea === "trip_planner" && tripBrief.sections.some((section) => section.id === "itinerary-logistics"), "Trip brief must compile itinerary logistics.");

const analysisAnnotation = await runAgent("analysis_annotation", { metric: "revenue", quarter: "Q2 2026", instructions: "Annotate the saved heatmap figure." }, world);
assert(analysisAnnotation.type === "analysis_view" && analysisAnnotation.brainArea === "analysis", "Analysis annotation must save as an analysis deliverable.");

const memo = await runAgent("weekly_memo", { title: "Weekly CRO Memo" }, world);
assert(memo.sections.length >= 4, "Weekly memo missing sections");

const artifactSignal = artifactWorld.analysis.valid[0];
const artifactBrief = await runAgent("meeting_brief", { accountId: artifactSignal.subject_id }, artifactWorld);
const artifactBriefText = artifactBrief.sections
  .flatMap((section) => section.blocks)
  .map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return block.rows.flat().join(" ");
    return block.title;
  })
  .join(" ");
assert(artifactBriefText.includes("SpaceNews Mini") && artifactBriefText.includes("2026-07-08"), "Artifact meeting brief missing real-signal source/date citation");

const hybridBrief = await runAgent("meeting_brief", { accountId: "hubspot-company-9001" }, hybridWorld);
const hybridBriefText = hybridBrief.sections
  .flatMap((section) => section.blocks)
  .map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return block.rows.flat().join(" ");
    return block.title;
  })
  .join(" ");
assert(hybridBriefText.includes("Boeing") && hybridBrief.sources.some((source) => source.source === "CRM"), "Hybrid meeting brief missing real CRM account grounding");
assert(hybridBriefText.includes("SpaceNews Mini") && hybridBrief.sources.some((source) => source.source === "monitor-engine artifacts"), "Hybrid meeting brief missing real monitor signal grounding");
assert(hybridBriefText.includes("Demo fallback") || hybridBrief.sources.some((source) => source.source === "Demo fallback"), "Hybrid meeting brief missing demo fallback disclosure");

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
const deliverableText = [itinerary, tripBrief, analysisAnnotation, memo, outreach]
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

console.log(`demo flows ok: ${questions.length} questions, itinerary ${itinerary.entityIds.length} stops, weekly memo ${memo.sections.length} sections, artifact brief cited real signal, hybrid brief cited CRM + monitor, outreach ${outreach.sections.length} sections`);
