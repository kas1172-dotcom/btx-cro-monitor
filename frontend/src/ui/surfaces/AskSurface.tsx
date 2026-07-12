import type { World } from "../../app/useWorld.ts";
import { useWorkItems } from "../../app/workItems.ts";
import { AskBrainBar } from "../brain/AskBrainBar.tsx";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { SurfaceHeader } from "../primitives.tsx";

export function AskSurface({ world }: { world: World }) {
  const attention = useWorkItems(world, "needs_attention");
  return (
    <section className="surface-page ask-surface" data-surface-component="surface-ask">
      <SurfaceHeader
        eyebrow="Ask"
        headline="Ask one primary assistant about accounts, signals, pipeline, capacity, or next actions."
        subline="Answers stay grounded in live accounts, relationship-backed signals, and the current work queue."
      />
      <WorkItemSourceNote source={attention.source} error={attention.error} />
      <AskBrainBar world={world} large />
      <section className="surface-panel">
        <div className="panel-head"><h2>Work context</h2></div>
        <WorkItemList items={attention.items.slice(0, 3)} empty="No urgent work items to anchor the conversation." world={world} />
      </section>
    </section>
  );
}
