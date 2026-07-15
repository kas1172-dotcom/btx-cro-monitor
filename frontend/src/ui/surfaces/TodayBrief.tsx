import type { ReactNode } from "react";
import { setState } from "../../store/store.ts";
import type { World } from "../../app/useWorld.ts";
import { useWorkItems, type WorkItem } from "../../app/workItems.ts";
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

function nameOf(world: World, id: string | null | undefined): string {
  if (!id) return "Portfolio";
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? id;
}

function eventLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function signalLink(signal: Signal): BriefLink {
  if (signal.scope === "specific_account" && signal.subject_id) {
    return { label: "Open account", surface: "accounts", accountId: signal.subject_id };
  }
  if (signal.scope === "program" || signal.event_type.includes("contract") || signal.event_type.includes("award")) {
    return { label: "Open programs", surface: "programs" };
  }
  return { label: "Open analysis", surface: "analysis" };
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
  const accountName = signal.scope === "specific_account" ? nameOf(world, signal.subject_id) : "Portfolio";
  const source = signalSourceName(signal);
  const sourceDate = signalSourceDate(signal);
  const title = signalHeadline(signal);
  return {
    id: `signal-${signal.id}`,
    title,
    reason: `${Math.round(signal.confidence * 100)}% confidence ${eventLabel(signal.event_type)} signal from ${source}.`,
    meta: `${accountName} - ${sourceDate}`,
    link: signalLink(signal),
    seed: `Explain today's top signal for a CRO: ${String(title)}. Evidence: ${signal.source_quote}`,
  };
}

function saronicProspectBriefItem(world: World): BriefItem | null {
  const company = world.companies.find((candidate) => candidate.name.toLowerCase().includes("saronic"));
  if (!company) return null;
  return {
    id: `prospect-${company.id}`,
    title: `${company.name}: qualify the Austin prospect before outreach`,
    reason: "Prospecting signal needs qualification before it becomes a CRM action.",
    meta: "Prospecting - Austin visit plan",
    link: { label: "Open prospecting", surface: "prospecting" },
    seed: `Build a qualification plan for ${company.name} before outreach.`,
  };
}

function demoPriority(signal: Signal): number {
  const text = [
    signal.id,
    signal.artifact?.headline,
    signal.source_quote,
    signal.subject_id,
    signal.entities.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("lockheed") || text.includes("f-35")) return 0;
  if (text.includes("saronic") || text.includes("corsair")) return 1;
  return 2;
}

function briefItemSearchText(item: BriefItem): string {
  return [item.title, item.reason, item.meta, item.seed].map(String).join(" ").toLowerCase();
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
      .filter((id) => {
        const signal = signalById.get(id);
        return !signal || demoPriority(signal) > 1;
      }),
  );
  const topSignals = [...world.analysis.valid]
    .filter((signal) => !selectedSignalIds.has(signal.id))
    .sort((a, b) => demoPriority(a) - demoPriority(b) || b.confidence - a.confidence || b.detected_at.localeCompare(a.detected_at))
    .slice(0, 8);
  const signalBriefs = topSignals.map((signal) => signalToBriefItem(world, signal));
  const attentionBriefs = attention.items.map((item) => workItemToBriefItem(world, item));
  const lockheedSignal = signalBriefs.find((item) => {
    const text = briefItemSearchText(item);
    return text.includes("lockheed") || text.includes("f-35");
  });
  const saronicSignal = signalBriefs.find((item) => {
    const text = briefItemSearchText(item);
    return text.includes("saronic") || text.includes("corsair");
  });
  const saronicWork = attentionBriefs.find((item) => briefItemSearchText(item).includes("saronic"));
  const saronicProspect = saronicProspectBriefItem(world);
  const reservedBriefs = [lockheedSignal, saronicSignal ?? saronicWork ?? saronicProspect].filter((item): item is BriefItem => Boolean(item));
  const seenBriefIds = new Set<string>();
  const miniBrief = [...reservedBriefs, ...signalBriefs, ...attentionBriefs]
    .filter((item) => {
      if (seenBriefIds.has(item.id)) return false;
      seenBriefIds.add(item.id);
      return true;
    })
    .slice(0, 5);
  const accountsNeedingAttention = new Set(attention.items.map((item) => item.canonical_account_id).filter(Boolean)).size;
  const deadlineCount = [
    ...attention.items.map((item) => item.due_date),
    ...world.opportunities.filter((opp) => opp.stage !== "won" && opp.stage !== "lost").map((opp) => opp.close_date),
  ].filter((date) => isThisWeek(date)).length;
  const topSeed = miniBrief[0]?.seed;

  return (
    <section className="surface-page today-brief-page" data-surface-component="surface-todays-brief">
      <SurfaceHeader
        eyebrow="Daily briefing"
        headline="Today's BTX demo path"
        subline="Start with the Lockheed account action, then qualify Saronic as the net-new prospect."
      />
      <WorkItemSourceNote source={attention.source} error={attention.error} />

      <section className="surface-panel today-mini-brief" aria-labelledby="today-mini-brief-title">
        <div className="panel-head">
          <h2 id="today-mini-brief-title">Mini-brief</h2>
          <span>{miniBrief.length} signals</span>
        </div>
        <div className="today-brief-list">
          {miniBrief.map((item) => (
            <article key={item.id} className="today-brief-item">
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

      <section className="today-attention-strip" aria-label="Attention counters">
        <button type="button" onClick={() => navigate({ label: "Open accounts", surface: "accounts" })}>
          <span>Accounts needing attention</span>
          <strong>{accountsNeedingAttention}</strong>
        </button>
        <button type="button" onClick={() => navigate({ label: "Open queue", surface: "work_queue" })}>
          <span>Deliverables awaiting approval</span>
          <strong>{approval.items.length}</strong>
        </button>
        <button type="button" onClick={() => navigate({ label: "Open programs", surface: "programs" })}>
          <span>Deadlines this week</span>
          <strong>{deadlineCount}</strong>
        </button>
      </section>

      <AskBrainBar world={world} seedPrompt={topSeed} />
    </section>
  );
}
