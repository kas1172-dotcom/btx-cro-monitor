import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import {
  ALL_SURFACES,
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  PRIMARY_TAB_IDS,
  TAB_IDS,
  UTILITY_SURFACES,
  countForSurface,
} from "../src/app/surfaces.ts";
import { SECONDARY_IDS } from "../src/ui/brain/BrainSidebar.tsx";
import { deriveWorkItems, draftToCreatePayload, filterWorkItems } from "../src/app/workItems.ts";
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
    sources: [],
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
const componentIds = new Set(ALL_SURFACES.map((surface) => surface.componentId));

assert(CORE_SURFACES.map((surface) => surface.id).join(",") === "brief,work_queue,accounts,ask", "Primary nav must be the four core surfaces.");
assert(ANALYTICAL_SURFACES.map((surface) => surface.id).join(",") === "industry_updates,prospecting,trip_planner,map,analysis,capacity,programs", "Analytical routes must appear in the workspace navigation.");
assert(SECONDARY_IDS.join(",") === ANALYTICAL_SURFACES.map((surface) => surface.id).join(","), "More navigation must include every secondary analytical route.");
assert(UTILITY_SURFACES.map((surface) => surface.id).join(",") === "deliverables,hubspot,settings", "Utility nav must expose Deliverable Editor, HubSpot, and Settings.");
assert(TAB_IDS.join(",") === "brief,work_queue,accounts,ask,industry_updates,prospecting,map,analysis,capacity,programs,deliverables,hubspot,settings", "Navigable tabs must include core, analytical, and utility routes.");
assert(PRIMARY_TAB_IDS.join(",") === "brief,work_queue,accounts,ask", "Primary rail must be the four-surface cockpit.");
assert(componentIds.size === ALL_SURFACES.length, "Each surface must mount a distinct component id.");
assert(!ALL_SURFACES.some((surface) => ["market", "customer", "capability", "revenue", "geographic", "decision", "workflow"].includes(surface.id)), "Old nine-peer rail ids must not be visible surfaces.");

for (const surface of ALL_SURFACES) {
  assert(surface.componentId.startsWith("surface-"), `${surface.id} needs a surface component id.`);
  countForSurface(surface.id, world, memory);
}

const componentByTab = Object.fromEntries(ALL_SURFACES.map((surface) => [surface.id, surface.componentId]));
assert(componentByTab.brief === "surface-todays-brief", "Brief tab must mount Today's Brief.");
assert(componentByTab.work_queue === "surface-work-queue", "Work Queue tab must mount Work Queue.");
assert(componentByTab.accounts === "surface-account-360", "Accounts tab must mount Account 360.");
assert(componentByTab.ask === "surface-ask", "Ask tab must mount Ask.");
assert(componentByTab.settings === "surface-settings", "Settings tab must mount Settings.");
const componentByAnalyticalTab = Object.fromEntries(ANALYTICAL_SURFACES.map((surface) => [surface.id, surface.componentId]));
assert(componentByAnalyticalTab.industry_updates === "surface-industry-updates", "Industry updates must keep its component binding.");
assert(componentByAnalyticalTab.trip_planner === "surface-trip-planner", "Trip Planner must keep its component binding.");
assert(componentByAnalyticalTab.map === "surface-map", "Map must keep its component binding.");
assert(componentByAnalyticalTab.analysis === "surface-analysis-dashboard", "Analysis must keep its component binding.");
assert(componentByAnalyticalTab.capacity === "surface-capacity-assessment", "Capacity must keep its component binding.");
assert(componentByAnalyticalTab.programs === "surface-program-contract-tracker", "Programs must keep its component binding.");

const workItems = deriveWorkItems(world);
assert(workItems.length > 0, "Core surfaces must be backed by work items.");
assert(filterWorkItems(workItems, "needs_attention").every((item) => item.priority === "high" || item.priority === "urgent" || (item.due_date ?? "9999-99-99") < new Date().toISOString().slice(0, 10)), "Needs-attention view must filter work items.");
const payload = draftToCreatePayload({ title: "Call account owner", accountId: "acct-1", sourceSignalIds: ["sig-1"], evidence: "brief.md" });
assert(payload.canonical_account_id === "acct-1", "Work-item preview must preserve account id.");
assert(payload.source_signal_ids?.[0] === "sig-1", "Work-item preview must preserve evidence signal ids.");
assert(payload.approval_state === "pending", "Work-item preview should create approval-ready items.");

console.log(`tab surfaces ok: ${ALL_SURFACES.map((surface) => `${surface.id}:${surface.componentId}`).join(", ")}`);
