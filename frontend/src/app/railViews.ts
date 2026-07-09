import capacityHistoryData from "../../data/demo/btx/capacity_utilization.json";
import pipelineHistoryData from "../../data/demo/btx/pipeline_snapshots.json";
import type { World } from "./useWorld.ts";
import type { BrainArea } from "../brain/types.ts";
import type { MemoryState } from "../memory/types.ts";
import type { Opportunity } from "../engine/brain/entities.ts";
import type { Recommendation } from "../engine/decision/recommend.ts";
import { signalSourceDate, signalSourceName } from "./signalProvenance.ts";

export const RAIL_AREAS: BrainArea[] = ["market", "customer", "capability", "revenue", "geographic", "decision", "workflow"];

const STAGE_WEIGHT: Record<Opportunity["stage"], number> = {
  prospecting: 0.3,
  qualified: 0.6,
  proposal: 1,
  won: 1,
  lost: 0,
};

interface CapacityHistoryRow {
  month: string;
  facility_id: string;
  utilization_pct: number;
  available_5_axis_hours: number;
  quoted_lead_time_days: number;
}

interface PipelineHistoryRow {
  month: string;
  open_pipeline_value: number;
  weighted_pipeline_value: number;
}

const CAPACITY_HISTORY = capacityHistoryData as CapacityHistoryRow[];
const PIPELINE_HISTORY = pipelineHistoryData as PipelineHistoryRow[];

export interface RailViewRow {
  id: string;
  primary: string;
  secondary: string;
  meta: string;
  badge?: string;
  companyId?: string;
  detailTarget?: "dossier" | "pipeline" | "detail";
}

export interface RailViewModel {
  area: BrainArea | "home";
  componentId: string;
  eyebrow: string;
  headline: string;
  rows: RailViewRow[];
  total: number;
  viewAllLabel: string;
}

export function money(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1_000)}k`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameOf(world: World, id: string): string {
  return world.companies.find((c) => c.id === id)?.name ?? id;
}

function openOpportunities(world: World): Opportunity[] {
  return world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
}

function recommendationRank(rec: Recommendation | undefined): number {
  if (!rec) return 0;
  if (rec.priority === "high") return 40;
  if (rec.priority === "medium") return 20;
  return 0;
}

function latestCapacityRows(): CapacityHistoryRow[] {
  const latest = CAPACITY_HISTORY.map((row) => row.month).sort().at(-1);
  return latest ? CAPACITY_HISTORY.filter((row) => row.month === latest) : [];
}

function latestPipelineCoverage(): number {
  const latest = PIPELINE_HISTORY.slice().sort((a, b) => a.month.localeCompare(b.month)).at(-1);
  if (!latest) return 0;
  const monthlyTarget = Math.max(1, latest.open_pipeline_value - latest.weighted_pipeline_value);
  return latest.weighted_pipeline_value / monthlyTarget;
}

export function buildHomeRailView(world: World, memory: MemoryState): RailViewModel {
  const topSignal = [...world.analysis.valid].sort((a, b) => b.confidence - a.confidence)[0];
  const topOpportunity = world.prospects[0];
  const topRisk = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score)[0];
  return {
    area: "home",
    componentId: "home",
    eyebrow: "Home",
    headline: `${topSignal ? nameOf(world, topSignal.subject_id) : "No account"} leads today; ${topOpportunity?.company.name ?? "no opportunity"} is the top opportunity; ${memory.activity.length} memory entries saved.`,
    rows: [],
    total: 1,
    viewAllLabel: topRisk ? `Top risk: ${nameOf(world, topRisk.subject_id)}` : "Top risk: none",
  };
}

function buildSignalsView(world: World): RailViewModel {
  const latestMs = Math.max(...world.analysis.valid.map((signal) => Date.parse(signal.detected_at)));
  const weekStart = latestMs - 7 * 24 * 60 * 60 * 1000;
  const accountIds = new Set(world.companies.filter((company) => company.relationship === "customer").map((company) => company.id));
  const recentAccountSignals = world.analysis.valid.filter((signal) => accountIds.has(signal.subject_id) && Date.parse(signal.detected_at) >= weekStart);
  const rows = [...world.analysis.valid]
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at) || b.confidence - a.confidence)
    .map<RailViewRow>((signal) => ({
      id: signal.id,
      primary: nameOf(world, signal.subject_id),
      secondary: signal.source_quote,
      meta: `${titleCase(signal.event_type)} · ${signalSourceName(signal)} ${signalSourceDate(signal)} · confidence ${(signal.confidence * 100).toFixed(0)}%`,
      badge: signal.value ? money(signal.value) : signal.detected_at.slice(0, 10),
      companyId: signal.subject_id,
      detailTarget: "dossier",
    }));
  return {
    area: "market",
    componentId: "rail-signals",
    eyebrow: "Signals",
    headline: `${recentAccountSignals.length} new signals touch your accounts this week.`,
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

function buildAccountsView(world: World): RailViewModel {
  const open = openOpportunities(world);
  const rows = world.companies
    .filter((company) => company.relationship === "customer")
    .map((company) => {
      const score = world.analysis.byId.get(company.id);
      const rec = world.analysis.recById.get(company.id);
      const openValue = open.filter((opp) => opp.company_id === company.id).reduce((sum, opp) => sum + opp.value, 0);
      const attention = (score?.dimensions.risk.score ?? 0) + (score?.dimensions.capacityRisk.score ?? 0) + recommendationRank(rec) + (openValue > 0 ? 15 : 0);
      return { company, score, rec, openValue, attention };
    })
    .filter((row) => row.attention > 0)
    .sort((a, b) => b.attention - a.attention || a.company.name.localeCompare(b.company.name))
    .map<RailViewRow>(({ company, score, rec, openValue }) => ({
      id: company.id,
      primary: company.name,
      secondary: rec?.reason ?? "Watch current account context.",
      meta: `risk ${score?.dimensions.risk.score ?? 0} · capacity ${score?.dimensions.capacityRisk.score ?? 0}${openValue > 0 ? ` · ${money(openValue)} open` : ""}`,
      badge: rec?.priority ?? "watch",
      companyId: company.id,
      detailTarget: "dossier",
    }));
  const top = rows[0];
  return {
    area: "customer",
    componentId: "rail-accounts",
    eyebrow: "Accounts",
    headline: top ? `${top.primary} needs attention first; ${rows.length} accounts have active risk, capacity, or pipeline context.` : "0 accounts need immediate attention.",
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

function buildCapabilityView(world: World): RailViewModel {
  const latestRows = latestCapacityRows();
  const capacityById = new Map((world.snapshot?.capacity ?? []).map((row) => [row.facility_id, row]));
  const rows = latestRows
    .map((row) => {
      const snapshot = capacityById.get(row.facility_id);
      return { row, snapshot };
    })
    .sort((a, b) => b.row.utilization_pct - a.row.utilization_pct || a.row.available_5_axis_hours - b.row.available_5_axis_hours)
    .map<RailViewRow>(({ row, snapshot }) => ({
      id: row.facility_id,
      primary: snapshot?.facility_name ?? row.facility_id,
      secondary: `${row.available_5_axis_hours} available 5-axis hours · ${row.quoted_lead_time_days} day quoted lead time`,
      meta: `constraint: ${snapshot?.constraint ?? "5-axis capacity"}`,
      badge: `${row.utilization_pct}%`,
      detailTarget: "detail",
    }));
  const headlineRow = latestRows[0];
  const hasTightFiveAxis = latestRows.some((row) => row.available_5_axis_hours < 250);
  return {
    area: "capability",
    componentId: "rail-capability",
    eyebrow: "Capability",
    headline: `${headlineRow?.utilization_pct ?? 0}% utilization; ${hasTightFiveAxis ? "5-axis" : "capacity"} is the constraint this month.`,
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

export function buildRevenuePipelineRows(world: World): RailViewRow[] {
  return openOpportunities(world)
    .map((opp) => {
      const score = world.analysis.byId.get(opp.company_id);
      const rec = world.analysis.recById.get(opp.company_id);
      const weighted = Math.round(opp.value * STAGE_WEIGHT[opp.stage]);
      const attention = weighted + recommendationRank(rec) * 25_000 + (score?.dimensions.risk.score ?? 0) * 10_000 + (score?.dimensions.capacityRisk.score ?? 0) * 8_000;
      return { opp, score, rec, attention };
    })
    .sort((a, b) => b.attention - a.attention || b.opp.value - a.opp.value)
    .map<RailViewRow>(({ opp, score, rec }) => ({
      id: opp.id,
      primary: nameOf(world, opp.company_id),
      secondary: `${titleCase(opp.stage)} · ${money(opp.value)} · score ${score?.dimensions.opportunity.score ?? 0}`,
      meta: rec?.reason ?? `Next step: review ${opp.name}`,
      badge: opp.close_date,
      companyId: opp.company_id,
      detailTarget: "pipeline",
    }));
}

function buildRevenueView(world: World): RailViewModel {
  const rows = buildRevenuePipelineRows(world);
  const attentionCount = world.snapshot?.pipeline.summary.priority_accounts.length ?? rows.filter((row) => {
    const companyScore = row.companyId ? world.analysis.byId.get(row.companyId) : undefined;
    return (companyScore?.dimensions.risk.score ?? 0) >= 50 || (companyScore?.dimensions.capacityRisk.score ?? 0) >= 50;
  }).length;
  return {
    area: "revenue",
    componentId: "rail-revenue",
    eyebrow: "Revenue",
    headline: `Pipeline covers ${latestPipelineCoverage().toFixed(1)}x of target; ${attentionCount} deals need attention.`,
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

function buildMemoryView(memory: MemoryState): RailViewModel {
  const rows = memory.activity.map<RailViewRow>((entry) => ({
    id: entry.id,
    primary: entry.title,
    secondary: entry.summary,
    meta: `${titleCase(entry.kind)} · ${entry.brainArea}`,
    badge: entry.createdAt.slice(0, 10),
    detailTarget: "detail",
  }));
  return {
    area: "decision",
    componentId: "rail-memory",
    eyebrow: "Memory",
    headline: `${memory.notes.length} saved notes; ${memory.activity.length} activity log entries.`,
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

function buildActionsView(memory: MemoryState): RailViewModel {
  const workflows: RailViewRow[] = [
    { id: "crm-task", primary: "Create CRM task", secondary: "Assign an owner, attach evidence, and schedule follow-up.", meta: "Workflow available", badge: "task", detailTarget: "detail" },
    { id: "follow-up", primary: "Draft follow-up", secondary: "Prepare a next-touch message from account evidence.", meta: "Workflow available", badge: "email", detailTarget: "detail" },
    { id: "crm-lead", primary: "Create CRM lead", secondary: "Queue a qualified prospect for sales review.", meta: "Workflow available", badge: "lead", detailTarget: "detail" },
  ];
  const simulated = memory.activity.filter((entry) => entry.kind === "simulated_action").map<RailViewRow>((entry) => ({
    id: entry.id,
    primary: entry.title,
    secondary: entry.summary,
    meta: "Recent simulated action",
    badge: entry.createdAt.slice(0, 10),
    detailTarget: "detail",
  }));
  const rows = [...workflows, ...simulated];
  return {
    area: "workflow",
    componentId: "rail-actions",
    eyebrow: "Actions",
    headline: `${workflows.length} workflows available; ${simulated.length} simulated actions logged.`,
    rows,
    total: rows.length,
    viewAllLabel: `View all (${rows.length})`,
  };
}

function buildMapView(world: World): RailViewModel {
  return {
    area: "geographic",
    componentId: "map-exception",
    eyebrow: "Map",
    headline: `${world.prospects.length} mapped prospects and accounts in the current market scope.`,
    rows: [],
    total: world.prospects.length,
    viewAllLabel: "Map",
  };
}

export function buildRailView(area: BrainArea, world: World, memory: MemoryState): RailViewModel {
  switch (area) {
    case "market": return buildSignalsView(world);
    case "customer": return buildAccountsView(world);
    case "capability": return buildCapabilityView(world);
    case "revenue": return buildRevenueView(world);
    case "geographic": return buildMapView(world);
    case "decision": return buildMemoryView(memory);
    case "workflow": return buildActionsView(memory);
  }
}

export function buildRailAuditViews(world: World, memory: MemoryState): RailViewModel[] {
  return [buildHomeRailView(world, memory), ...RAIL_AREAS.map((area) => buildRailView(area, world, memory))];
}
