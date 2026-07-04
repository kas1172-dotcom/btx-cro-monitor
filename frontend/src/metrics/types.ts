import type { World } from "../app/useWorld.ts";
import type { ProvenanceEntry } from "../deliverables/types.ts";

export type MetricId =
  | "revenue"
  | "bookings"
  | "backlog"
  | "book_to_bill"
  | "pipeline_coverage"
  | "win_rate"
  | "avg_order_value"
  | "margin_trend"
  | "customer_concentration"
  | "capacity_utilization"
  | "on_time_delivery"
  | "repeat_revenue_rate"
  | "pipeline_by_stage"
  | "revenue_yoy_change";

export interface MetricFilters {
  accountId?: string;
  region?: string;
  segment?: string;
  min_value?: number;
}

export interface TimeRange {
  from: string;
  to: string;
}

export interface QuarterWindow extends TimeRange {
  label: string;
  quarter: number;
  year: number;
}

export interface MetricResult {
  value: number;
  label: string;
  unit: "$" | "%" | "ratio" | "count";
  provenance: ProvenanceEntry[];
}

export interface MetricDefinition {
  id: MetricId;
  label: string;
  definition: string;
  unit: MetricResult["unit"];
  compute: (world: World, filters?: MetricFilters, timeRange?: TimeRange) => MetricResult;
}

export interface ChartSpec {
  viz: "heatmap" | "trend" | "ranked_bar" | "retention_grid";
  metric: MetricId;
  rows?: "account" | "segment" | "region";
  cols?: "month" | "quarter" | "program";
  color?: MetricId;
  filters?: MetricFilters;
  sort?: string;
  timeRange?: TimeRange;
}

export interface ChartLegend {
  colorEncodes: string;
  min: number | null;
  max: number | null;
  midLabel: string;
  qtdNote: string;
}

export interface ChartResult {
  spec: ChartSpec;
  meta: { label: string; unit: MetricResult["unit"] };
  provenance: ProvenanceEntry[];
  grid?: { rows: string[]; cols: string[]; values: (number | null)[][]; qtdCols: string[] };
  series?: Array<{ label: string; points: Array<{ x: string; y: number }>; qtdPoints?: number[] }>;
  legend?: ChartLegend;
}
