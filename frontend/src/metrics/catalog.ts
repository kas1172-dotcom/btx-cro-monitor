import revenueData from "../../data/demo/btx/account_monthly_revenue.json";
import pipelineSnapshotsData from "../../data/demo/btx/pipeline_snapshots.json";
import bookingsBacklogData from "../../data/demo/btx/bookings_backlog.json";
import capacityUtilizationData from "../../data/demo/btx/capacity_utilization.json";
import winLossData from "../../data/demo/btx/win_loss_history.json";
import type { World } from "../app/useWorld.ts";
import type { MetricDefinition, MetricFilters, MetricId, MetricResult, TimeRange } from "./types.ts";
import { inMonthRange } from "./time.ts";

interface RevenueRow { month: string; account_id: string; revenue: number; gross_margin_pct: number }
interface PipelineRow { month: string; open_pipeline_value: number; weighted_pipeline_value: number; prospect_count: number }
interface BookingsRow { month: string; bookings: number; backlog: number; shipments: number }
interface CapacityRow { month: string; facility_id: string; utilization_pct: number; available_5_axis_hours: number; quoted_lead_time_days: number }
interface WinLossRow { month: string; wins: number; losses: number; win_value: number; loss_value: number }

const revenueRows = revenueData as RevenueRow[];
const pipelineRows = pipelineSnapshotsData as PipelineRow[];
const bookingsRows = bookingsBacklogData as BookingsRow[];
const capacityRows = capacityUtilizationData as CapacityRow[];
const winLossRows = winLossData as WinLossRow[];

function inRange(month: string, range?: TimeRange): boolean {
  return inMonthRange(month, range);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function avg(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function result(value: number, label: string, unit: MetricResult["unit"], source: string, records: string[]): MetricResult {
  return {
    value: Math.round(value * 100) / 100,
    label,
    unit,
    provenance: [{ source, records, reason: `Computed ${label} from deterministic demo records.` }],
  };
}

function revenueSlice(filters?: MetricFilters, timeRange?: TimeRange): RevenueRow[] {
  return revenueRows.filter((row) => (!filters?.accountId || row.account_id === filters.accountId) && inRange(row.month, timeRange));
}

export const METRICS: Record<MetricId, MetricDefinition> = {
  revenue: {
    id: "revenue",
    label: "Revenue",
    definition: "Recognized monthly revenue from current customer accounts.",
    unit: "$",
    compute: (_world, filters, range) => result(sum(revenueSlice(filters, range).map((r) => r.revenue)), "Revenue", "$", "account_monthly_revenue.json", revenueSlice(filters, range).map((r) => `${r.account_id}:${r.month}`)),
  },
  bookings: {
    id: "bookings",
    label: "Bookings",
    definition: "New orders booked in the selected period.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(sum(rows.map((r) => r.bookings)), "Bookings", "$", "bookings_backlog.json", rows.map((r) => r.month));
    },
  },
  backlog: {
    id: "backlog",
    label: "Backlog",
    definition: "Committed production backlog at month end.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(rows.at(-1)?.backlog ?? avg(rows.map((r) => r.backlog)), "Backlog", "$", "bookings_backlog.json", rows.map((r) => r.month));
    },
  },
  book_to_bill: {
    id: "book_to_bill",
    label: "Book-to-bill",
    definition: "Bookings divided by shipments.",
    unit: "ratio",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(sum(rows.map((r) => r.bookings)) / Math.max(1, sum(rows.map((r) => r.shipments))), "Book-to-bill", "ratio", "bookings_backlog.json", rows.map((r) => r.month));
    },
  },
  pipeline_coverage: {
    id: "pipeline_coverage",
    label: "Pipeline coverage",
    definition: "Weighted pipeline divided by average monthly revenue.",
    unit: "ratio",
    compute: (world, filters, range) => {
      const rows = pipelineRows.filter((r) => inRange(r.month, range));
      const quarterlyRevenue = sum(revenueSlice(filters, range).map((r) => r.revenue));
      const weightedPipe = rows.at(-1)?.weighted_pipeline_value ?? avg(rows.map((r) => r.weighted_pipeline_value));
      return result(weightedPipe / Math.max(1, quarterlyRevenue / 3), "Pipeline coverage", "ratio", "pipeline_snapshots.json", world.opportunities.map((o) => o.id));
    },
  },
  win_rate: {
    id: "win_rate",
    label: "Win rate",
    definition: "Won opportunities divided by won plus lost opportunities.",
    unit: "%",
    compute: (_world, _filters, range) => {
      const rows = winLossRows.filter((r) => inRange(r.month, range));
      const wins = sum(rows.map((r) => r.wins));
      const losses = sum(rows.map((r) => r.losses));
      return result((wins / Math.max(1, wins + losses)) * 100, "Win rate", "%", "win_loss_history.json", rows.map((r) => r.month));
    },
  },
  avg_order_value: {
    id: "avg_order_value",
    label: "Average order value",
    definition: "Average value of won orders in the selected period.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = winLossRows.filter((r) => inRange(r.month, range));
      return result(sum(rows.map((r) => r.win_value)) / Math.max(1, sum(rows.map((r) => r.wins))), "Average order value", "$", "win_loss_history.json", rows.map((r) => r.month));
    },
  },
  margin_trend: {
    id: "margin_trend",
    label: "Margin trend",
    definition: "Average gross margin percentage across monthly revenue records.",
    unit: "%",
    compute: (_world, filters, range) => result(avg(revenueSlice(filters, range).map((r) => r.gross_margin_pct)) * 100, "Margin trend", "%", "account_monthly_revenue.json", revenueSlice(filters, range).map((r) => `${r.account_id}:${r.month}`)),
  },
  customer_concentration: {
    id: "customer_concentration",
    label: "Customer concentration",
    definition: "Largest account share of selected-period revenue.",
    unit: "%",
    compute: (_world, _filters, range) => {
      const byAccount = new Map<string, number>();
      for (const row of revenueSlice(undefined, range)) byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? 0) + row.revenue);
      const total = sum([...byAccount.values()]);
      return result((Math.max(0, ...byAccount.values()) / Math.max(1, total)) * 100, "Customer concentration", "%", "account_monthly_revenue.json", [...byAccount.keys()]);
    },
  },
  capacity_utilization: {
    id: "capacity_utilization",
    label: "Capacity utilization",
    definition: "Average work-center utilization percentage.",
    unit: "%",
    compute: (_world, _filters, range) => result(avg(capacityRows.filter((r) => inRange(r.month, range)).map((r) => r.utilization_pct)), "Capacity utilization", "%", "capacity_utilization.json", capacityRows.map((r) => `${r.facility_id}:${r.month}`)),
  },
  on_time_delivery: {
    id: "on_time_delivery",
    label: "On-time delivery",
    definition: "Modeled delivery performance from lead-time pressure.",
    unit: "%",
    compute: (_world, _filters, range) => {
      const lead = avg(capacityRows.filter((r) => inRange(r.month, range)).map((r) => r.quoted_lead_time_days));
      return result(Math.max(70, 98 - lead * 0.8), "On-time delivery", "%", "capacity_utilization.json", capacityRows.map((r) => `${r.facility_id}:${r.month}`));
    },
  },
  repeat_revenue_rate: {
    id: "repeat_revenue_rate",
    label: "Repeat-revenue rate",
    definition: "Share of current customers with revenue in at least 18 of 24 months.",
    unit: "%",
    compute: (_world) => {
      const byAccount = new Map<string, Set<string>>();
      for (const row of revenueRows) {
        if (row.revenue > 0) byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? new Set()).add(row.month));
      }
      const repeat = [...byAccount.values()].filter((months) => months.size >= 18).length;
      return result((repeat / Math.max(1, byAccount.size)) * 100, "Repeat-revenue rate", "%", "account_monthly_revenue.json", [...byAccount.keys()]);
    },
  },
  pipeline_by_stage: {
    id: "pipeline_by_stage",
    label: "Pipeline by stage",
    definition: "Open pipeline value across prospecting, qualified, and proposal stages.",
    unit: "$",
    compute: (world) => result(sum(world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").map((o) => o.value)), "Pipeline by stage", "$", "opportunities.json", world.opportunities.map((o) => o.id)),
  },
  revenue_yoy_change: {
    id: "revenue_yoy_change",
    label: "Revenue YoY change",
    definition: "Latest 12 months revenue change versus prior 12 months.",
    unit: "%",
    compute: (_world, filters) => {
      const rows = revenueSlice(filters).sort((a, b) => a.month.localeCompare(b.month));
      const current = rows.slice(-12);
      const prior = rows.slice(-24, -12);
      return result(((sum(current.map((r) => r.revenue)) - sum(prior.map((r) => r.revenue))) / Math.max(1, sum(prior.map((r) => r.revenue)))) * 100, "Revenue YoY change", "%", "account_monthly_revenue.json", rows.map((r) => `${r.account_id}:${r.month}`));
    },
  },
};

export function computeMetric(id: MetricId, world: World, filters?: MetricFilters, timeRange?: TimeRange): MetricResult {
  return METRICS[id].compute(world, filters, timeRange);
}
