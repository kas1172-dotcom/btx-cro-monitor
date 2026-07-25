import { useEffect, useMemo, useRef, useState } from "react";
import {
  askAssistant,
  createAssistantConversation,
  createDeliverableFromAssistantDraft,
  createWorkItemFromAssistantDraft,
  getAssistantConversation,
  listAssistantConversations,
  updateAssistantConversation,
  type AssistantContext,
  type AssistantConversation,
  type AssistantMessage,
} from "../../app/assistantApi.ts";
import { navigateTo, useAppRoute } from "../../app/router.ts";
import type { World } from "../../app/useWorld.ts";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { useWorkItems } from "../../app/workItems.ts";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";

function displayTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function accountName(world: World, accountId?: string | null): string | null {
  if (!accountId) return null;
  return world.companies.find((company) => company.id === accountId || company.canonical_account_id === accountId)?.name ?? accountId;
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
}: {
  message: AssistantMessage;
  onRetry: (text: string) => void;
  onCreated: (route: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const isUser = message.role === "user";
  return (
    <article className={`ask-workspace-message ${isUser ? "user" : "assistant"}`}>
      <div className="ask-message-topline">
        <span>{isUser ? "You" : "Ask"}</span>
        <em>{displayTime(message.created_at)}</em>
      </div>
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
        <p>{message.content}</p>
      )}
      {!isUser && message.tool_activity.length > 0 && (
        <div className="ask-activity-row" aria-label="Ask activity">
          {message.tool_activity.map((activity) => <span key={activity}>{activity}</span>)}
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
  const [error, setError] = useState<string | null>(null);
  const [createdRoute, setCreatedRoute] = useState<string | null>(null);
  const appliedPrompt = useRef<string | null>(null);
  const attention = useWorkItems(world, "needs_attention");

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

  async function send(textOverride?: string) {
    const message = (textOverride ?? draft).trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setCreatedRoute(null);
    const currentId = selected?.status === "active" ? selected.id : null;
    try {
      const response = await askAssistant({ message, conversation_id: currentId, context });
      setSelected(response.conversation);
      setDraft("");
      navigateTo(`/ask/${encodeURIComponent(response.conversation.id)}`, { replace: true });
      void loadConversations(response.conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  async function startConversation() {
    setError(null);
    try {
      const created = await createAssistantConversation(context);
      setSelected(created);
      setDraft("");
      navigateTo(`/ask/${encodeURIComponent(created.id)}`);
      void loadConversations(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create conversation.");
    }
  }

  async function renameConversation(conversation: AssistantConversation) {
    const title = window.prompt("Conversation name", conversation.title);
    if (!title?.trim()) return;
    const updated = await updateAssistantConversation(conversation.id, { title: title.trim() });
    setSelected(updated);
    void loadConversations(updated.id);
  }

  async function setConversationStatus(conversation: AssistantConversation, status: "active" | "archived") {
    const updated = await updateAssistantConversation(conversation.id, { status });
    setSelected(updated);
    void loadConversations(updated.id);
  }

  function handleCreated(routePath: string) {
    setCreatedRoute(routePath);
    world.refresh();
  }

  const selectedContext = selected?.context ?? context;
  const contextLabel = compactContext(selectedContext, world);
  const conversations = [...activeConversations, ...archivedConversations];

  return (
    <section className="surface-page ask-surface ask-workspace" data-surface-component="surface-ask">
      <SurfaceHeader
        eyebrow="Ask"
        headline="Ask"
        subline="Grounded answers use internal records, current work, deliverables, scores, and cited account signals."
      />
      <div className="ask-workspace-grid">
        <aside className="ask-conversation-sidebar" aria-label="Ask conversations">
          <div className="ask-sidebar-actions">
            <button type="button" onClick={() => void startConversation()}>New conversation</button>
            <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Account or topic" /></label>
          </div>
          {loading && <div className="rail-quiet-empty">Loading conversations...</div>}
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
                  <button type="button" onClick={() => void renameConversation(selected)}>Rename</button>
                  {selected.status === "archived"
                    ? <button type="button" onClick={() => void setConversationStatus(selected, "active")}>Restore</button>
                    : <button type="button" onClick={() => void setConversationStatus(selected, "archived")}>Archive</button>}
                </div>
              </div>
              <div className="ask-message-list" aria-live="polite">
                {selected.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} onRetry={(text) => void send(text)} onCreated={handleCreated} />
                ))}
                {sending && (
                  <article className="ask-workspace-message assistant pending">
                    <div className="ask-message-topline"><span>Ask</span><em>Working</em></div>
                    <div className="ask-activity-row"><span>Reviewing account records</span><span>Checking open work</span></div>
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

        <aside className="ask-citation-panel" aria-label="Citations and context">
          <section>
            <h2>Citations</h2>
            {selected?.messages.flatMap((message) => message.citations).slice(-8).map((citation) => (
              <button key={citation.id} type="button" onClick={() => navigateTo(citation.route)}>
                <strong>{citation.title}</strong>
                <span>{citation.claim_classification} · {citation.data_classification}{citation.relationship_status ? ` · ${citation.relationship_status}` : ""}</span>
                <em>{citation.claim}</em>
              </button>
            ))}
            {selected && selected.messages.every((message) => message.citations.length === 0) && <div className="rail-quiet-empty">No citations yet.</div>}
          </section>
          <section>
            <h2>Work context</h2>
            <WorkItemSourceNote source={attention.source} error={attention.error} />
            <WorkItemList items={attention.items.slice(0, 3)} empty="No urgent work items to anchor the conversation." world={world} />
          </section>
        </aside>
      </div>
    </section>
  );
}
