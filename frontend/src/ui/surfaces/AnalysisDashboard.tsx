import type { World } from "../../app/useWorld.ts";
import { computeMetric } from "../../metrics/catalog.ts";
import { formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartSpec, MetricId } from "../../metrics/types.ts";
import { AnalysisView } from "../analysis/AnalysisView.tsx";
import { RetentionEarningsHeatmap } from "../../deliverables/steelSignalTemplates.tsx";
import { SurfaceHeader } from "../primitives.tsx";

const PRIMARY_METRICS: MetricId[] = ["pipeline_coverage", "bookings", "backlog", "book_to_bill", "win_rate", "capacity_utilization"];

const DEFAULT_SPEC: ChartSpec = {
  metric: "revenue",
  viz: "heatmap",
  rows: "account",
  cols: "quarter",
};

export function AnalysisDashboard({ world }: { world: World }) {
  return (
    <section className="surface-page" data-surface-component="surface-analysis-dashboard">
      <SurfaceHeader
        eyebrow="Analysis dashboard"
        headline="Pipeline, bookings, backlog, win rate, and production-load trends."
        subline="Revenue views for account planning, board updates, and client-ready figures."
      />
      <div className="account360-kpis">
        {PRIMARY_METRICS.map((metricId) => {
          const metric = computeMetric(metricId, world);
          return (
            <div key={metricId}>
              <span>{metric.label}</span>
              <strong>{formatMetricValue(metric.value, metric.unit)}</strong>
            </div>
          );
        })}
      </div>
      <AnalysisView world={world} initialSpec={DEFAULT_SPEC} />
      <section className="analysis-internal-heatmap" aria-label="Internal retention and earnings heat map">
        <RetentionEarningsHeatmap world={world} />
      </section>
    </section>
  );
}
