import { assertSurfaceTruthCompatible, canonicalMetrics, formatCanonicalMetric, generatedSurfaceTruthRows } from "../src/app/canonicalMetrics.ts";
import { countForSurface } from "../src/app/surfaces.ts";
import type { WorldSnapshot } from "../src/app/revenueDataClient.ts";
import type { World } from "../src/app/useWorld.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const generatedAt = "2026-07-26T12:00:00Z";
const workItems = [
  { id: "open-a", status: "detected", approval_state: "not_required" },
  { id: "open-b", status: "verified", approval_state: "pending" },
  { id: "closed", status: "closed", approval_state: "not_required" },
] as WorldSnapshot["workItems"];

const snapshot = {
  tenant: { id: "tenant-test", displayName: "BTX Test" },
  accounts: [
    { id: "acct-1", name: "Lockheed", relationship: "customer", location: { city: "Fort Worth", lat: 32.75, lon: -97.33 }, needs: [] },
    { id: "acct-2", name: "Pulse Space", relationship: "customer", location: { city: "Austin", lat: 30.26, lon: -97.74 }, needs: [] },
    { id: "acct-3", name: "Trinity", relationship: "target", location: { city: "Tulsa", lat: null, lon: null }, needs: [] },
  ],
  contacts: [],
  opportunities: [
    { id: "opp-1", company_id: "acct-1", name: "Seeded pipeline", value: 2_500_000, stage: "proposal", close_date: "2026-09-30" },
  ],
  programs: [],
  signals: [],
  signalRelationships: [],
  facilities: [],
  operatingFacts: [],
  capacity: null,
  scores: {
    accountAttractiveness: [],
    signalConfidence: [],
    pursuitPwin: [],
    deliveryFeasibility: [],
    relationshipHealth: [],
    actionPriority: [],
  },
  workItems,
  deliverables: [],
  sourceHealth: [
    {
      sourceKey: "hubspot-demo",
      displayName: "Illustrative CRM seed",
      availability: "simulated",
      lastSuccessfulSyncAt: generatedAt,
      lastAttemptAt: generatedAt,
      freshnessThresholdMinutes: 15,
      recordCount: 0,
      errorCode: null,
      errorMessage: "CRM records are illustrative for this demonstration workspace.",
      connectionMode: "snapshot_loaded",
      environment: "developer",
      dataMode: "simulated_internal",
      canRead: true,
      canWrite: false,
    },
    {
      sourceKey: "monitor",
      displayName: "Monitor pipeline",
      availability: "stale",
      lastSuccessfulSyncAt: "2026-07-25T12:00:00Z",
      lastAttemptAt: "2026-07-26T12:00:00Z",
      freshnessThresholdMinutes: 60,
      recordCount: 0,
      errorCode: null,
      errorMessage: null,
      connectionMode: "snapshot_loaded",
      environment: "none",
      dataMode: "stored_snapshot",
      canRead: true,
      canWrite: false,
    },
  ],
  generatedAt,
  dataVersion: "test",
} as WorldSnapshot;

const world = {
  city: null,
  companies: snapshot.accounts,
  contacts: snapshot.contacts,
  facilities: snapshot.facilities,
  opportunities: snapshot.opportunities,
  analysis: { valid: [], rejected: [], scores: [], byId: new Map(), recById: new Map(), recommendations: [] },
  prospects: [],
  snapshot: { pipeline: { as_of: generatedAt } },
  worldSnapshot: snapshot,
  scoreResults: snapshot.scores,
  dataSource: "Backend world snapshot",
  loadErrors: [],
  sources: [
    {
      id: "hubspot-demo",
      name: "Illustrative CRM seed",
      connectionMode: "snapshot_loaded",
      environment: "developer",
      dataMode: "simulated_internal",
      retrievedAt: generatedAt,
      recordCount: 0,
      canRead: true,
      canWrite: false,
      verification: "verified",
      detail: "CRM records are illustrative for this demonstration workspace.",
    },
    {
      id: "monitor",
      name: "Monitor pipeline",
      connectionMode: "snapshot_loaded",
      environment: "none",
      dataMode: "stored_snapshot",
      retrievedAt: "2026-07-25T12:00:00Z",
      recordCount: 0,
      canRead: true,
      canWrite: false,
      verification: "verified",
      detail: "No additional source detail is available.",
    },
  ],
  provenanceSources: [],
  provenanceSummary: null,
  queryStatus: "success",
  isRefreshing: false,
  isStale: false,
  refresh: () => undefined,
} as unknown as World;

const metrics = canonicalMetrics(world, null);
assert(metrics.total_accounts.value === 3, "total accounts must reflect all account records");
assert(metrics.customer_accounts.value === 2, "customer accounts must use relationship scope");
assert(metrics.crm_synced_accounts.state === "unavailable", "simulated CRM must not be narrated as zero synced accounts");
assert(formatCanonicalMetric(metrics.crm_synced_accounts).displayValue === "Unavailable", "unavailable CRM must render unavailable");
assert(metrics.opportunity.value === 2_500_000, "open opportunity must reflect repository/backend seed value");
assert(countForSurface("work_queue", world, null) === 2, "Work badge must use open work scope");

const rows = generatedSurfaceTruthRows(world, null);
assert(rows.some((row) => row.surface === "work_queue" && row.value === 2 && row.scope === "Non-terminal work statuses"), "generated truth must inventory Work badge scope");
assert(rows.some((row) => row.surface === "accounts" && row.value === 3 && row.scope === "All account records"), "generated truth must inventory account record scope");
assertSurfaceTruthCompatible(rows);

assert(
  (() => {
    try {
      assertSurfaceTruthCompatible([
        { surface: "accounts", metricId: "total_accounts", label: "Accounts", value: 3, state: "available", scope: "All account records", source: "test", asOf: generatedAt },
        { surface: "hubspot", metricId: "total_accounts", label: "Accounts", value: 0, state: "available", scope: "CRM account records only", source: "test", asOf: generatedAt },
      ]);
      return false;
    } catch {
      return true;
    }
  })(),
  "cross-surface truth check must fail incompatible values without explicit scope labels",
);

console.log(`canonical metrics ok: ${rows.length} surface truth rows generated`);
