import type { ReactNode } from "react";
import { setState } from "../../store/store.ts";
import type { World } from "../../app/useWorld.ts";
import { useWorkItems, type WorkItem } from "../../app/workItems.ts";
import { qualitativeSignalConfidence } from "../../app/confidence.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import type { TabId } from "../../app/surfaces.ts";
import { AskBrainBar } from "../brain/AskBrainBar.tsx";
import { EmptyState, SurfaceHeader, UiIcon } from "../primitives.tsx";
import { WorkItemSourceNote } from "./WorkItemList.tsx";

type BriefLink = {
  label: string;
  surface: TabId;
  accountId?: string | null;
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
  setState({
    activeTab: link.surface,
    activeCompanyId: link.accountId ?? null,
    brainResponse: null,
    activeDeliverable: null,
    activeAnalysisSpec: null,
  });
}

function workItemToBriefItem(world: World, item: WorkItem): BriefItem {
  const accountName = nameOf(world, item.canonical_account_id);
  const due = item.due_date ? `Due ${item.due_date}` : "No due date";
  const link = item.canonical_account_id
    ? { label: "Open account", surface: "accounts" as const, accountId: item.canonical_account_id }
    : { label: "Open queue", surface: "work_queue" as const };
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

function isThisWeek(value: string | null | undefined, anchor = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date <= end;
}

export function TodayBrief({ world }: { world: World }) {
  const attention = useWorkItems(world, "needs_attention");
  const approval = useWorkItems(world, "needs_approval");
  const signalById = new Map(world.analysis.valid.map((signal) => [signal.id, signal]));
  const selectedSignalIds = new Set(
    attention.items
      .flatMap((item) => item.source_signal_ids)
      .filter((id) => Boolean(signalById.get(id))),
  );
  const topSignals = [...world.analysis.valid]
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
  const deadlineCount = [
    ...attention.items.map((item) => item.due_date),
    ...world.opportunities.filter((opp) => opp.stage !== "won" && opp.stage !== "lost").map((opp) => opp.close_date),
  ].filter((date) => isThisWeek(date)).length;
  const activeAccountCount = world.companies.filter((company) => company.relationship === "customer").length;
  const summaryLine = `${activeAccountCount} customer account, ${miniBrief.length} signals shown, and ${attention.items.length} open work items are ready for review.`;
  const topSeed = miniBrief[0]?.seed;
  const attentionCards: AttentionCard[] = [
    {
      label: "Accounts needing attention",
      value: accountsNeedingAttention,
      link: { label: "Open accounts", surface: "accounts" as const },
    },
    {
      label: "Deliverables awaiting approval",
      value: approval.items.length,
      link: { label: "Open queue", surface: "work_queue" as const },
    },
    {
      label: "Deadlines this week",
      value: deadlineCount,
      link: { label: "Open programs", surface: "programs" as const },
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

      <AskBrainBar world={world} seedPrompt={topSeed} />
    </section>
  );
}
