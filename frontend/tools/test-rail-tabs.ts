import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { buildRailAuditViews } from "../src/app/railViews.ts";
import {
  ALL_SURFACES,
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  UTILITY_SURFACES,
  countForSurface,
  surfaceFromBrainArea,
} from "../src/app/surfaces.ts";
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
const componentIds = new Set(ALL_SURFACES.map((surface) => surface.componentId));

assert(CORE_SURFACES.map((surface) => surface.id).join(",") === "brief,work_queue,accounts,ask", "Primary nav must be the four core surfaces.");
assert(ANALYTICAL_SURFACES.map((surface) => surface.id).join(",") === "map,analysis,capacity,programs", "Secondary nav must contain the analytical surfaces.");
assert(UTILITY_SURFACES.map((surface) => surface.id).join(",") === "deliverables,settings", "Utility nav must expose Deliverable Editor and Settings.");
assert(componentIds.size === ALL_SURFACES.length, "Each surface must mount a distinct component id.");
assert(!ALL_SURFACES.some((surface) => ["market", "customer", "capability", "revenue", "geographic", "decision", "workflow"].includes(surface.id)), "Old nine-peer rail ids must not be visible surfaces.");

for (const surface of ALL_SURFACES) {
  assert(surface.componentId.startsWith("surface-"), `${surface.id} needs a surface component id.`);
  countForSurface(surface.id, world, memory);
}

assert(surfaceFromBrainArea("geographic") === "map", "Legacy map routing should land on Map.");
assert(surfaceFromBrainArea("workflow") === "work_queue", "Legacy workflow routing should land on Work Queue.");
assert(surfaceFromBrainArea("decision") === "settings", "Legacy memory routing should land in Settings.");

const workItems = deriveWorkItems(world);
assert(workItems.length > 0, "Core surfaces must be backed by work items.");
assert(filterWorkItems(workItems, "needs_attention").every((item) => item.priority === "high" || item.priority === "urgent" || (item.due_date ?? "9999-99-99") < new Date().toISOString().slice(0, 10)), "Needs-attention view must filter work items.");
const payload = draftToCreatePayload({ title: "Call account owner", accountId: "acct-1", sourceSignalIds: ["sig-1"], evidence: "brief.md" });
assert(payload.canonical_account_id === "acct-1", "Work-item preview must preserve account id.");
assert(payload.source_signal_ids?.[0] === "sig-1", "Work-item preview must preserve evidence signal ids.");
assert(payload.approval_state === "pending", "Work-item preview should create approval-ready items.");

// Keep the legacy rail audit as an overflow auditor for older detailed components.
const auditViews = buildRailAuditViews(world, memory);
assert(auditViews.length === 8, "Legacy overflow auditor should still cover home plus seven absorbed areas.");
assert(new Set(auditViews.map((view) => view.componentId)).size === auditViews.length, "Overflow auditor component ids must remain distinct.");

console.log(`ia surfaces ok: ${ALL_SURFACES.map((surface) => `${surface.id}:${surface.componentId}`).join(", ")}`);
