import type { MemoryState } from "../memory/types.ts";
import { provenanceForRecord } from "./provenance.ts";
import { sourceModeLabel, type SourceCapability } from "./sourceRegistry.ts";
import type { TabId } from "./surfaces.ts";
import type { World } from "./useWorld.ts";
import { openWorkItems } from "./workItems.ts";

export type CanonicalMetricId =
  | "total_accounts"
  | "customer_accounts"
  | "crm_synced_accounts"
  | "work_total"
  | "work_open"
  | "work_review"
  | "signals"
  | "opportunity"
  | "mapped_accounts"
  | "data_freshness";

export type CanonicalMetricState = "available" | "unavailable" | "stale" | "error";

export interface CanonicalMetric {
  id: CanonicalMetricId;
  label: string;
  value: number | string | null;
  unit: "count" | "currency" | "datetime" | "label";
  state: CanonicalMetricState;
  scope: string;
  source: string;
  asOf: string | null;
  unavailableReason?: string;
}

export interface DisplayMetric extends CanonicalMetric {
  displayValue: string;
  displayLabel: string;
  provenanceLabel: string;
}

type SurfaceMetricId =
  | CanonicalMetricId
  | "industry_updates"
  | "prospects"
  | "trip_planner"
  | "map"
  | "analysis_open_opportunities"
  | "capacity_facilities"
  | "deliverables"
  | "hubspot_records"
  | "settings_activity";

function latest(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function sourceBy(source: SourceCapability[], predicate: (source: SourceCapability) => boolean): SourceCapability | null {
  return source.find(predicate) ?? null;
}

function money(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`;
}

function isFreshnessBad(source: SourceCapability): boolean {
  return source.verification === "failed" || source.dataMode === "unavailable" || source.dataMode === "missing";
}

function countMetric(id: CanonicalMetricId, label: string, value: number, world: World, scope: string, source = "Backend world snapshot"): CanonicalMetric {
  return { id, label, value, unit: "count", state: "available", scope, source, asOf: world.worldSnapshot?.generatedAt ?? null };
}

function isTargetProspect(company: { relationship?: string; business_motion?: string; account_status?: string }): boolean {
  return company.relationship === "target"
    || company.business_motion === "prospect_new_business"
    || company.account_status === "target_prospect"
    || company.account_status === "new_logo";
}

export function canonicalMetrics(world: World, _memory?: MemoryState | null): Record<CanonicalMetricId, CanonicalMetric> {
  const sources = world.sources ?? [];
  const companies = world.companies ?? [];
  const opportunities = world.opportunities ?? [];
  const signals = world.analysis?.valid ?? [];
  const crmSource = sourceBy(sources, (source) => source.id.toLowerCase().includes("hubspot") || source.name.toLowerCase().includes("crm"));
  const monitorSource = sourceBy(sources, (source) => source.id === "monitor" || source.name.toLowerCase().includes("monitor"));
  const accountAsOf = latest([world.worldSnapshot?.generatedAt, crmSource?.retrievedAt]);
  const customerAccounts = companies.filter((company) => company.relationship === "customer");
  const crmAccounts = companies.filter((company) => provenanceForRecord(company) === "CRM" || Boolean(company.hubspot_company_id));
  const openWork = openWorkItems(world);
  const reviewWork = (world.worldSnapshot?.workItems ?? []).filter((item) => item.approval_state === "pending" || item.status === "awaiting_approval");
  const mappedAccounts = companies.filter((company) => Boolean(company.location?.lat && company.location?.lon));
  const opportunityValue = opportunities
    .filter((opportunity) => opportunity.stage !== "won" && opportunity.stage !== "lost")
    .reduce((sum, opportunity) => sum + (opportunity.value ?? 0), 0);
  const dataFreshnessSource = sources.find(isFreshnessBad) ?? latest(sources.map((source) => source.retrievedAt))
    ? sources.slice().sort((a, b) => String(b.retrievedAt ?? "").localeCompare(String(a.retrievedAt ?? "")))[0]
    : null;

  const crmSyncedAccounts: CanonicalMetric = crmSource && crmSource.canRead && ["live_external", "stored_snapshot", "recently_ingested"].includes(crmSource.dataMode)
    ? {
      id: "crm_synced_accounts",
      label: "CRM-synced accounts",
      value: crmAccounts.length,
      unit: "count",
      state: crmSource.verification === "failed" ? "error" : crmSource.dataMode === "stored_snapshot" ? "stale" : "available",
      scope: "CRM account records only",
      source: crmSource.name,
      asOf: crmSource.retrievedAt ?? world.worldSnapshot?.generatedAt ?? null,
    }
    : {
      id: "crm_synced_accounts",
      label: "CRM-synced accounts",
      value: null,
      unit: "count",
      state: crmSource?.verification === "failed" ? "error" : "unavailable",
      scope: "CRM account records only",
      source: crmSource ? `${crmSource.name} (${sourceModeLabel(crmSource)})` : "CRM source unavailable",
      asOf: crmSource?.retrievedAt ?? null,
      unavailableReason: crmSource?.detail ?? "No readable CRM account source is connected.",
    };

  return {
    total_accounts: { ...countMetric("total_accounts", "Account records", companies.length, world, "All account records"), asOf: accountAsOf },
    customer_accounts: { ...countMetric("customer_accounts", "Customer accounts", customerAccounts.length, world, "Relationship = customer"), asOf: accountAsOf },
    crm_synced_accounts: crmSyncedAccounts,
    work_total: countMetric("work_total", "Total work", world.worldSnapshot?.workItems.length ?? 0, world, "All work item statuses"),
    work_open: countMetric("work_open", "Open work", openWork.length, world, "Non-terminal work statuses"),
    work_review: countMetric("work_review", "Review work", reviewWork.length, world, "Pending approval or awaiting approval"),
    signals: {
      ...countMetric("signals", "Signals", signals.length, world, "Validated monitor signals", monitorSource?.name ?? "Monitor pipeline"),
      state: monitorSource?.dataMode === "stored_snapshot" ? "stale" : monitorSource?.verification === "failed" ? "error" : "available",
      asOf: latest([monitorSource?.retrievedAt, ...signals.map((signal) => signal.detected_at)]),
    },
    opportunity: {
      id: "opportunity",
      label: "Open opportunity",
      value: opportunityValue,
      unit: "currency",
      state: opportunities.length ? "available" : "unavailable",
      scope: "Open opportunities, excludes won/lost",
      source: crmSource?.name ?? "Backend world snapshot",
      asOf: latest([crmSource?.retrievedAt, world.snapshot?.pipeline.as_of, world.worldSnapshot?.generatedAt]),
      unavailableReason: opportunities.length ? undefined : "No opportunity records are available.",
    },
    mapped_accounts: countMetric("mapped_accounts", "Mapped accounts", mappedAccounts.length, world, "Accounts with latitude and longitude"),
    data_freshness: {
      id: "data_freshness",
      label: "Data freshness",
      value: dataFreshnessSource?.retrievedAt ?? world.worldSnapshot?.generatedAt ?? null,
      unit: "datetime",
      state: dataFreshnessSource ? (dataFreshnessSource.verification === "failed" ? "error" : dataFreshnessSource.dataMode === "stored_snapshot" ? "stale" : "available") : "unavailable",
      scope: dataFreshnessSource ? dataFreshnessSource.name : "World snapshot",
      source: dataFreshnessSource?.name ?? "Backend world snapshot",
      asOf: dataFreshnessSource?.retrievedAt ?? world.worldSnapshot?.generatedAt ?? null,
      unavailableReason: dataFreshnessSource ? dataFreshnessSource.detail : "No source freshness is available.",
    },
  };
}

export function formatCanonicalMetric(metric: CanonicalMetric): DisplayMetric {
  const displayValue = metric.state === "unavailable" || metric.state === "error"
    ? metric.state === "error" ? "Error" : "Unavailable"
    : metric.unit === "currency" && typeof metric.value === "number"
      ? money(metric.value)
      : metric.unit === "datetime" && typeof metric.value === "string"
        ? metric.value.slice(0, 10)
        : String(metric.value ?? "Unavailable");
  return {
    ...metric,
    displayValue,
    displayLabel: `${metric.label} (${metric.scope})`,
    provenanceLabel: `${metric.source}${metric.asOf ? ` · as of ${metric.asOf.slice(0, 10)}` : " · as-of unavailable"}`,
  };
}

export function canonicalMetricForSurface(surface: TabId, world: World | null, memory: MemoryState | null): DisplayMetric | null {
  if (!world) return null;
  const metrics = canonicalMetrics(world, memory);
  const mapping: Record<TabId, SurfaceMetricId | null> = {
    brief: "signals",
    work_queue: "work_open",
    accounts: "total_accounts",
    ask: null,
    industry_updates: "industry_updates",
    prospecting: "prospects",
    trip_planner: "trip_planner",
    map: "map",
    analysis: "analysis_open_opportunities",
    capacity: "capacity_facilities",
    programs: "signals",
    deliverables: "deliverables",
    hubspot: "hubspot_records",
    settings: "settings_activity",
  };
  const id = mapping[surface];
  if (!id) return null;
  if (id in metrics) return formatCanonicalMetric(metrics[id as CanonicalMetricId]);
  const generatedAt = world.worldSnapshot?.generatedAt ?? null;
  const companies = world.companies ?? [];
  const opportunities = world.opportunities ?? [];
  const signals = world.analysis?.valid ?? [];
  const prospects = world.prospects ?? [];
  const prospectAccounts = companies.filter(isTargetProspect);
  const mappedAccounts = companies.filter((company) => Boolean(company.location?.lat && company.location?.lon));
  const hasApprovedAnalytics = opportunities.length > 0 && world.sources.some((source) => source.canRead && source.dataMode === "live_external");
  const displayOnly: Record<Exclude<SurfaceMetricId, CanonicalMetricId>, CanonicalMetric> = {
    industry_updates: { id: "signals", label: "Public monitor signals", value: signals.filter((signal) => signal.artifact).length, unit: "count", state: "available", scope: "Signals with public artifacts", source: "Monitor pipeline", asOf: generatedAt },
    prospects: { id: "total_accounts", label: "Target prospect accounts", value: prospectAccounts.length, unit: "count", state: "available", scope: "Relationship = target or prospect/new-logo status", source: "Backend world snapshot", asOf: generatedAt },
    trip_planner: { id: "mapped_accounts", label: "Trip plans", value: memory?.deliverables.filter((deliverable) => deliverable.type === "itinerary").length ?? prospects.length, unit: "count", state: "available", scope: "Itinerary deliverables or mapped prospects", source: memory ? "Local deliverable memory" : "Backend world snapshot", asOf: generatedAt },
    map: { ...metrics.mapped_accounts, label: "Mapped accounts", value: mappedAccounts.length, scope: "Account records with latitude and longitude" },
    analysis_open_opportunities: { id: "opportunity", label: "Approved analytics", value: hasApprovedAnalytics ? opportunities.filter((opportunity) => opportunity.stage !== "won" && opportunity.stage !== "lost").length : null, unit: "count", state: hasApprovedAnalytics ? "available" : "unavailable", scope: "Approved financial/opportunity analytics records", source: hasApprovedAnalytics ? "Live backend source" : "Analysis source unavailable", asOf: generatedAt, unavailableReason: "No approved analytics dataset is connected." },
    capacity_facilities: { ...metrics.crm_synced_accounts, label: "CRM-synced accounts", scope: "Same CRM account records shown on Accounts/Capacity" },
    deliverables: { id: "work_total", label: "Saved deliverables", value: world.worldSnapshot?.deliverables.length ?? null, unit: "count", state: world.worldSnapshot ? "available" : "unavailable", scope: "Backend saved deliverable records", source: "Backend world snapshot", asOf: generatedAt, unavailableReason: "Backend deliverable summaries are unavailable." },
    hubspot_records: { id: "crm_synced_accounts", label: "CRM records", value: world.contacts.length + world.opportunities.length, unit: "count", state: "available", scope: "Contacts plus opportunities loaded in world snapshot", source: "Backend world snapshot", asOf: generatedAt },
    settings_activity: { id: "work_total", label: "Activity", value: memory ? memory.activity.length + memory.notes.length : null, unit: "count", state: memory ? "available" : "unavailable", scope: "Local activity and notes", source: "Local memory", asOf: generatedAt },
  };
  return formatCanonicalMetric(displayOnly[id as Exclude<SurfaceMetricId, CanonicalMetricId>]);
}

export function canonicalCountForSurface(surface: TabId, world: World | null, memory: MemoryState | null): number | undefined {
  const metric = canonicalMetricForSurface(surface, world, memory);
  return typeof metric?.value === "number" && metric.state !== "unavailable" && metric.state !== "error" ? metric.value : undefined;
}

export interface SurfaceTruthRow {
  surface: TabId;
  metricId: CanonicalMetricId;
  label: string;
  value: number | string | null;
  state: CanonicalMetricState;
  scope: string;
  source: string;
  asOf: string | null;
}

export function generatedSurfaceTruthRows(world: World, memory: MemoryState | null): SurfaceTruthRow[] {
  const surfaces: TabId[] = ["brief", "work_queue", "accounts", "industry_updates", "prospecting", "trip_planner", "map", "analysis", "capacity", "programs", "deliverables", "hubspot", "settings"];
  return surfaces.flatMap((surface) => {
    const metric = canonicalMetricForSurface(surface, world, memory);
    if (!metric) return [];
    return [{
      surface,
      metricId: metric.id,
      label: metric.displayLabel,
      value: metric.value,
      state: metric.state,
      scope: metric.scope,
      source: metric.source,
      asOf: metric.asOf,
    }];
  });
}

export function assertSurfaceTruthCompatible(rows: SurfaceTruthRow[]): void {
  const byMetric = new Map<CanonicalMetricId, SurfaceTruthRow[]>();
  for (const row of rows) {
    byMetric.set(row.metricId, [...(byMetric.get(row.metricId) ?? []), row]);
  }
  const failures: string[] = [];
  for (const [metricId, metricRows] of byMetric) {
    for (let index = 0; index < metricRows.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < metricRows.length; nextIndex += 1) {
        const left = metricRows[index];
        const right = metricRows[nextIndex];
        const incompatibleValue = left.value !== right.value || left.state !== right.state;
        const labeledScopeDifference = left.scope !== right.scope && left.label.includes(left.scope) && right.label.includes(right.scope);
        if (incompatibleValue && !labeledScopeDifference) {
          failures.push(`${metricId}: ${left.surface}=${String(left.value)} (${left.scope}) conflicts with ${right.surface}=${String(right.value)} (${right.scope})`);
        }
      }
    }
  }
  if (failures.length) throw new Error(`Cross-surface truth mismatch:\n${failures.join("\n")}`);
}
