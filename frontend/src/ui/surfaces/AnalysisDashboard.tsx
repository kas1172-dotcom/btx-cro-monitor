import type { World } from "../../app/useWorld.ts";
import { computeMetric } from "../../metrics/catalog.ts";
import { formatMetricValue } from "../../metrics/chartSpec.ts";
import type { ChartSpec, MetricId } from "../../metrics/types.ts";
import { AnalysisView } from "../analysis/AnalysisView.tsx";
import { SurfaceHeader } from "../primitives.tsx";

const PRIMARY_METRICS: MetricId[] = ["pipeline_coverage", "bookings", "backlog", "book_to_bill", "win_rate", "capacity_utilization"];

const DEFAULT_SPEC: ChartSpec = {
  metric: "revenue",
  viz: "heatmap",
  rows: "account",
  cols: "quarter",
};

export function AnalysisDashboard({ world }: { world: World }) {
  const metrics = PRIMARY_METRICS.map((metricId) => computeMetric(metricId, world));
  const hasApprovedAnalytics = metrics.some((metric) =>
    metric.value !== null && metric.provenance.some((source) => source.records.length > 0)
  );
  return (
    <section className="surface-page" data-surface-component="surface-analysis-dashboard">
      <SurfaceHeader
        eyebrow="Analysis dashboard"
        headline="Pipeline, bookings, backlog, win rate, and production-load trends."
        subline="Revenue views for account planning, board updates, and client-ready figures."
      />
      <div className="account360-kpis">
        {PRIMARY_METRICS.map((metricId, index) => {
          const metric = metrics[index];
          return (
            <div key={metricId}>
              <span>{metric.label}</span>
              <strong>{formatMetricValue(metric.value, metric.unit)}</strong>
            </div>
          );
        })}
      </div>
      {hasApprovedAnalytics ? (
        <AnalysisView world={world} initialSpec={DEFAULT_SPEC} />
      ) : (
        <section className="surface-panel">
          <h2>Financial analysis unavailable</h2>
          <p>No approved revenue, bookings, backlog, win-loss, or operating-capacity dataset is connected. Precise figures and concentration conclusions are suppressed.</p>
          <div className="assumption-box">
            <strong>Data basis</strong>
            <p>Required source: approved financial or operating records with a retrieval timestamp and validation status.</p>
          </div>
        </section>
      )}
    </section>
  );
}
