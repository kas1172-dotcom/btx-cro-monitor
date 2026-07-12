import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { useWorkItems, type WorkItemStatus } from "../../app/workItems.ts";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { SurfaceHeader } from "../primitives.tsx";

const STATUSES: Array<WorkItemStatus | "all"> = ["all", "proposed", "approved", "in_progress", "done", "dismissed"];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkQueue({ world }: { world: World }) {
  const [status, setStatus] = useState<WorkItemStatus | "all">("all");
  const allItems = useWorkItems(world);
  const items = useMemo(
    () => status === "all" ? allItems.items : allItems.items.filter((item) => item.status === status),
    [allItems.items, status],
  );

  return (
    <section className="surface-page" data-surface-component="surface-work-queue">
      <SurfaceHeader
        eyebrow="Work queue"
        headline={`${items.length} durable work items across account actions, approvals, deliverables, and outcomes.`}
        subline="Each row carries status, owner, evidence, approval state, and execution history."
      />
      <WorkItemSourceNote source={allItems.source} error={allItems.error} />
      <div className="surface-toolbar">
        {STATUSES.map((item) => (
          <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>
            {titleCase(item)}
          </button>
        ))}
      </div>
      <WorkItemList items={items} world={world} />
    </section>
  );
}
