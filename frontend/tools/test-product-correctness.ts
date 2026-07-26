import { countForSurface } from "../src/app/surfaces.ts";
import { openWorkItems } from "../src/app/workItems.ts";
import { sourceRegistry, sourcePermissionLabel } from "../src/app/sourceRegistry.ts";
import type { World } from "../src/app/useWorld.ts";
import type { WorldSnapshot } from "../src/app/revenueDataClient.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const workItems = [
  { id: "open-a", status: "detected" },
  { id: "open-b", status: "verified" },
  { id: "closed", status: "closed" },
] as WorldSnapshot["workItems"];

const snapshot = {
  workItems,
  sourceHealth: [
    {
      sourceKey: "hubspot",
      displayName: "HubSpot CRM",
      availability: "available",
      lastSuccessfulSyncAt: "2026-07-26T12:00:00Z",
      lastAttemptAt: "2026-07-26T12:00:00Z",
      freshnessThresholdMinutes: 15,
      recordCount: 3,
      errorCode: null,
      errorMessage: null,
      connectionMode: "read_connected",
      environment: "developer",
      dataMode: "live_external",
      canRead: true,
      canWrite: false,
    },
    {
      sourceKey: "operating",
      displayName: "ERP",
      availability: "not_configured",
      lastSuccessfulSyncAt: null,
      lastAttemptAt: "2026-07-26T12:00:00Z",
      freshnessThresholdMinutes: null,
      recordCount: null,
      errorCode: "not_configured",
      errorMessage: "ERP is not configured.",
      connectionMode: "not_configured",
      environment: "none",
      dataMode: "missing",
      canRead: false,
      canWrite: false,
    },
  ],
} as WorldSnapshot;

const world = {
  worldSnapshot: snapshot,
  companies: [],
} as unknown as World;

const open = openWorkItems(world);
assert(open.length === 2, `expected 2 canonical open work items, got ${open.length}`);
assert(countForSurface("work_queue", world, null) === open.length, "navigation count must use canonical open work items");

const sources = sourceRegistry(snapshot);
assert(sources.length === 2, "source registry must preserve every backend source");
assert(sources[0].environment === "developer", "HubSpot environment must remain explicit");
assert(sourcePermissionLabel(sources[0]) === "Read only", "read capability must not imply write capability");
assert(sources[1].dataMode === "missing", "not configured operating data must remain missing");

console.log("product correctness ok: canonical work count and source capabilities agree");
