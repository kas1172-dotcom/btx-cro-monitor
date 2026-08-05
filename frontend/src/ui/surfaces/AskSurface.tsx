import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  askAssistant,
  askAssistantStream,
  createAssistantConversation,
  createDeliverableFromAssistantDraft,
  createWorkItemFromAssistantDraft,
  getAssistantConversation,
  listAssistantConversations,
  updateAssistantConversation,
  type AssistantCitation,
  type AssistantContext,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantSourceMode,
} from "../../app/assistantApi.ts";
import { navigateTo, useAppRoute } from "../../app/router.ts";
import { displayLabel } from "../../app/displayLabels.ts";
import type { World } from "../../app/useWorld.ts";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { useWorkItems } from "../../app/workItems.ts";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";
import { evidenceFromCitation, type EvidencePackage } from "../../app/evidence.ts";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer.tsx";
import { computeMetric } from "../../metrics/catalog.ts";

function displayTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sanitizeInline(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/\bactionPriority\b/g, "action priority")
    .replace(/\bPWIN\b/g, "probability of win")
    .replace(/\bpwin\b/g, "probability of win")
    .trim();
}

function inlineMarkdown(value: string): ReactNode[] {
  const parts = sanitizeInline(value).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{sanitizeInline(link[1])}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function SanitizedMarkdown({ text }: { text: string }) {
  const normalized = sanitizeInline(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*,/g, ",")
    .replace(/([^\n])\n(?!(?:#{1,6}\s+|[-*]\s+|\d+\.\s+))/g, "$1 ");
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="ask-markdown">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines[0] && /^#{1,3}\s+/.test(lines[0])) {
          const heading = lines[0].replace(/^#{1,3}\s+/, "");
          const body = lines.slice(1).join(" ").trim();
          return (
            <section key={index}>
              <h3>{inlineMarkdown(heading)}</h3>
              {body ? <p>{inlineMarkdown(body)}</p> : null}
            </section>
          );
        }
        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>)}</ul>;
        }
        const heading = block.match(/^(#{1,3})\s+(.+)$/);
        if (heading) return <h3 key={index}>{inlineMarkdown(heading[2])}</h3>;
        return <p key={index}>{inlineMarkdown(block)}</p>;
      })}
    </div>
  );
}

function generatedTitle(text: string): string {
  const cleaned = sanitizeInline(text).replace(/[?.!]+$/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const suffix = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (words.length === 0) return `Ask conversation ${suffix}`;
  return `${words.slice(0, 8).join(" ")} · ${suffix}`;
}

function accountName(world: World, accountId?: string | null): string | null {
  if (!accountId) return null;
  return world.companies.find((company) => company.id === accountId || company.canonical_account_id === accountId)?.name ?? "Account record unavailable";
}

function routeContext(route: ReturnType<typeof useAppRoute>): AssistantContext {
  return {
    account_id: route.query.get("account"),
    program_id: route.query.get("program"),
    work_item_id: route.query.get("work"),
    signal_id: route.query.get("signal"),
    deliverable_id: route.query.get("deliverable"),
    route: `${route.path}${route.query.toString() ? `?${route.query.toString()}` : ""}`,
  };
}

function compactContext(context: AssistantContext, world: World): string {
  const parts = [
    accountName(world, context.account_id),
    context.work_item_id ? `Work ${context.work_item_id}` : null,
    context.program_id ? `Program ${context.program_id}` : null,
    context.signal_id ? `Signal ${context.signal_id}` : null,
    context.deliverable_id ? `Deliverable ${context.deliverable_id}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Workspace";
}

function sourceClass(citation: AssistantCitation): string {
  const type = citation.source_type.toLowerCase();
  const host = (citation.publisher ?? citation.url ?? "").toLowerCase();
  const gov = host.includes(".gov") || host.includes("sam.gov") || host.includes("defense.gov") || host.includes("congress.gov") || host.includes("usaspending.gov");
  if (gov || type === "government_source") return "Primary government source";
  if (type.includes("search") || citation.freshness === "search_snippet") return "Search snippet";
  if (type.includes("public") || citation.url) return "Reporting/public web";
  if (citation.data_classification === "crm" || type === "account") return "Workspace CRM";
  if (type === "work_item") return "Workspace work";
  if (type === "score") return "Derived workspace analysis";
  return "Workspace evidence";
}

function sourceModeLabel(mode: AssistantMessage["metadata"]["actual_source_mode"], searchCount?: number): string {
  if (mode === "web") return searchCount ? `Public web · ${searchCount} search${searchCount === 1 ? "" : "es"}` : "Public web";
  if (mode === "workspace_web") return searchCount ? `Workspace + public web · ${searchCount} search${searchCount === 1 ? "" : "es"}` : "Workspace + public web";
  return "Workspace records only";
}

function messageQuality(message: AssistantMessage): Array<{ tone: "warning" | "danger" | "info"; label: string }> {
  if (message.role === "user") return [];
  const citations = message.citations ?? [];
  const flags: Array<{ tone: "warning" | "danger" | "info"; label: string }> = [];
  if (citations.length === 0) flags.push({ tone: "danger", label: "Unsupported answer: no citations were returned." });
  if (citations.some((citation) => citation.claim_classification === "missing_information" || citation.claim_classification === "missing")) flags.push({ tone: "info", label: "Missing information is called out in the evidence." });
  if (citations.some((citation) => citation.relationship_status && !["confirmed", "accepted"].includes(citation.relationship_status))) flags.push({ tone: "warning", label: "Contains unconfirmed or conflicting relationship evidence." });
  if (citations.some((citation) => citation.freshness === "stale" || citation.data_classification === "simulated")) flags.push({ tone: "warning", label: "Contains stale or simulated evidence." });
  for (const warning of message.metadata?.warnings ?? []) flags.push({ tone: "warning", label: warning });
  return flags;
}

function DraftPreview({
  message,
  onCreated,
}: {
  message: AssistantMessage;
  onCreated: (route: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workDraft = message.action_draft;
  const deliverableDraft = message.deliverable_draft;

  async function confirmWork() {
    if (!workDraft) return;
    setBusy("work");
    setError(null);
    try {
      const item = await createWorkItemFromAssistantDraft(workDraft.payload);
      onCreated(`/work/${encodeURIComponent(item.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create work item.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDeliverable() {
    if (!deliverableDraft) return;
    setBusy("deliverable");
    setError(null);
    try {
      const record = await createDeliverableFromAssistantDraft(deliverableDraft.payload);
      onCreated(`/deliverables/${encodeURIComponent(record.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create deliverable.");
    } finally {
      setBusy(null);
    }
  }

  if (!workDraft && !deliverableDraft) return null;
  return (
    <div className="ask-draft-stack">
      {error && <div className="live-inline-status error" role="alert">{error}</div>}
      {workDraft && (
        <article className="ask-draft-preview">
          <span>Work draft</span>
          <strong>{String(workDraft.payload.recommended_action ?? "Draft work item")}</strong>
          <p>Type: {String(workDraft.payload.type ?? "account_action")}. This creates through the normal work-item API after confirmation.</p>
          <button type="button" disabled={busy !== null} onClick={() => void confirmWork()}>{busy === "work" ? "Creating..." : "Create work item"}</button>
        </article>
      )}
      {deliverableDraft && (
        <article className="ask-draft-preview">
          <span>Deliverable draft</span>
          <strong>{String(deliverableDraft.payload.title ?? "Executive account brief")}</strong>
          <p>Type: {String(deliverableDraft.payload.type ?? "meeting_brief")}. This saves through the deliverable backend after confirmation.</p>
          <button type="button" disabled={busy !== null} onClick={() => void confirmDeliverable()}>{busy === "deliverable" ? "Saving..." : "Save deliverable"}</button>
        </article>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
  onCreated,
  onEvidence,
}: {
  message: AssistantMessage;
  onRetry: (text: string) => void;
  onCreated: (route: string) => void;
  onEvidence: (citation: AssistantCitation, trigger: HTMLButtonElement) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const isUser = message.role === "user";
  const quality = messageQuality(message);
  return (
    <article className={`ask-workspace-message ${isUser ? "user" : "assistant"}`}>
      <div className="ask-message-topline">
        <span>{isUser ? "You" : "Ask"}</span>
        <em>{displayTime(message.created_at)}</em>
      </div>
      {!isUser && <div className="ask-answer-source">{sourceModeLabel(message.metadata?.actual_source_mode, message.metadata?.search_count)} · {message.metadata?.as_of ? `as of ${displayTime(message.metadata.as_of)}` : "as-of unavailable"}</div>}
      {quality.map((item) => <div key={item.label} className={`ask-claim-flag ${item.tone}`} role="status">{item.label}</div>)}
      {editing ? (
        <form
          className="ask-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            setEditing(false);
            onRetry(editText);
          }}
        >
          <textarea value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit message" />
          <div><button type="submit">Resend</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <SanitizedMarkdown text={message.content} />
      )}
      {!isUser && message.citations.length > 0 && (
        <div className="ask-claim-citations" aria-label="Citations attached to this answer">
          {message.citations.slice(0, 4).map((citation) => (
            <button key={citation.id} type="button" onClick={(event) => onEvidence(citation, event.currentTarget)}>
              <span>{sourceClass(citation)}</span>
              <strong>{citation.title}</strong>
              <em>{citation.claim}</em>
            </button>
          ))}
        </div>
      )}
      {!isUser && message.related_records.length > 0 && (
        <div className="ask-related-row" aria-label="Related records">
          {message.related_records.map((record) => (
            <button key={`${record.type}-${record.id}`} type="button" onClick={() => record.route && navigateTo(record.route)}>
              {record.title ?? record.id}
            </button>
          ))}
        </div>
      )}
      {!isUser && <DraftPreview message={message} onCreated={onCreated} />}
      <div className="ask-message-actions">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(message.content)}>Copy</button>
        {isUser ? <button type="button" onClick={() => setEditing(true)}>Edit and resend</button> : <button type="button" onClick={() => onRetry(message.content)}>Retry</button>}
      </div>
    </article>
  );
}

export function AskSurface({ world }: { world: World }) {
  const route = useAppRoute();
  const routeConversationId = route.conversationId;
  const routePrompt = route.query.get("prompt") ?? "";
  const routeCtx = useMemo(() => routeContext(route), [route]);
  const [activeConversations, setActiveConversations] = useState<AssistantConversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<AssistantConversation[]>([]);
  const [selected, setSelected] = useState<AssistantConversation | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(routePrompt);
  const [context, setContext] = useState<AssistantContext>(routeCtx);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingStatus, setStreamingStatus] = useState("Working");
  const [conversationBusy, setConversationBusy] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<AssistantSourceMode>("automatic");
  const [error, setError] = useState<string | null>(null);
  const [createdRoute, setCreatedRoute] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidencePackage | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const appliedPrompt = useRef<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const attention = useWorkItems(world, "needs_attention");
  const isFocus = route.query.get("view") === "focus";

  async function loadConversations(nextSelectedId = routeConversationId) {
    setLoading(true);
    setError(null);
    try {
      const [active, archived] = await Promise.all([
        listAssistantConversations("active", search),
        listAssistantConversations("archived", search),
      ]);
      setActiveConversations(active);
      setArchivedConversations(archived);
      const preferredId = nextSelectedId ?? selected?.id ?? active[0]?.id ?? archived[0]?.id ?? null;
      if (preferredId) {
        const full = await getAssistantConversation(preferredId);
        setSelected(full);
        if (!routeConversationId) navigateTo(`/ask/${encodeURIComponent(full.id)}`, { replace: true });
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Ask conversations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversations(routeConversationId);
  }, [routeConversationId, search]);

  useEffect(() => {
    const marker = `${routePrompt}:${JSON.stringify(routeCtx)}`;
    if (appliedPrompt.current === marker) return;
    appliedPrompt.current = marker;
    if (routePrompt) setDraft(routePrompt);
    setContext(routeCtx);
  }, [routePrompt, routeCtx]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (historyOpen) {
        setHistoryOpen(false);
        event.stopPropagation();
        return;
      }
      if (citationsOpen) {
        setCitationsOpen(false);
        event.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [citationsOpen, historyOpen]);

  async function send(textOverride?: string) {
    const message = (textOverride ?? draft).trim();
    if (!message || sending) return;
    setSending(true);
    setStreamingText("");
    setStreamingStatus("Preparing answer");
    setError(null);
    setCreatedRoute(null);
    const currentId = selected?.status === "active" ? selected.id : null;
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const metricIds = ["pipeline_by_stage", "capacity_utilization", "margin_trend", "backlog"] as const;
      const metric_states = Object.fromEntries(metricIds.map((id) => {
        const metric = computeMetric(id, world);
        return [id, { state: metric.state, value: metric.value, reason: metric.reason, asOf: metric.asOf }];
      }));
      const input = { message, conversation_id: currentId, context: { ...context, metric_states }, source_mode: sourceMode };
      let response;
      try {
        response = await askAssistantStream(input, {
          onStatus: setStreamingStatus,
          onDelta: (text) => setStreamingText((current) => `${current}${text}`),
        }, controller.signal);
      } catch (streamError) {
        if (controller.signal.aborted) throw streamError;
        setStreamingStatus("Stream dropped. Finishing with standard Ask.");
        response = await askAssistant(input, controller.signal);
      }
      setSelected(response.conversation);
      setDraft("");
      setStreamingText("");
      if (response.conversation.title === "New Ask conversation" || response.conversation.title === "Ask") {
        void updateAssistantConversation(response.conversation.id, { title: generatedTitle(message) }).then(setSelected).catch(() => undefined);
      }
      navigateTo(`/ask/${encodeURIComponent(response.conversation.id)}`, { replace: true });
      void loadConversations(response.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      requestController.current = null;
      setSending(false);
      setStreamingStatus("Working");
    }
  }

  async function startConversation() {
    if (conversationBusy) return;
    setConversationBusy("new");
    setError(null);
    try {
      const created = await createAssistantConversation(context, routePrompt ? generatedTitle(routePrompt) : undefined);
      setSelected(created);
      setDraft("");
      navigateTo(`/ask/${encodeURIComponent(created.id)}`);
      void loadConversations(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create conversation.");
    } finally {
      setConversationBusy(null);
    }
  }

  async function renameConversation(conversation: AssistantConversation) {
    if (conversationBusy) return;
    const title = window.prompt("Conversation name", conversation.title);
    if (!title?.trim()) return;
    setConversationBusy("rename");
    try {
      const updated = await updateAssistantConversation(conversation.id, { title: title.trim() });
      setSelected(updated);
      void loadConversations(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename conversation.");
    } finally {
      setConversationBusy(null);
    }
  }

  async function setConversationStatus(conversation: AssistantConversation, status: "active" | "archived") {
    if (conversationBusy) return;
    setConversationBusy(status);
    try {
    const updated = await updateAssistantConversation(conversation.id, { status });
    setSelected(updated);
    void loadConversations(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update conversation status.");
    } finally {
      setConversationBusy(null);
    }
  }

  function handleCreated(routePath: string) {
    setCreatedRoute(routePath);
    world.refresh();
  }

  function pathWithFocus(nextFocus: boolean): string {
    const params = new URLSearchParams(route.query);
    if (nextFocus) params.set("view", "focus");
    else params.delete("view");
    const query = params.toString();
    return `${route.path}${query ? `?${query}` : ""}`;
  }

  const selectedContext = selected?.context ?? context;
  const contextLabel = compactContext(selectedContext, world);
  const conversations = [...activeConversations, ...archivedConversations];
  const citationMessages = selected?.messages.filter((message) => message.role === "assistant" && message.citations.length > 0) ?? [];

  function openCitationEvidence(citation: AssistantCitation, trigger: HTMLButtonElement) {
    evidenceTriggerRef.current = trigger;
    setEvidence(evidenceFromCitation(citation));
    setCitationsOpen(true);
  }

  return (
    <section className={isFocus ? "surface-page ask-surface ask-workspace record-focus-mode" : "surface-page ask-surface ask-workspace"} data-surface-component="surface-ask">
      <SurfaceHeader
        eyebrow="Assistant"
        headline="Ask"
        subline="Grounded answers use internal records, current work, deliverables, scores, and cited account signals."
      />
      <div className="ask-mobile-switcher" aria-label="Ask drawers">
        <button type="button" onClick={() => setHistoryOpen(true)}>History</button>
        <button type="button" onClick={() => setCitationsOpen(true)}>Evidence</button>
      </div>
      <div className="ask-workspace-grid">
        <aside className={historyOpen ? "ask-conversation-sidebar drawer-open" : "ask-conversation-sidebar"} aria-label="Ask conversations">
          <div className="ask-sidebar-actions">
            <button type="button" disabled={Boolean(conversationBusy)} onClick={() => void startConversation()}>{conversationBusy === "new" ? "Creating..." : "New conversation"}</button>
            <button type="button" className="ask-drawer-close" onClick={() => setHistoryOpen(false)}>Close</button>
            <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Account or topic" /></label>
          </div>
          {loading && <div className="ask-skeleton" role="status" aria-label="Preparing conversations"><i /><i /><i /></div>}
          {!loading && conversations.length === 0 && <div className="rail-quiet-empty">No conversations yet.</div>}
          <div className="ask-conversation-group">
            <span>Active</span>
            {activeConversations.map((conversation) => (
              <button key={conversation.id} className={selected?.id === conversation.id ? "active" : ""} type="button" onClick={() => navigateTo(`/ask/${encodeURIComponent(conversation.id)}`)}>
                <strong>{conversation.title}</strong>
                <em>{accountName(world, conversation.related_account_id) ?? conversation.preview ?? "Workspace"}</em>
                <small>{displayTime(conversation.updated_at)}</small>
              </button>
            ))}
          </div>
          <div className="ask-conversation-group">
            <span>Archived</span>
            {archivedConversations.map((conversation) => (
              <button key={conversation.id} className={selected?.id === conversation.id ? "active archived" : "archived"} type="button" onClick={() => navigateTo(`/ask/${encodeURIComponent(conversation.id)}`)}>
                <strong>{conversation.title}</strong>
                <em>{conversation.preview ?? "Archived conversation"}</em>
                <small>{displayTime(conversation.updated_at)}</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="ask-thread-panel" aria-label="Ask conversation">
          {error && <div className="live-inline-status error" role="alert">{error}</div>}
          {createdRoute && (
            <div className="live-inline-status" role="status">
              Created. <button type="button" onClick={() => navigateTo(createdRoute)}>Open record</button>
            </div>
          )}
          {selected ? (
            <>
              <div className="ask-thread-head">
                <div>
                  <span>{selected.status === "archived" ? "Archived" : "Conversation"}</span>
                  <h2>{selected.title}</h2>
                  <p>{contextLabel}</p>
                </div>
                <div className="ask-thread-actions">
                  <button type="button" onClick={() => setHistoryOpen(true)}>History</button>
                  <button type="button" onClick={() => setCitationsOpen(true)}>Evidence</button>
                  <button type="button" onClick={() => navigateTo(pathWithFocus(!isFocus))}>{isFocus ? "Exit focus" : "Focus mode"}</button>
                  <button type="button" disabled={Boolean(conversationBusy)} onClick={() => void renameConversation(selected)}>{conversationBusy === "rename" ? "Renaming..." : "Rename"}</button>
                  {selected.status === "archived"
                    ? <button type="button" disabled={Boolean(conversationBusy)} onClick={() => void setConversationStatus(selected, "active")}>{conversationBusy === "active" ? "Restoring..." : "Restore"}</button>
                    : <button type="button" disabled={Boolean(conversationBusy)} onClick={() => void setConversationStatus(selected, "archived")}>{conversationBusy === "archived" ? "Archiving..." : "Archive"}</button>}
                </div>
              </div>
              <div className="ask-message-list" aria-live="polite">
                {selected.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} onRetry={(text) => void send(text)} onCreated={handleCreated} onEvidence={openCitationEvidence} />
                ))}
                {sending && (
                  <article className="ask-workspace-message assistant pending">
                    <div className="ask-message-topline"><span>Ask</span><em>{streamingStatus}</em></div>
                    <div role="status" aria-live="polite">
                      {streamingText ? <SanitizedMarkdown text={streamingText} /> : <p>Preparing an evidence-backed answer.</p>}
                    </div>
                    <button type="button" onClick={() => requestController.current?.abort()}>Stop research</button>
                  </article>
                )}
              </div>
            </>
          ) : (
            <EmptyState headline="Start with a question" body="Ask about an account, score, confirmed signal, work item, or deliverable." icon="ask" />
          )}
          <form
            className="ask-workspace-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="ask-context-chip">
              <span>Context</span>
              <strong>{contextLabel}</strong>
              {Object.values(context).some(Boolean) && <button type="button" onClick={() => setContext({})}>Remove</button>}
            </div>
            <fieldset className="ask-source-mode">
              <legend>Sources</legend>
              {([
                ["automatic", "Automatic"],
                ["workspace", "Workspace"],
                ["workspace_web", "Workspace + web"],
                ["web", "Web"],
              ] as Array<[AssistantSourceMode, string]>).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="ask-source-mode"
                    value={value}
                    checked={sourceMode === value}
                    onChange={() => setSourceMode(value)}
                    disabled={sending}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <div className="ask-context-actions" aria-label="Contextual Ask actions">
              {[
                "Explain this evidence",
                "Summarize what changed",
                "Identify missing information",
                "Prepare talking points",
                "Draft the executive brief",
              ].map((action) => (
                <button key={action} type="button" onClick={() => setDraft(action)}>
                  {action}
                </button>
              ))}
            </div>
            <label>
              <span>Message Ask</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask what changed, why a score moved, what needs approval, or prepare a brief draft..."
                disabled={sending || selected?.status === "archived"}
                rows={3}
              />
            </label>
            <button type="submit" disabled={sending || !draft.trim() || selected?.status === "archived"}>{sending ? "Sending..." : "Send"}</button>
          </form>
        </main>

        <aside className={citationsOpen ? "ask-citation-panel drawer-open" : "ask-citation-panel"} aria-label="Citations and context">
          <section>
            <div className="ask-citation-head"><h2>Evidence</h2><button type="button" className="ask-drawer-close" onClick={() => setCitationsOpen(false)}>Close</button></div>
            {citationMessages.flatMap((message) => message.citations.map((citation) => ({ message, citation }))).slice(-12).map(({ message, citation }) => (
              <div key={`${message.id}-${citation.id}`} className="ask-citation-card">
                <button type="button" onClick={(event) => openCitationEvidence(citation, event.currentTarget)}>
                  <strong>{citation.title}</strong>
                  <span>{sourceClass(citation)} · {displayLabel(citation.claim_classification)}{citation.relationship_status ? ` · ${displayLabel(citation.relationship_status)}` : ""}</span>
                  <em>{citation.claim}</em>
                </button>
                <details>
                  <summary>More</summary>
                  <button type="button" onClick={() => navigateTo(citation.route)}>Open record</button>
                </details>
              </div>
            ))}
            {selected && selected.messages.every((message) => message.citations.length === 0) && <div className="rail-quiet-empty">No citations yet.</div>}
          </section>
          <section>
            <h2>Work context</h2>
            <WorkItemSourceNote source={attention.source} error={attention.error} />
            <WorkItemList items={attention.items.slice(0, 3)} empty="No urgent work items to anchor the conversation." world={world} compact />
          </section>
        </aside>
      </div>
      <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} triggerRef={evidenceTriggerRef} />
    </section>
  );
}
