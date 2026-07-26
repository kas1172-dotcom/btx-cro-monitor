import { navigateTo, workItemPath } from "../../app/router.ts";
import type { WorkItem } from "../../app/workItems.ts";
import type { World } from "../../app/useWorld.ts";
import { EmptyState } from "../primitives.tsx";

const TERMINAL_STATUSES = new Set(["dismissed", "closed"]);

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function dateLabel(value: string | null): string {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function accountName(world: World | undefined, id: string | null): string {
  if (!id) return "Portfolio";
  return world?.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? "Account record unavailable";
}

function priorityLabel(item: WorkItem): string {
  if (item.priority_status !== "available") return titleCase(item.priority_status);
  return titleCase(item.priority);
}

export function WorkItemSourceNote({ source, error }: { source: "backend" | "unavailable"; error: string | null }) {
  if (source === "backend") return null;
  return (
    <div className="live-inline-status" title={error ?? undefined}>
      {error ? "Backend work-item service is unavailable. No local queue was generated." : "Backend work items are loading."}
    </div>
  );
}

export function WorkItemList({ items, empty = "No work items yet.", world }: { items: WorkItem[]; empty?: string; world?: World }) {
  return (
    <div className="work-item-list">
      {items.map((item) => {
        const overdue = item.due_date ? new Date(item.due_date) < new Date() && !TERMINAL_STATUSES.has(item.status) : false;
        return (
          <article key={item.id} className={overdue ? "work-item-row overdue" : "work-item-row"}>
            <button type="button" className="work-item-summary" onClick={() => navigateTo(workItemPath(item.id))}>
              <span className="work-item-kind">{titleCase(item.type)}</span>
              <strong>{item.recommended_action}</strong>
              <em>{accountName(world, item.canonical_account_id)} · {priorityLabel(item)} · {dateLabel(item.due_date)}</em>
              <span className="work-item-confidence">{titleCase(item.status)} · {titleCase(item.approval_state)}</span>
              {item.execution_state === "failed" && <span className="work-item-error">Execution failed</span>}
              {item.external_record_url && <span className="work-item-success">Verified external action</span>}
            </button>
          </article>
        );
      })}
      {items.length === 0 && <EmptyState headline="No work items" body={empty} icon="work_queue" />}
    </div>
  );
}
