import type { ReactNode } from "react";
import type { World } from "../../app/useWorld.ts";
import { useWorkItems, type WorkItem } from "../../app/workItems.ts";
import { qualitativeSignalConfidence } from "../../app/confidence.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import type { TabId } from "../../app/surfaces.ts";
import { accountPath, navigateTo, pathForTab, useAppRoute } from "../../app/router.ts";
import { plainActionLabel, plainWorkStatus, primaryWorkAction, workItemAlertLevel } from "../../app/presentation.ts";
import { AskBrainBar } from "../brain/AskBrainBar.tsx";
import { EmptyState, SurfaceHeader, UiIcon } from "../primitives.tsx";
import { WorkItemSourceNote } from "./WorkItemList.tsx";

type BriefLink = {
  label: string;
  surface: TabId;
  accountId?: string | null;
  path?: string;
};

type BriefItem = {
  id: string;
  title: ReactNode;
  reason: string;
  meta: string;
  link: BriefLink;
  seed: string;
};

type AttentionCard = {
  label: string;
  value: number;
  link: BriefLink;
};

const MINI_BRIEF_LIMIT = 4;
const HORIZONS = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "This week", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "quarter", label: "Quarter", days: 92 },
] as const;

function nameOf(world: World, id: string | null | undefined): string {
  if (!id) return "Portfolio";
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? id;
}

function eventLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function weekdayBriefingLabel(world: World): string {
  const anchor = world.snapshot?.publicSignals.run_at ? new Date(world.snapshot.publicSignals.run_at) : new Date();
  const weekday = Number.isNaN(anchor.getTime())
    ? "Daily"
    : anchor.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} briefing`;
}

function signalLink(world: World, signal: Signal): BriefLink {
  if (signal.scope === "specific_account" && signal.subject_id) {
    const company = world.companies.find((item) => item.id === signal.subject_id || item.canonical_account_id === signal.subject_id);
    if (company?.business_motion === "prospect_new_business" || company?.account_status === "new_logo" || company?.account_status === "target_prospect") {
      return { label: "Open prospect", surface: "prospecting", accountId: signal.subject_id };
    }
    return { label: "Open account", surface: "accounts", accountId: signal.subject_id };
  }
  if (signal.scope === "program") {
    return { label: "Open programs", surface: "programs" };
  }
  if (signal.account_status === "new_logo" || signal.business_motion === "prospect_new_business" || signal.scope === "unlinked") {
    return { label: "Open prospect", surface: "prospecting", accountId: signal.subject_id };
  }
  return { label: "Open signals", surface: "programs" };
}

function navigate(link: BriefLink): void {
  if (link.path) {
    navigateTo(link.path);
    return;
  }
  if (link.accountId && link.surface === "accounts") {
    navigateTo(accountPath(link.accountId));
    return;
  }
  if (link.accountId && link.surface === "prospecting") {
    navigateTo(`/prospecting?account=${encodeURIComponent(link.accountId)}`);
    return;
  }
  navigateTo(pathForTab(link.surface));
}

function workItemToBriefItem(world: World, item: WorkItem): BriefItem {
  const accountName = nameOf(world, item.canonical_account_id);
  const due = item.due_date ? `Due ${item.due_date}` : "No due date";
  const link = item.canonical_account_id
    ? { label: "Open work item", surface: "work_queue" as const, path: `/work/${encodeURIComponent(item.id)}` }
    : { label: "Open work item", surface: "work_queue" as const, path: `/work/${encodeURIComponent(item.id)}` };
  return {
    id: `work-${item.id}`,
    title: item.recommended_action,
    reason: `${item.priority} priority; ${due.toLowerCase()}.`,
    meta: `${accountName} - ${item.status.replace(/_/g, " ")}`,
    link,
    seed: `Help me act on this work item: ${item.recommended_action}. Account: ${accountName}. ${due}.`,
  };
}

function signalToBriefItem(world: World, signal: Signal): BriefItem {
  const accountName = signal.scope === "specific_account" || signal.scope === "unlinked" ? nameOf(world, signal.subject_id) : "Portfolio";
  const source = signalSourceName(signal);
  const sourceDate = signalSourceDate(signal);
  const title = signalHeadline(signal);
  const event = eventLabel(signal.event_type);
  const confidence = qualitativeSignalConfidence(signal);
  const reason = signal.scope === "specific_account"
    ? `${accountName} has a ${event} trigger from ${source}; ${confidence.label}.`
    : `${accountName}: ${source} surfaced a ${event} prospect signal; ${confidence.label}: ${confidence.reason}.`;
  return {
    id: `signal-${signal.id}`,
    title,
    reason,
    meta: `${accountName} - ${sourceDate}`,
    link: signalLink(world, signal),
    seed: `Explain today's top signal for a CRO: ${String(title)}. Evidence: ${signal.source_quote}`,
  };
}

function inHorizon(value: string | null | undefined, days: number, anchor = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + days);
  return date >= start && date <= end;
}

function alertLabel(item: WorkItem): string {
  const level = workItemAlertLevel(item);
  if (level === "critical") return "Critical";
  if (level === "action_required") return "Action required";
  if (level === "watch") return "Watch";
  return "Informational";
}

export function TodayBrief({ world }: { world: World }) {
  const route = useAppRoute();
  const horizonId = route.query.get("horizon") ?? "week";
  const horizon = HORIZONS.find((item) => item.id === horizonId) ?? HORIZONS[1];
  const attention = useWorkItems(world, "needs_attention");
  const approval = useWorkItems(world, "needs_approval");
  const signalById = new Map(world.analysis.valid.map((signal) => [signal.id, signal]));
  const selectedSignalIds = new Set(
    attention.items
      .flatMap((item) => item.source_signal_ids)
      .filter((id) => Boolean(signalById.get(id))),
  );
  const horizonSignals = world.analysis.valid.filter((signal) => inHorizon(signal.detected_at, horizon.days));
  const topSignals = [...horizonSignals]
    .filter((signal) => !selectedSignalIds.has(signal.id))
    .sort((a, b) => b.confidence - a.confidence || b.detected_at.localeCompare(a.detected_at) || a.id.localeCompare(b.id))
    .slice(0, 8);
  const signalBriefs = topSignals.map((signal) => signalToBriefItem(world, signal));
  const attentionBriefs = attention.items.map((item) => workItemToBriefItem(world, item));
  const seenBriefIds = new Set<string>();
  const miniBrief = [...attentionBriefs, ...signalBriefs]
    .filter((item) => {
      if (seenBriefIds.has(item.id)) return false;
      seenBriefIds.add(item.id);
      return true;
    })
    .slice(0, MINI_BRIEF_LIMIT);
  const accountsNeedingAttention = new Set(attention.items.map((item) => item.canonical_account_id).filter(Boolean)).size;
  const activeAccountCount = world.companies.filter((company) => company.relationship === "customer").length;
  const summaryLine = `${activeAccountCount} customer account, ${miniBrief.length} priority item${miniBrief.length === 1 ? "" : "s"}, and ${attention.items.length} open work items need review.`;
  const topSeed = miniBrief[0]?.seed;
  const rankedWork = [...attention.items]
    .sort((a, b) => {
      const priorityRank = { urgent: 4, high: 3, normal: 2, low: 1 };
      return (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0) || b.updated_at.localeCompare(a.updated_at);
    })
    .slice(0, 3);
  const accountSignals = topSignals.filter((signal) => signal.scope === "specific_account").slice(0, 3);
  const programSignals = topSignals.filter((signal) => signal.scope === "program").slice(0, 3);
  const marketSignals = topSignals.filter((signal) => signal.scope !== "specific_account" && signal.scope !== "program").slice(0, 3);
  const completed = (world.worldSnapshot?.workItems ?? [])
    .filter((item) => ["verified", "outcome_recorded", "closed"].includes(item.status))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);
  const attentionCards: AttentionCard[] = [
    {
      label: "Accounts needing attention",
      value: accountsNeedingAttention,
      link: { label: "Open work", surface: "work_queue" as const, path: "/work?view=needs_attention" },
    },
    {
      label: "Work awaiting approval",
      value: approval.items.length,
      link: { label: "Open approvals", surface: "work_queue" as const, path: "/work?approval=pending" },
    },
    {
      label: "Overdue work",
      value: attention.items.filter((item) => item.due_date && new Date(item.due_date) < new Date()).length,
      link: { label: "Open overdue", surface: "work_queue" as const, path: "/work?overdue=true" },
    },
  ].filter((card) => card.value > 0);

  return (
    <section className="surface-page today-brief-page" data-surface-component="surface-todays-brief">
      <SurfaceHeader
        eyebrow="Daily briefing"
        headline={weekdayBriefingLabel(world)}
        subline={summaryLine}
      />
      <WorkItemSourceNote source={attention.source} error={attention.error} />

      <div className="horizon-control" aria-label="Time horizon">
        {HORIZONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === horizon.id ? "active" : ""}
            onClick={() => navigateTo(`/today?horizon=${item.id}`)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="priority-stack" aria-labelledby="priority-stack-title">
        <div className="panel-head">
          <h2 id="priority-stack-title">Top priorities</h2>
          <span>{horizon.label}</span>
        </div>
        {rankedWork.map((item, index) => {
          const primary = primaryWorkAction(item);
          return (
            <article key={item.id} className={index === 0 ? "priority-card lead" : "priority-card"}>
              <span className={`priority-alert ${workItemAlertLevel(item)}`}>{alertLabel(item)}</span>
              <strong>{index + 1}. {item.recommended_action}</strong>
              <p>{nameOf(world, item.canonical_account_id)} needs a decision because this work is {plainWorkStatus(item.status).toLowerCase()}.</p>
              <div className="priority-meta">
                <span>Owner: {item.owner ?? "Unassigned"}</span>
                <span>{item.due_date ? `Due ${new Date(item.due_date).toLocaleDateString()}` : "No due date"}</span>
                <span>{item.source_signal_ids.length ? "Evidence attached" : "Evidence needed"}</span>
              </div>
              <button type="button" className="priority-primary" onClick={() => navigateTo(`/work/${encodeURIComponent(item.id)}`)}>
                {primary ? plainActionLabel(primary) : "Open work item"}
              </button>
            </article>
          );
        })}
        {!rankedWork.length && <EmptyState headline="No immediate work" body="No urgent, overdue, or high-priority work is due in this horizon." icon="work_queue" />}
      </section>

      <section className="surface-panel today-mini-brief" aria-labelledby="today-mini-brief-title">
        <div className="panel-head">
          <h2 id="today-mini-brief-title">Mini-brief</h2>
          <span>{miniBrief.length} signals</span>
        </div>
        <div className="today-brief-list">
          {miniBrief.map((item, index) => (
            <article key={item.id} className={index < attentionBriefs.length ? "today-brief-item pinned" : "today-brief-item"}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.reason}</p>
                <span>{item.meta}</span>
              </div>
              <button type="button" className="accent-action" onClick={() => navigate(item.link)}>
                {item.link.label}<UiIcon name="chevron" />
              </button>
            </article>
          ))}
          {miniBrief.length === 0 && (
            <EmptyState headline="No briefing items" body="Validated signals and urgent work items will appear here after the monitor finds actionable evidence." icon="signal" />
          )}
        </div>
      </section>

      {attentionCards.length > 0 && (
        <section className="today-attention-strip" aria-label="Attention counters">
          {attentionCards.map((card) => (
            <button key={card.label} type="button" onClick={() => navigate(card.link)}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </button>
          ))}
        </section>
      )}

      <section className="today-development-grid" aria-label="Recent developments">
        <DevelopmentColumn title="Confirmed account developments" signals={accountSignals} world={world} />
        <DevelopmentColumn title="Program developments" signals={programSignals} world={world} />
        <DevelopmentColumn title="Market developments" signals={marketSignals} world={world} />
      </section>

      {completed.length > 0 && (
        <section className="surface-panel">
          <div className="panel-head"><h2>Completed recently</h2><span>{completed.length}</span></div>
          <div className="today-completed-list">
            {completed.map((item) => (
              <button key={item.id} type="button" onClick={() => navigateTo(`/work/${encodeURIComponent(item.id)}`)}>
                <strong>{item.recommended_action}</strong>
                <span>{plainWorkStatus(item.status)} · {new Date(item.updated_at).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <AskBrainBar world={world} seedPrompt={topSeed} />
    </section>
  );
}

function DevelopmentColumn({ title, signals, world }: { title: string; signals: Signal[]; world: World }) {
  return (
    <section className="surface-panel">
      <div className="panel-head"><h2>{title}</h2><span>{signals.length}</span></div>
      <div className="today-development-list">
        {signals.map((signal) => {
          const link = signalLink(world, signal);
          return (
            <button key={signal.id} type="button" onClick={() => navigate(link)}>
              <strong>{signalHeadline(signal)}</strong>
              <span>{signalSourceName(signal)} · {signalSourceDate(signal)}</span>
            </button>
          );
        })}
        {!signals.length && <span className="rail-quiet-empty">No developments in this horizon.</span>}
      </div>
    </section>
  );
}
