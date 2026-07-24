import type { World } from "../app/useWorld.ts";
import type { MetricDefinition, MetricFilters, MetricId, MetricResult, TimeRange } from "./types.ts";
import { inMonthRange } from "./time.ts";

interface RevenueRow { month: string; account_id: string; revenue: number; gross_margin_pct: number }
interface PipelineRow { month: string; open_pipeline_value: number; weighted_pipeline_value: number; prospect_count: number }
interface BookingsRow { month: string; bookings: number; backlog: number; shipments: number }
interface CapacityRow { month: string; facility_id: string; utilization_pct: number; available_5_axis_hours: number; quoted_lead_time_days: number }
interface WinLossRow { month: string; wins: number; losses: number; win_value: number; loss_value: number }

const revenueRows: RevenueRow[] = [];
const pipelineRows: PipelineRow[] = [];
const bookingsRows: BookingsRow[] = [];
const capacityRows: CapacityRow[] = [];
const winLossRows: WinLossRow[] = [];

function inRange(month: string, range?: TimeRange): boolean {
  return inMonthRange(month, range);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function avg(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function result(value: number | null, label: string, unit: MetricResult["unit"], source: string, records: string[]): MetricResult {
  return {
    value: value === null ? null : Math.round(value * 100) / 100,
    label,
    unit,
    provenance: [{ source, records, reason: `Computed ${label} from approved source records.` }],
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
    compute: (_world, filters, range) => {
      const rows = revenueSlice(filters, range);
      return result(rows.length ? sum(rows.map((r) => r.revenue)) : null, "Revenue", "$", "operating.revenue", rows.map((r) => `${r.account_id}:${r.month}`));
    },
  },
  bookings: {
    id: "bookings",
    label: "Bookings",
    definition: "New orders booked in the selected period.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(rows.length ? sum(rows.map((r) => r.bookings)) : null, "Bookings", "$", "operating.bookings", rows.map((r) => r.month));
    },
  },
  backlog: {
    id: "backlog",
    label: "Backlog",
    definition: "Committed production backlog at month end.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(rows.length ? rows.at(-1)?.backlog ?? avg(rows.map((r) => r.backlog)) : null, "Backlog", "$", "operating.backlog", rows.map((r) => r.month));
    },
  },
  book_to_bill: {
    id: "book_to_bill",
    label: "Book-to-bill",
    definition: "Bookings divided by shipments.",
    unit: "ratio",
    compute: (_world, _filters, range) => {
      const rows = bookingsRows.filter((r) => inRange(r.month, range));
      return result(rows.length ? sum(rows.map((r) => r.bookings)) / Math.max(1, sum(rows.map((r) => r.shipments))) : null, "Book-to-bill", "ratio", "operating.bookings", rows.map((r) => r.month));
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
      return result(rows.length && quarterlyRevenue > 0 ? weightedPipe / Math.max(1, quarterlyRevenue / 3) : null, "Pipeline coverage", "ratio", "operating.pipeline", world.opportunities.map((o) => o.id));
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
      return result(rows.length && wins + losses > 0 ? (wins / (wins + losses)) * 100 : null, "Win rate", "%", "operating.win_loss", rows.map((r) => r.month));
    },
  },
  avg_order_value: {
    id: "avg_order_value",
    label: "Average order value",
    definition: "Average value of won orders in the selected period.",
    unit: "$",
    compute: (_world, _filters, range) => {
      const rows = winLossRows.filter((r) => inRange(r.month, range));
      const wins = sum(rows.map((r) => r.wins));
      return result(rows.length && wins > 0 ? sum(rows.map((r) => r.win_value)) / wins : null, "Average order value", "$", "operating.win_loss", rows.map((r) => r.month));
    },
  },
  margin_trend: {
    id: "margin_trend",
    label: "Margin trend",
    definition: "Average gross margin percentage across monthly revenue records.",
    unit: "%",
    compute: (_world, filters, range) => {
      const rows = revenueSlice(filters, range);
      return result(rows.length ? avg(rows.map((r) => r.gross_margin_pct)) * 100 : null, "Margin trend", "%", "operating.revenue", rows.map((r) => `${r.account_id}:${r.month}`));
    },
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
      return result(total > 0 ? (Math.max(0, ...byAccount.values()) / total) * 100 : null, "Customer concentration", "%", "operating.revenue", [...byAccount.keys()]);
    },
  },
  capacity_utilization: {
    id: "capacity_utilization",
    label: "Work-center load",
    definition: "Average work-center load percentage.",
    unit: "%",
    compute: (_world, _filters, range) => {
      const rows = capacityRows.filter((r) => inRange(r.month, range));
      return result(rows.length ? avg(rows.map((r) => r.utilization_pct)) : null, "Work-center load", "%", "operating.capacity", rows.map((r) => `${r.facility_id}:${r.month}`));
    },
  },
  on_time_delivery: {
    id: "on_time_delivery",
    label: "On-time delivery",
    definition: "Modeled delivery performance from lead-time pressure.",
    unit: "%",
    compute: (_world, _filters, range) => {
      const rows = capacityRows.filter((r) => inRange(r.month, range));
      return result(rows.length ? null : null, "On-time delivery", "%", "operating.delivery", rows.map((r) => `${r.facility_id}:${r.month}`));
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
      return result(byAccount.size ? (repeat / byAccount.size) * 100 : null, "Repeat-revenue rate", "%", "operating.revenue", [...byAccount.keys()]);
    },
  },
  pipeline_by_stage: {
    id: "pipeline_by_stage",
    label: "Pipeline by stage",
    definition: "Open pipeline value across prospecting, qualified, and proposal stages.",
    unit: "$",
    compute: (world) => {
      const open = world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost" && o.value !== null);
      return result(open.length ? sum(open.map((o) => o.value ?? 0)) : null, "Pipeline by stage", "$", "backend.opportunities", open.map((o) => o.id));
    },
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
      const priorRevenue = sum(prior.map((r) => r.revenue));
      return result(current.length && priorRevenue > 0 ? ((sum(current.map((r) => r.revenue)) - priorRevenue) / priorRevenue) * 100 : null, "Revenue YoY change", "%", "operating.revenue", rows.map((r) => `${r.account_id}:${r.month}`));
    },
  },
};

export function computeMetric(id: MetricId, world: World, filters?: MetricFilters, timeRange?: TimeRange): MetricResult {
  return METRICS[id].compute(world, filters, timeRange);
}
