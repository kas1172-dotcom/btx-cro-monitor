import React from "react";
import { renderToString } from "react-dom/server";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { buildItineraryContext, itineraryAgent } from "../src/agents/itineraryAgent.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import { TripPlanner } from "../src/ui/surfaces/TripPlanner.tsx";
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
const initialHtml = renderToString(<TripPlanner world={world} />);
assert(initialHtml.includes("surface-trip-planner"), "Trip Planner surface should mount with its component id.");
assert(initialHtml.includes("Plan a trip"), "Trip Planner should render the input form first.");
assert(!initialHtml.includes("Candidate map"), "Candidate map must not render before form submission.");
assert(!initialHtml.includes("Ranked candidates"), "Ranked list must not render before form submission.");

const context = buildItineraryContext({
  region: world.companies[0]?.location.city ?? "Austin",
  radius: 250,
  dateRange: { startDate: "2026-08-10", endDate: "2026-08-12" },
  goals: ["prospect_new_business", "grow_existing_business"],
  meetingCapacity: 4,
}, world);
assert(context.rankedCandidates.length > 0, "Trip planner should return ranked candidates after form submission inputs.");
assert(context.rankedCandidates.length <= 4, "Meeting capacity should cap ranked candidates.");
for (const candidate of context.rankedCandidates) {
  assert(candidate.companyId, "Ranked candidate needs a company id.");
  assert(Number.isFinite(candidate.score), "Ranked candidate needs a numeric score.");
  assert(candidate.whyRanked.length > 0, "Ranked candidate keeps why-ranked detail for the drill-in view.");
  assert(candidate.evidence.length > 0, "Ranked candidate keeps evidence for the drill-in view.");
  assert(candidate.confidence > 0, "Ranked candidate needs confidence.");
}

const itinerary = await itineraryAgent.compose(context);
const validation = itineraryAgent.validate(itinerary, context);
assert(validation.valid, `Generated itinerary should validate: ${validation.errors.join("; ")}`);

const firstCandidate = context.rankedCandidates[0];
const meetingBrief = await runAgent("meeting_brief", { accountId: firstCandidate.companyId }, world);
const tripBrief = await runAgent("trip_brief", {
  itinerary,
  meetingBriefs: [meetingBrief],
  logistics: "Confirm drive time, visitor access, and local buffer windows before departure.",
}, world);

assert(tripBrief.title.startsWith("Trip Brief:"), "Trip Brief should compile as one saved deliverable.");
assert(tripBrief.sections.some((section) => section.id === "itinerary-logistics"), "Trip Brief needs an itinerary/logistics section.");
assert(tripBrief.sections.some((section) => section.id.startsWith("stop-")), "Trip Brief needs one section per stop meeting brief.");

console.log(`trip planner ok: ${context.rankedCandidates.length} candidates, trip brief ${tripBrief.id}`);
