import type { World } from "../../app/useWorld.ts";
import { useWorkItems } from "../../app/workItems.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { EmptyState, ListRow, SignalCard, SurfaceHeader } from "../primitives.tsx";

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
      <SurfaceHeader
        eyebrow="Today's revenue brief"
        headline={`${attention.items.length} items need attention; ${prepared.items.length} prepared artifacts are ready.`}
        subline="External monitor signals, live account context, and queued work items in one operating brief."
      />
      <WorkItemSourceNote source={attention.source} error={attention.error} />

      <div className="brief-grid">
        <section className="surface-panel">
          <div className="panel-head"><h2>What changed</h2></div>
          <div className="signal-mini-list">
            {topSignals.map((signal) => (
              <SignalCard
                key={signal.id}
                title={signalHeadline(signal)}
                scope={signal.scope}
                source={`${nameOf(world, signal.scope === "specific_account" ? signal.subject_id : null)} · ${signalSourceName(signal)}`}
                date={signalSourceDate(signal)}
                body={signal.source_quote}
                provenance={{
                  entity: signal.entities[0] ?? nameOf(world, signal.scope === "specific_account" ? signal.subject_id : null),
                  method: signal.relationships?.[0]?.match_method,
                  confidence: signal.relationships?.[0]?.confidence ?? signal.confidence,
                }}
              />
            ))}
            {topSignals.length === 0 && <EmptyState headline="No validated changes" body="Monitor artifacts are available, but no signal cleared validation for this brief." icon="signal" />}
          </div>
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Needs attention</h2></div>
          <WorkItemList items={attention.items.slice(0, 5)} empty="No urgent work items." world={world} />
        </section>
        <section className="surface-panel">
          <div className="panel-head"><h2>Prepared</h2></div>
          {prepared.items.slice(0, 5).map((item) => (
            <ListRow key={item.id} name={item.recommended_action} subtitle={`${item.status} · ${nameOf(world, item.canonical_account_id)}`} />
          ))}
          {prepared.items.length === 0 && <EmptyState headline="No prepared artifacts" body="Meeting briefs, drafts, and memos will appear here when they are ready for review." icon="document" />}
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
