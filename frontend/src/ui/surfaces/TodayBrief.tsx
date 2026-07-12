import type { World } from "../../app/useWorld.ts";
import { useWorkItems } from "../../app/workItems.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";

function nameOf(world: World, id: string | null): string {
  if (!id) return "Portfolio";
  return world.companies.find((company) => company.id === id)?.name ?? id;
}

export function TodayBrief({ world }: { world: World }) {
  const changed = useWorkItems(world, "what_changed");
  const attention = useWorkItems(world, "needs_attention");
  const prepared = useWorkItems(world, "prepared");
  const approval = useWorkItems(world, "needs_approval");
  const outcomes = useWorkItems(world, "outcomes");
  const topSignals = [...world.analysis.valid]
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at) || b.confidence - a.confidence)
    .slice(0, 3);

  return (
    <section className="surface-page" data-surface-component="surface-todays-brief">
      <div className="quiet-view-head">
        <p className="eyebrow">Today's Revenue Brief</p>
        <h1>{attention.items.length} items need attention; {prepared.items.length} prepared artifacts are ready.</h1>
      </div>
      <WorkItemSourceNote source={attention.source} error={attention.error} />

      <div className="brief-grid">
        <section className="surface-panel">
          <div className="panel-head"><h2>What changed</h2></div>
          <div className="signal-mini-list">
            {topSignals.map((signal) => (
              <article key={signal.id}>
                <strong>{signalHeadline(signal)}</strong>
                <span>{nameOf(world, signal.scope === "specific_account" ? signal.subject_id : null)} · {signalSourceName(signal)} {signalSourceDate(signal)}</span>
                <em>{signal.source_quote}</em>
              </article>
            ))}
            {topSignals.length === 0 && <div className="rail-quiet-empty">No validated monitor changes.</div>}
          </div>
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Needs attention</h2></div>
          <WorkItemList items={attention.items.slice(0, 5)} empty="No urgent work items." world={world} />
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Prepared</h2></div>
          <WorkItemList items={prepared.items.slice(0, 5)} empty="No prepared artifacts." world={world} />
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Needs approval</h2></div>
          <WorkItemList items={approval.items.slice(0, 5)} empty="No approvals pending." world={world} />
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Outcomes</h2></div>
          <WorkItemList items={outcomes.items.slice(0, 5)} empty="No recent outcomes yet." world={world} />
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Queue snapshot</h2></div>
          <WorkItemList items={changed.items.slice(0, 5)} empty="No source-backed work items." world={world} />
        </section>
      </div>
    </section>
  );
}
