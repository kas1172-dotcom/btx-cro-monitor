import { navigateTo, workItemPath } from "../../app/router.ts";
import type { WorkItem } from "../../app/workItems.ts";
import type { World } from "../../app/useWorld.ts";
import { plainWorkStatus, plainWorkType } from "../../app/presentation.ts";
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
      {error ? "Backend work-item service is unavailable. No local queue was generated." : "Backend work items are being prepared."}
    </div>
  );
}

export function WorkItemList({ items, empty = "No work items yet.", world, compact = false }: { items: WorkItem[]; empty?: string; world?: World; compact?: boolean }) {
  if (items.length === 0) {
    return (
      <div className="work-item-list" aria-label="Controlled work queue">
        <EmptyState headline="No work items" body={empty} icon="work_queue" />
      </div>
    );
  }
  return (
    <div
      className={compact ? "work-item-list compact" : "work-item-list"}
      role="table"
      aria-label="Controlled work queue"
      // A scrollable ARIA table must be keyboard-focusable so its off-screen columns are reachable.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <div role="rowgroup">
        <div className="work-item-table-head" role="row">
          <span role="columnheader">Decision / action</span>
          <span role="columnheader">Account</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Owner</span>
          <span role="columnheader">Due</span>
          <span role="columnheader">Priority</span>
          <span role="columnheader">External effect</span>
        </div>
      </div>
      <div role="rowgroup">
      {items.map((item) => {
        const overdue = item.due_date ? new Date(item.due_date) < new Date() && !TERMINAL_STATUSES.has(item.status) : false;
        return (
          <button key={item.id} type="button" role="row" className={overdue ? "work-item-row overdue" : "work-item-row"} onClick={() => navigateTo(workItemPath(item.id))}>
            <span role="cell" className="work-action-cell"><small>{plainWorkType(item.type)}</small><strong>{item.recommended_action}</strong></span>
            <span role="cell">{accountName(world, item.canonical_account_id)}</span>
            <span role="cell">{plainWorkStatus(item.status)}</span>
            <span role="cell">{item.owner ?? "Unassigned"}</span>
            <span role="cell" className={overdue ? "overdue-label" : ""}>{dateLabel(item.due_date)}</span>
            <span role="cell">{priorityLabel(item)}</span>
            <span role="cell">
              {item.execution_state === "failed"
                ? "Failed"
                : item.external_record_url
                  ? "Executed; record linked"
                  : item.approval_state === "pending"
                    ? "Approval required"
                    : "None recorded"}
            </span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
