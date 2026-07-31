import type { World } from "../../app/useWorld.ts";
import { computeMetric } from "../../metrics/catalog.ts";
import { formatMetricValue } from "../../metrics/chartSpec.ts";
import { OperatingSnapshot } from "../operating/OperatingSnapshot.tsx";
import { SurfaceHeader } from "../primitives.tsx";
import { sourceFreshness, sourceModeLabel, sourcePermissionLabel } from "../../app/sourceRegistry.ts";
import { canonicalMetrics, formatCanonicalMetric } from "../../app/canonicalMetrics.ts";

export function CapacityAssessment({ world }: { world: World }) {
  const utilization = computeMetric("capacity_utilization", world);
  const delivery = computeMetric("on_time_delivery", world);
  const backlog = computeMetric("backlog", world);
  const openDemand = computeMetric("pipeline_by_stage", world);
  const canonical = canonicalMetrics(world);
  const crmAccounts = formatCanonicalMetric(canonical.crm_synced_accounts);
  const accountRecords = formatCanonicalMetric(canonical.total_accounts);

  return (
    <section className="surface-page" data-surface-component="surface-capacity-assessment">
      <SurfaceHeader
        eyebrow="Capacity assessment"
        headline="Machining capacity compared with committed backlog and visible demand."
        subline="A compact production view for work-center load, delivery risk, backlog, and open demand."
      />
      <div className="account360-kpis">
        <div>
          <span>{crmAccounts.label}</span>
          <strong>{crmAccounts.displayValue}</strong>
          <em>{crmAccounts.provenanceLabel}{crmAccounts.unavailableReason ? ` · ${crmAccounts.unavailableReason}` : ""}</em>
        </div>
        <div>
          <span>{accountRecords.label}</span>
          <strong>{accountRecords.displayValue}</strong>
          <em>{accountRecords.provenanceLabel}</em>
        </div>
        {[utilization, delivery, backlog, openDemand].map((metric) => (
          <div key={metric.label}><span>{metric.label}</span><strong>{metric.state === "available" ? formatMetricValue(metric.value, metric.unit) : metric.state === "stale" ? `Stale: ${formatMetricValue(metric.value, metric.unit)}` : metric.state === "error" ? "Source error" : "Not available"}</strong><em>{metric.reason}</em></div>
        ))}
      </div>
      <section className="surface-panel capacity-mobile-context" aria-labelledby="capacity-context-title">
        <h2 id="capacity-context-title">Account and demand context</h2>
        <p>Mobile and desktop views use the same context: CRM-synced accounts, total account records, production metrics, current source health, and the operating snapshot below.</p>
      </section>
      <section className="surface-panel">
        <div className="panel-head"><h2>Current data sources</h2><span>{world.sources.length} registered</span></div>
        <div className="hubspot-mini-list">
          {world.sources.map((source) => {
            const freshness = sourceFreshness(source);
            return (
              <article key={source.id}>
                <span>{source.environment}</span>
                <strong>{source.name}: {sourceModeLabel(source)}</strong>
                <em>{sourcePermissionLabel(source)} · {freshness.relative} · {freshness.exact}</em>
              </article>
            );
          })}
        </div>
      </section>
      <OperatingSnapshot />
    </section>
  );
}
