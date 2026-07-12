import type { World } from "../../app/useWorld.ts";
import { computeMetric } from "../../metrics/catalog.ts";
import { formatMetricValue } from "../../metrics/chartSpec.ts";
import { OperatingSnapshot } from "../operating/OperatingSnapshot.tsx";

export function CapacityAssessment({ world }: { world: World }) {
  const utilization = computeMetric("capacity_utilization", world);
  const delivery = computeMetric("on_time_delivery", world);
  const backlog = computeMetric("backlog", world);
  const openDemand = world.opportunities.filter((opp) => opp.stage !== "won" && opp.stage !== "lost").reduce((sum, opp) => sum + opp.value, 0);

  return (
    <section className="surface-page" data-surface-component="surface-capacity-assessment">
      <div className="quiet-view-head">
        <p className="eyebrow">Capacity Assessment</p>
        <h1>Machining capacity compared with committed backlog and visible demand.</h1>
      </div>
      <div className="account360-kpis">
        <div><span>Utilization</span><strong>{formatMetricValue(utilization.value, utilization.unit)}</strong></div>
        <div><span>Modeled OTD</span><strong>{formatMetricValue(delivery.value, delivery.unit)}</strong></div>
        <div><span>Backlog</span><strong>{formatMetricValue(backlog.value, backlog.unit)}</strong></div>
        <div><span>Open demand</span><strong>{formatMetricValue(openDemand, "$")}</strong></div>
      </div>
      <OperatingSnapshot />
    </section>
  );
}
