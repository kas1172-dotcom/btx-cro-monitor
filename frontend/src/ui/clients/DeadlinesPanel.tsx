import type { Company, Opportunity } from "../../engine/brain/entities.ts";
import type { WorkItem } from "../../app/workItems.ts";
import { EmptyState } from "../primitives.tsx";

export type DeadlineType = "contract renewal" | "task due" | "other";

export interface DeadlineItem {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  type: DeadlineType;
  title: string;
}

function time(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function isUpcoming(value: string, anchor: Date): boolean {
  const parsed = time(value);
  if (!Number.isFinite(parsed)) return false;
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  return parsed >= start.getTime();
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function opportunityDeadlineType(company: Company, opportunity: Opportunity): DeadlineType {
  if (opportunity.stage === "won" || company.business_motion === "manage_current_business") return "contract renewal";
  if (opportunity.contract_url) return "contract renewal";
  return "other";
}

export function deadlinesForAccounts(
  companies: Company[],
  opportunities: Opportunity[] = [],
  workItems: WorkItem[] = [],
  anchor = new Date(),
): DeadlineItem[] {
  const accountsById = new Map(companies.map((company) => [company.id, company]));
  const deadlines: DeadlineItem[] = [];

  for (const opportunity of opportunities) {
    const company = accountsById.get(opportunity.company_id);
    if (!company || !isUpcoming(opportunity.close_date, anchor)) continue;
    deadlines.push({
      id: `opp-${opportunity.id}`,
      accountId: company.id,
      accountName: company.name,
      date: opportunity.close_date,
      type: opportunityDeadlineType(company, opportunity),
      title: opportunity.name,
    });
  }

  for (const item of workItems) {
    if (!item.canonical_account_id || !item.due_date || !isUpcoming(item.due_date, anchor)) continue;
    const company = accountsById.get(item.canonical_account_id);
    if (!company) continue;
    deadlines.push({
      id: `work-${item.id}`,
      accountId: company.id,
      accountName: company.name,
      date: item.due_date,
      type: "task due",
      title: item.recommended_action,
    });
  }

  return deadlines.sort((a, b) => time(a.date) - time(b.date) || a.accountName.localeCompare(b.accountName));
}

export function DeadlinesPanel({ deadlines }: { deadlines: DeadlineItem[] }) {
  const sorted = [...deadlines].sort((a, b) => time(a.date) - time(b.date) || a.accountName.localeCompare(b.accountName));
  return (
    <section className="surface-panel deadlines-panel" aria-labelledby="client-deadlines-title">
      <div className="panel-head">
        <h2 id="client-deadlines-title">Upcoming deadlines</h2>
        <span>{sorted.length} date{sorted.length === 1 ? "" : "s"}</span>
      </div>
      {sorted.length ? (
        <ul className="deadlines-list">
          {sorted.map((deadline) => (
            <li key={deadline.id}>
              <time dateTime={deadline.date}>{dateLabel(deadline.date)}</time>
              <strong>{deadline.accountName}</strong>
              <span>{deadline.type}</span>
              <em>{deadline.title}</em>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState headline="No upcoming deadlines" body="Contract dates and task due dates will appear here when they exist on client records." icon="programs" />
      )}
    </section>
  );
}
