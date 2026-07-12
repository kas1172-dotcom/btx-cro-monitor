import type { WorkItem } from "../../app/workItems.ts";

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkItemSourceNote({ source, error }: { source: "backend" | "derived"; error: string | null }) {
  if (source === "backend") return <div className="live-inline-status">Work items: backend API</div>;
  return (
    <div className={error ? "live-inline-status error" : "live-inline-status"}>
      {error ? `Backend work-item API unavailable; showing derived queue. ${error}` : "Work items: derived from current world until backend data is available."}
    </div>
  );
}

export function WorkItemList({ items, empty = "No work items yet." }: { items: WorkItem[]; empty?: string }) {
  return (
    <div className="work-item-list">
      {items.map((item) => (
        <article key={item.id} className="work-item-row">
          <div>
            <strong>{item.recommended_action}</strong>
            <span>{titleCase(item.type)} · {titleCase(item.status)} · {titleCase(item.priority)}</span>
            <em>
              {item.owner ? `Owner ${item.owner}` : "No owner"}
              {item.due_date ? ` · due ${item.due_date}` : ""}
              {item.source_signal_ids.length ? ` · ${item.source_signal_ids.length} evidence signal${item.source_signal_ids.length === 1 ? "" : "s"}` : ""}
            </em>
          </div>
          <div className="work-item-state">
            <span>{titleCase(item.approval_state)}</span>
            <span>{titleCase(item.execution_state)}</span>
          </div>
        </article>
      ))}
      {items.length === 0 && <div className="rail-quiet-empty">{empty}</div>}
    </div>
  );
}
