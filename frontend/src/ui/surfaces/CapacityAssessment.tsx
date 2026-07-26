import type { World } from "../../app/useWorld.ts";
import { computeMetric } from "../../metrics/catalog.ts";
import { formatMetricValue } from "../../metrics/chartSpec.ts";
import { OperatingSnapshot } from "../operating/OperatingSnapshot.tsx";
import { SurfaceHeader } from "../primitives.tsx";
import { sourceFreshness, sourceModeLabel, sourcePermissionLabel } from "../../app/sourceRegistry.ts";

export function CapacityAssessment({ world }: { world: World }) {
  const utilization = computeMetric("capacity_utilization", world);
  const delivery = computeMetric("on_time_delivery", world);
  const backlog = computeMetric("backlog", world);
  const openDemand = world.opportunities.filter((opp) => opp.stage !== "won" && opp.stage !== "lost").reduce((sum, opp) => sum + (opp.value ?? 0), 0);

  return (
    <section className="surface-page" data-surface-component="surface-capacity-assessment">
      <SurfaceHeader
        eyebrow="Capacity assessment"
        headline="Machining capacity compared with committed backlog and visible demand."
        subline="A compact production view for work-center load, delivery risk, backlog, and open demand."
      />
      <div className="account360-kpis">
        <div><span>Work-center load</span><strong>{formatMetricValue(utilization.value, utilization.unit)}</strong></div>
        <div><span>Modeled OTD</span><strong>{formatMetricValue(delivery.value, delivery.unit)}</strong></div>
        <div><span>Backlog</span><strong>{formatMetricValue(backlog.value, backlog.unit)}</strong></div>
        <div><span>Open demand</span><strong>{formatMetricValue(openDemand, "$")}</strong></div>
      </div>
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
