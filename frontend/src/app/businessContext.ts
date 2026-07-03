import type { World } from "./useWorld.ts";
import type { Company } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function dateLabel(value: string): string {
  return value.includes("T") ? new Date(value).toLocaleDateString() : value;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface BusinessContext {
  crmLine: string;
  capacityLine: string;
  pipelineLine: string;
  assumptionsLine: string;
  recommendationLine: string;
  /** Short phrases for stitching into a single "why we recommend this" sentence. */
  crmClause: string;
  capacityClause: string;
  pipelineClause: string;
}

export function businessContextForCompany(
  world: World,
  snapshot: OperatingSnapshot | null,
  company: Company,
): BusinessContext {
  const crm = snapshot?.crm.find((row) => row.account_id === company.id);
  const pipelineRecord = snapshot?.pipeline.records.find((row) => row.company_id === company.id);
  const openOpps = world.opportunities.filter((o) => o.company_id === company.id && o.stage !== "won" && o.stage !== "lost");
  const wonOpps = world.opportunities.filter((o) => o.company_id === company.id && o.stage === "won");
  const openValue = openOpps.reduce((sum, o) => sum + o.value, 0);
  const bestCapacity = snapshot?.capacity
    .filter((row) => row.capacity_status !== "selective_capacity")
    .sort((a, b) => b.available_5_axis_hours_next_30d - a.available_5_axis_hours_next_30d)[0] ?? snapshot?.capacity[0];

  const crmLine = crm
    ? `CRM: ${crm.account_tier} account owned by ${crm.owner}; relationship ${crm.relationship_health}; last touch ${dateLabel(crm.last_activity_at)}; next step: ${crm.next_step}.`
    : "CRM: no simulated owner or last-touch record is attached to this account.";

  const capacityLine = bestCapacity
    ? `ERP/capacity: ${bestCapacity.facility_name} has ${bestCapacity.available_5_axis_hours_next_30d} available 5-axis hours and ${bestCapacity.available_turning_hours_next_30d} turning hours over 30 days; constraint is ${bestCapacity.constraint}; lead time ${bestCapacity.quoted_lead_time_days} days.`
    : "ERP/capacity: no capacity snapshot is available.";

  const pipelineLine = pipelineRecord
    ? `Pipeline: ${pipelineRecord.recommended_action}. ${pipelineRecord.reason}`
    : openOpps.length
      ? `Pipeline: ${openOpps.length} open item${openOpps.length === 1 ? "" : "s"} worth ${money(openValue)}; ${wonOpps.length} won contract${wonOpps.length === 1 ? "" : "s"}.`
      : "Pipeline: no open simulated opportunity is attached to this account.";

  const assumptionsLine = snapshot
    ? `Demo disclosure: ${snapshot.assumptions.assumptions[0] ?? snapshot.assumptions.summary}`
    : "Demo disclosure: CRM, ERP/capacity, opportunities, and pipeline context are static demo snapshots.";

  const crmClause = crm
    ? `simulated CRM shows a ${crm.relationship_health} relationship owned by ${crm.owner}`
    : "simulated CRM shows no active owner (whitespace account)";
  const capacityClause = bestCapacity
    ? `ERP/capacity shows ${bestCapacity.available_5_axis_hours_next_30d} available 5-axis hours`
    : "ERP/capacity is not modeled for this account";
  const pipelineClause = pipelineRecord
    ? `pipeline flags "${pipelineRecord.recommended_action.toLowerCase()}"`
    : openOpps.length
      ? `${money(openValue)} in open pipeline`
      : "no open pipeline yet";

  return {
    crmLine,
    capacityLine,
    pipelineLine,
    assumptionsLine,
    recommendationLine: [crmLine, capacityLine, pipelineLine].join(" "),
    crmClause,
    capacityClause,
    pipelineClause,
  };
}

export function shortBusinessContext(context: BusinessContext): string {
  return `${context.crmLine} ${context.capacityLine} ${context.pipelineLine}`;
}

export function contextBadgeText(context: BusinessContext): string {
  const crm = context.crmLine.startsWith("CRM: no") ? "CRM gap" : "CRM active";
  const capacity = context.capacityLine.startsWith("ERP/capacity: no") ? "capacity unknown" : "capacity modeled";
  const pipeline = context.pipelineLine.startsWith("Pipeline: no") ? "no open pipeline" : "pipeline context";
  return `${titleCase(crm)} · ${titleCase(capacity)} · ${titleCase(pipeline)}`;
}
