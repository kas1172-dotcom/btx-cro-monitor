import revenueData from "../../data/demo/btx/account_monthly_revenue.json";
import pipelineSnapshotsData from "../../data/demo/btx/pipeline_snapshots.json";
import bookingsBacklogData from "../../data/demo/btx/bookings_backlog.json";
import capacityUtilizationData from "../../data/demo/btx/capacity_utilization.json";
import winLossData from "../../data/demo/btx/win_loss_history.json";
import type { World } from "../app/useWorld.ts";
import { computeMetric, METRICS } from "./catalog.ts";
import type { ChartLegend, ChartResult, ChartSpec } from "./types.ts";
import { inMonthRange } from "./time.ts";

export function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) return "\u2014";
  if (unit === "$") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
    return `$${Math.round(value)}`;
  }
  if (unit === "%") return `${Math.round(value)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return String(Math.round(value));
}

interface RevenueRow { month: string; account_id: string; revenue: number }
interface PipelineRow { month: string; open_pipeline_value: number; weighted_pipeline_value: number }
interface BookingsRow { month: string; bookings: number; backlog: number; shipments: number }
interface CapacityRow { month: string; utilization_pct: number }
interface WinLossRow { month: string; wins: number; losses: number; win_value: number }

const revenueRows = revenueData as RevenueRow[];
const pipelineRows = pipelineSnapshotsData as PipelineRow[];
const bookingsRows = bookingsBacklogData as BookingsRow[];
const capacityRows = capacityUtilizationData as CapacityRow[];
const winLossRows = winLossData as WinLossRow[];

function quarter(month: string): string {
  const [year, monthText] = month.split("-");
  const q = Math.floor((Number(monthText) - 1) / 3) + 1;
  return `${year} Q${q}`;
}

function quarterLabels(rows: RevenueRow[]): Map<string, string> {
  const monthsByQuarter = new Map<string, Set<string>>();
  for (const row of rows) {
    const label = quarter(row.month);
    monthsByQuarter.set(label, (monthsByQuarter.get(label) ?? new Set()).add(row.month));
  }
  const latestMonth = rows.map((row) => row.month).sort().at(-1);
  const latestQuarter = latestMonth ? quarter(latestMonth) : null;
  return new Map([...monthsByQuarter.entries()].map(([label, months]) => [
    label,
    label === latestQuarter && months.size < 3 ? `${label} (QTD)` : label,
  ]));
}

function accountName(world: World, id: string): string {
  return world.companies.find((c) => c.id === id)?.name ?? id;
}

export function computeChart(spec: ChartSpec, world: World): ChartResult {
  const metric = METRICS[spec.metric];
  if (spec.viz === "trend") {
    const rows = trendRows(spec);
    const byMonth = new Map<string, number>();
    for (const row of rows) byMonth.set(row.x, (byMonth.get(row.x) ?? 0) + row.y);
    return {
      spec,
      meta: { label: metric.label, unit: metric.unit },
      provenance: computeMetric(spec.metric, world, spec.filters, spec.timeRange).provenance,
      series: [{ label: metric.label, points: [...byMonth.entries()].map(([x, y]) => ({ x, y })) }],
      legend: { colorEncodes: "Value over time", min: null, max: null, midLabel: "", qtdNote: "" },
    };
  }

  if (spec.viz === "ranked_bar") {
    const byAccount = new Map<string, number>();
    for (const row of revenueRows.filter((r) => inMonthRange(r.month, spec.timeRange))) byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? 0) + row.revenue);
    const sorted = [...byAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const rankedValues = sorted.map(([, y]) => y);
    return {
      spec,
      meta: { label: metric.label, unit: metric.unit },
      provenance: computeMetric(spec.metric, world, spec.filters, spec.timeRange).provenance,
      series: [{ label: metric.label, points: sorted.map(([id, y]) => ({ x: accountName(world, id), y })) }],
      legend: buildHeatmapLegend(rankedValues, metric.unit),
    };
  }

  const scopedRevenueRows = revenueRows.filter((r) => inMonthRange(r.month, spec.timeRange));
  const quarterLabelByBase = quarterLabels(scopedRevenueRows);
  const colForMonth = (month: string) => spec.cols === "quarter" ? quarterLabelByBase.get(quarter(month)) ?? quarter(month) : month;
  const cols = [...new Set(scopedRevenueRows.map((r) => colForMonth(r.month)))];
  const accountIds = [...new Set(scopedRevenueRows.map((r) => r.account_id))];
  const values: (number | null)[][] = accountIds.map((accountId) => cols.map((col) => {
    const rows = scopedRevenueRows.filter((row) => row.account_id === accountId && colForMonth(row.month) === col);
    if (rows.length === 0) return null;
    return rows.reduce((sum, row) => sum + row.revenue, 0);
  }));
  const qtdCols = cols.filter((col) => col.includes("(QTD)"));
  const fullPeriodValues = values.flatMap((row) => row.filter((value, index): value is number => value !== null && !qtdCols.includes(cols[index])));
  const legend = buildHeatmapLegend(fullPeriodValues, metric.unit);
  return {
    spec,
    meta: { label: metric.label, unit: metric.unit },
    provenance: computeMetric(spec.metric, world, spec.filters, spec.timeRange).provenance,
    grid: { rows: accountIds.map((id) => accountName(world, id)), cols, values, qtdCols },
    legend,
  };
}

function buildHeatmapLegend(fullPeriodValues: number[], unit: string): ChartLegend {
  const min = fullPeriodValues.length ? Math.min(...fullPeriodValues) : null;
  const max = fullPeriodValues.length ? Math.max(...fullPeriodValues) : null;
  const mid = min !== null && max !== null ? (min + max) / 2 : null;
  return {
    colorEncodes: `${unit === "$" ? "Revenue" : "Value"} (darker = higher)`,
    min,
    max,
    midLabel: formatMetricValue(mid, unit),
    qtdNote: "Hatched columns are quarter-to-date (incomplete period)",
  };
}

function trendRows(spec: ChartSpec): Array<{ x: string; y: number }> {
  if (spec.metric === "bookings") return bookingsRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: r.bookings }));
  if (spec.metric === "backlog") return bookingsRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: r.backlog }));
  if (spec.metric === "book_to_bill") return bookingsRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: r.bookings / Math.max(1, r.shipments) }));
  if (spec.metric === "pipeline_coverage") return pipelineRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: r.weighted_pipeline_value }));
  if (spec.metric === "capacity_utilization") {
    const byMonth = new Map<string, number[]>();
    for (const row of capacityRows.filter((r) => inMonthRange(r.month, spec.timeRange))) byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row.utilization_pct]);
    return [...byMonth.entries()].map(([x, values]) => ({ x, y: values.reduce((a, b) => a + b, 0) / values.length }));
  }
  if (spec.metric === "win_rate") return winLossRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: (r.wins / Math.max(1, r.wins + r.losses)) * 100 }));
  if (spec.metric === "avg_order_value") return winLossRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((r) => ({ x: r.month, y: r.win_value / Math.max(1, r.wins) }));
  return revenueRows.filter((r) => inMonthRange(r.month, spec.timeRange)).map((row) => ({ x: row.month, y: row.revenue }));
}
