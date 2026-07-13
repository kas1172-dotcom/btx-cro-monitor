import {
  hubspotRecordId,
  pipelineSnapshotByStage,
  recentHubSpotActivity,
} from "../src/ui/surfaces/HubSpotViewer.tsx";
import type { World } from "../src/app/useWorld.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const world = {
  companies: [
    {
      id: "hubspot-company-10",
      hubspot_company_id: "10",
      name: "Trinity Defense Components",
      relationship: "customer",
      location: { city: "Pittsburgh", lat: 40.4, lon: -80 },
      needs: [],
    },
  ],
  contacts: [
    { id: "hubspot-contact-20", company_id: "hubspot-company-10", name: "Riley Buyer", title: "Buyer" },
  ],
  opportunities: [
    { id: "deal-1", company_id: "hubspot-company-10", name: "Bracket program", value: 500000, stage: "proposal", close_date: "2026-09-15" },
    { id: "deal-2", company_id: "hubspot-company-10", name: "Machining IDIQ", value: 200000, stage: "qualified", close_date: "2026-08-01" },
    { id: "deal-3", company_id: "hubspot-company-10", name: "Follow-on", value: 100000, stage: "proposal", close_date: "2026-07-01" },
  ],
} as World;

assert(hubspotRecordId("hubspot-company-10", "company") === "10", "Company ids should normalize from canonical HubSpot ids.");
assert(hubspotRecordId("hubspot-contact-20", "contact") === "20", "Contact ids should normalize from canonical HubSpot ids.");
assert(hubspotRecordId("local-company", "company") === null, "Local/demo ids should not be treated as HubSpot ids.");

const activity = recentHubSpotActivity(world, 3);
assert(activity.length === 3, `Expected 3 recent activity rows, got ${activity.length}`);
assert(activity[0]?.id === "deal-1", "Recent activity should sort dated deals first.");
assert(activity.some((item) => item.kind === "contact") === false, "Limit should cap lower-priority undated contact rows.");

const pipeline = pipelineSnapshotByStage(world.opportunities);
assert(pipeline[0]?.stage === "proposal", "Pipeline should group by stage and sort by value.");
assert(pipeline[0]?.count === 2, "Proposal stage should include two deals.");
assert(pipeline[0]?.value === 600000, "Proposal value should be summed.");

console.log(`hubspot viewer ok: ${activity.length} activity rows, ${pipeline.length} pipeline stages`);
