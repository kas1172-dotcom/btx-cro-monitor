import { useMemo, useRef, useState } from "react";
import { navigateTo, useAppRoute } from "../../app/router.ts";
import type { World } from "../../app/useWorld.ts";
import {
  addWorkItemNote,
  executeHubSpotTask,
  previewHubSpotTask,
  transitionWorkItem,
  updateWorkItemMetadata,
  useWorkItems,
  type HubSpotTaskPreview,
  type WorkItem,
  type WorkItemFilters,
  type WorkItemPriority,
  type WorkItemStatus,
  type WorkItemTransitionAction,
  type WorkItemType,
} from "../../app/workItems.ts";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";
import { WorkItemList, WorkItemSourceNote } from "./WorkItemList.tsx";
import { plainActionLabel, plainApprovalState, plainExecutionState, plainWorkStatus, plainWorkType, primaryWorkAction } from "../../app/presentation.ts";
import { buildSignalEvidence, buildWorkItemEvidence, type EvidencePackage } from "../../app/evidence.ts";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer.tsx";
import { buildWorkTimeline } from "../../app/timeline.ts";
import { MeaningfulTimeline } from "../timeline/MeaningfulTimeline.tsx";
import { canonicalMetrics, formatCanonicalMetric } from "../../app/canonicalMetrics.ts";
import { formatDateTime } from "../../app/format.ts";

const STATUSES: Array<WorkItemStatus | "all"> = [
  "all",
  "detected",
  "triaged",
  "prepared",
  "awaiting_approval",
  "approved",
  "in_progress",
  "executed",
  "verified",
  "outcome_recorded",
  "closed",
  "dismissed",
];
const TYPES: Array<WorkItemType | "all"> = ["all", "account_action", "research_task", "capacity_check", "meeting_brief", "outreach_draft", "relationship_review", "hubspot_task"];
const PRIORITIES: Array<WorkItemPriority | "all"> = ["all", "urgent", "high", "normal", "low"];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function dateValue(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function accountName(world: World, id: string | null): string {
  if (!id) return "Portfolio";
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? "Account record unavailable";
}

function filtersFromQuery(query: URLSearchParams): WorkItemFilters {
  return {
    status: (query.get("status") as WorkItemStatus | null) ?? "all",
    type: (query.get("type") as WorkItemType | null) ?? "all",
    owner: query.get("owner") ?? "",
    account: query.get("account") ?? "",
    program: query.get("program") ?? "",
    priority: (query.get("priority") as WorkItemPriority | null) ?? "all",
    approval: (query.get("approval") as WorkItemFilters["approval"]) ?? "all",
    execution: (query.get("execution") as WorkItemFilters["execution"]) ?? "all",
    overdue: query.get("overdue") === "true",
    sort: (query.get("sort") as WorkItemFilters["sort"]) ?? "updated",
  };
}

function updateFilter(filters: WorkItemFilters, patch: Partial<WorkItemFilters>): void {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.status && next.status !== "all") params.set("status", next.status);
  if (next.type && next.type !== "all") params.set("type", next.type);
  if (next.owner) params.set("owner", next.owner);
  if (next.account) params.set("account", next.account);
  if (next.program) params.set("program", next.program);
  if (next.priority && next.priority !== "all") params.set("priority", next.priority);
  if (next.approval && next.approval !== "all") params.set("approval", next.approval);
  if (next.execution && next.execution !== "all") params.set("execution", next.execution);
  if (next.overdue) params.set("overdue", "true");
  if (next.sort && next.sort !== "updated") params.set("sort", next.sort);
  navigateTo(`/work${params.toString() ? `?${params.toString()}` : ""}`);
}

function nextActionLabel(action: WorkItemTransitionAction): string {
  return plainActionLabel(action);
}

type BusyAction = WorkItemTransitionAction | "metadata" | "note" | "hubspot_preview" | "hubspot_execute";

function actionProgressLabel(action: BusyAction): string {
  if (action === "dismiss") return "Dismissing...";
  if (action === "reject") return "Returning...";
  if (action === "record_outcome") return "Recording...";
  if (action === "close") return "Closing...";
  if (action === "note") return "Adding...";
  if (action === "hubspot_preview") return "Previewing...";
  if (action === "hubspot_execute") return "Executing...";
  return "Saving...";
}

function preActivationReason(action: WorkItemTransitionAction): string | null {
  if (action === "dismiss" || action === "reject") return "A reason is required before this action runs.";
  if (action === "record_outcome") return "An outcome summary is required before this action runs.";
  return null;
}

function needsConfirmation(action: WorkItemTransitionAction): boolean {
  return action === "dismiss" || action === "reject" || action === "record_outcome" || action === "close";
}

function WorkItemDetail({ item, world }: { item: WorkItem; world: World }) {
  const route = useAppRoute();
  const [draft, setDraft] = useState({
    owner: item.owner ?? "",
    priority: item.priority,
    due_date: dateValue(item.due_date),
    follow_up_date: dateValue(item.follow_up_date),
    recommended_action: item.recommended_action,
    description: item.description ?? "",
  });
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [pendingAction, setPendingAction] = useState<WorkItemTransitionAction | null>(null);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState("");
  const [undoAction, setUndoAction] = useState<{ item: WorkItem; label: string } | null>(null);
  const [preview, setPreview] = useState<HubSpotTaskPreview | null>(null);
  const [evidence, setEvidence] = useState<EvidencePackage | null>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const account = accountName(world, item.canonical_account_id);
  const primary = primaryWorkAction(item);
  const timeline = buildWorkTimeline(world, item);
  const isFocus = route.query.get("view") === "focus";

  function pathWithFocus(nextFocus: boolean): string {
    const params = new URLSearchParams(route.query);
    if (nextFocus) params.set("view", "focus");
    else params.delete("view");
    const query = params.toString();
    return `${route.path}${query ? `?${query}` : ""}`;
  }

  function openEvidence(next: EvidencePackage, trigger?: HTMLButtonElement | null) {
    evidenceTriggerRef.current = trigger ?? null;
    setEvidence(next);
  }

  async function run(action: WorkItemTransitionAction, details: { reason?: string; outcome?: string } = {}) {
    if (busyAction) return;
    setError(null);
    setMessage(null);
    setBusyAction(action);
    try {
      const updated = await transitionWorkItem(item, action, { reason: details.reason?.trim() || undefined, outcome: details.outcome?.trim() || undefined });
      setMessage(`${nextActionLabel(action)} saved.`);
      setPendingAction(null);
      setPendingReason("");
      setPendingOutcome("");
      setUndoAction(action === "dismiss" || action === "close" ? { item: updated, label: action === "dismiss" ? "Undo dismiss" : "Undo close" } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update work item.");
    } finally {
      setBusyAction(null);
    }
  }

  function requestAction(action: WorkItemTransitionAction) {
    setError(null);
    if (needsConfirmation(action)) {
      setPendingAction(action);
      setPendingReason("");
      setPendingOutcome("");
      return;
    }
    void run(action);
  }

  async function undoLastAction() {
    if (!undoAction || busyAction) return;
    setBusyAction("reopen");
    setError(null);
    try {
      await transitionWorkItem(undoAction.item, "reopen");
      setMessage(`${undoAction.label} saved.`);
      setUndoAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo the last action.");
    } finally {
      setBusyAction(null);
    }
  }

  function actionButton(action: WorkItemTransitionAction) {
    return (
      <button
        key={action}
        type="button"
        disabled={Boolean(busyAction)}
        title={busyAction ? "Another action is still pending." : preActivationReason(action) ?? undefined}
        onClick={() => requestAction(action)}
      >
        {busyAction === action ? actionProgressLabel(action) : nextActionLabel(action)}
      </button>
    );
  }

  const pendingActionReady = pendingAction
    ? ((pendingAction !== "dismiss" && pendingAction !== "reject") || pendingReason.trim().length > 0)
      && (pendingAction !== "record_outcome" || pendingOutcome.trim().length > 0)
    : false;

  return (
    <section className={isFocus ? "surface-panel work-detail record-focus-mode" : "surface-panel work-detail"} aria-labelledby="work-detail-title">
      <div className="panel-head">
        <div>
          <h2 id="work-detail-title">{item.recommended_action}</h2>
          <span>{plainWorkType(item.type)} · {account}</span>
        </div>
        <div className="panel-action-group">
          <button type="button" onClick={() => navigateTo(pathWithFocus(!isFocus))}>{isFocus ? "Exit focus" : "Focus mode"}</button>
          <button ref={evidenceTriggerRef} type="button" onClick={() => openEvidence(buildWorkItemEvidence(world, item), evidenceTriggerRef.current)}>View evidence</button>
          <button type="button" onClick={() => navigateTo(`/ask?work=${encodeURIComponent(item.id)}${item.canonical_account_id ? `&account=${encodeURIComponent(item.canonical_account_id)}` : ""}&prompt=${encodeURIComponent("What is the next safe action for this work item?")}`)}>Ask about this work</button>
          <button type="button" onClick={() => navigateTo("/work")}>Back to queue</button>
        </div>
      </div>
      <div className="work-decision-summary">
        <div>
          <span>Decision</span>
          <strong>{plainWorkStatus(item.status)}</strong>
          <em>{item.owner ? `Owned by ${item.owner}` : "Unassigned"}</em>
        </div>
        <div>
          <span>Recommended next action</span>
          <strong>{primary ? plainActionLabel(primary) : "Review current state"}</strong>
          <em>{item.due_date ? `Due ${new Date(item.due_date).toLocaleDateString()}` : "No due date"}</em>
        </div>
        {primary && actionButton(primary)}
      </div>
      {message && (
        <div className="live-inline-status" role="status">
          {message}
          {undoAction && <button type="button" disabled={Boolean(busyAction)} onClick={() => void undoLastAction()}>{busyAction === "reopen" ? "Undoing..." : undoAction.label}</button>}
        </div>
      )}
      {error && <div className="live-inline-status error" role="alert">{error}</div>}
      {pendingAction && (
        <div className="work-preview" role="dialog" aria-label={`${plainActionLabel(pendingAction)} confirmation`}>
          <strong>{plainActionLabel(pendingAction)}</strong>
          <p>This action changes the work item after confirmation. Use Cancel to leave it unchanged; Back to queue returns to the work list.</p>
          {(pendingAction === "dismiss" || pendingAction === "reject") && (
            <label>Reason required<textarea value={pendingReason} placeholder="Explain why this item should not continue in its current state." onChange={(event) => setPendingReason(event.target.value)} /></label>
          )}
          {pendingAction === "record_outcome" && (
            <label>Outcome required<textarea value={pendingOutcome} placeholder="Summarize what happened and how it was verified." onChange={(event) => setPendingOutcome(event.target.value)} /></label>
          )}
          {pendingAction === "close" && <p>Close only when no further owner action is expected. You can undo immediately from the success message if this was accidental.</p>}
          <div>
            <button type="button" disabled={!pendingActionReady || Boolean(busyAction)} onClick={() => void run(pendingAction, { reason: pendingReason, outcome: pendingOutcome })}>
              {busyAction === pendingAction ? actionProgressLabel(pendingAction) : plainActionLabel(pendingAction)}
            </button>
            <button type="button" disabled={Boolean(busyAction)} onClick={() => setPendingAction(null)}>Cancel</button>
          </div>
          {!pendingActionReady && <p className="muted">{preActivationReason(pendingAction) ?? "Confirm before this action runs."}</p>}
        </div>
      )}
      <div className="work-detail-grid">
        <label>Owner<input value={draft.owner} placeholder="Unassigned" onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label>
        <label>Priority<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as WorkItemPriority })}>{PRIORITIES.filter((value) => value !== "all").map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label>Due date<input type="date" value={draft.due_date} onChange={(event) => setDraft({ ...draft, due_date: event.target.value })} /></label>
        <label>Follow-up<input type="date" value={draft.follow_up_date} onChange={(event) => setDraft({ ...draft, follow_up_date: event.target.value })} /></label>
      </div>
      <label className="work-detail-field">Recommended action<textarea value={draft.recommended_action} onChange={(event) => setDraft({ ...draft, recommended_action: event.target.value })} /></label>
      <label className="work-detail-field">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <button
        type="button"
        disabled={Boolean(busyAction)}
        onClick={() => {
          if (busyAction) return;
          setError(null);
          setBusyAction("metadata");
          void updateWorkItemMetadata(item, {
            owner: draft.owner.trim() || null,
            priority: draft.priority,
            due_date: draft.due_date || null,
            follow_up_date: draft.follow_up_date || null,
            recommended_action: draft.recommended_action,
            description: draft.description || null,
          }).then(() => setMessage("Assignment and schedule saved.")).catch((err) => setError(err instanceof Error ? err.message : "Could not save assignment and schedule.")).finally(() => setBusyAction(null));
        }}
      >
        {busyAction === "metadata" ? "Saving..." : "Save assignment and schedule"}
      </button>
      <div className="work-state-strip">
        <span>Status: {plainWorkStatus(item.status)}</span>
        <span>Approval: {plainApprovalState(item.approval_state)}</span>
        <span>Execution: {plainExecutionState(item.execution_state)}</span>
        <span>Updated: {formatDateTime(item.updated_at)}</span>
      </div>
      <details className="work-diagnostics">
        <summary>Technical details</summary>
        <pre>{JSON.stringify({
          work_item_id: item.id,
          status: item.status,
          approval_state: item.approval_state,
          execution_state: item.execution_state,
          external_system: item.external_system,
          external_record_id: item.external_record_id,
          execution_idempotency_key: item.execution_idempotency_key,
          allowed_actions: item.allowed_actions,
        }, null, 2)}</pre>
      </details>
      <div className="surface-toolbar">
        {item.allowed_actions.filter((action) => action !== primary).map((action) => actionButton(action))}
        {item.allowed_actions.filter((action) => action !== primary).length === 0 && <span>No additional permitted actions for your role or this state.</span>}
      </div>
      <div className="surface-toolbar">
        <button type="button" disabled={Boolean(busyAction)} onClick={() => { if (busyAction) return; setBusyAction("hubspot_preview"); void previewHubSpotTask({ item, confirmed: false }).then(setPreview).catch((err) => setError(err instanceof Error ? err.message : "Could not preview HubSpot task.")).finally(() => setBusyAction(null)); }}>{busyAction === "hubspot_preview" ? "Previewing..." : "Preview HubSpot task"}</button>
        {preview?.can_execute && (
          <button type="button" disabled={Boolean(busyAction)} onClick={() => { if (busyAction) return; setBusyAction("hubspot_execute"); void executeHubSpotTask({ item, confirmed: true, accountName: account }).then(() => setMessage("HubSpot task executed and verified.")).catch((err) => setError(err instanceof Error ? err.message : "HubSpot execution failed.")).finally(() => setBusyAction(null)); }}>{busyAction === "hubspot_execute" ? "Executing..." : "Execute approved task"}</button>
        )}
        {item.external_record_url && <a className="accent-action" href={item.external_record_url} target="_blank" rel="noreferrer">Open in HubSpot</a>}
      </div>
      {preview && (
        <div className="work-preview" role="dialog" aria-label="HubSpot task preview">
          <strong>{preview.hubspot_task.subject}</strong>
          <span>Destination: {titleCase(preview.destination.system)} · {titleCase(preview.destination.environment)} · {titleCase(preview.destination.object_type)}</span>
          <span>Target: {preview.destination.target_record ?? "No target record"}</span>
          <span>Availability: {titleCase(preview.integration_availability)}</span>
          <span>Owner: {preview.hubspot_task.owner_id ?? "Unassigned"}</span>
          <span>Due: {preview.hubspot_task.due_at}</span>
          <span>Approval: {titleCase(preview.approval.state)} · {preview.approval.policy}</span>
          <span>Idempotency protection: enabled</span>
          <span>Verification: {preview.verification.method}</span>
          <pre>{preview.hubspot_task.body}</pre>
          <details><summary>Technical payload and idempotency key</summary><pre>{JSON.stringify({ idempotency: preview.idempotency, proposed_payload: preview.proposed_payload }, null, 2)}</pre></details>
          <button type="button" onClick={() => setPreview(null)}>Close preview</button>
        </div>
      )}
      <MeaningfulTimeline
        events={timeline}
        title="Work timeline"
        onEvidence={(next) => openEvidence(next)}
        evidenceById={(event) => {
          if (event.evidenceId?.startsWith("signal-")) {
            const signal = world.analysis.valid.find((itemSignal) => `signal-${itemSignal.id}` === event.evidenceId);
            return signal ? buildSignalEvidence(world, signal) : null;
          }
          if (event.evidenceId === `work-${item.id}`) return buildWorkItemEvidence(world, item);
          return null;
        }}
      />
      <section className="work-notes" aria-labelledby="work-notes-title">
        <h3 id="work-notes-title">Notes and findings</h3>
        <label>Add note<textarea aria-label="Add work note" placeholder="Add a note or finding" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button type="button" disabled={Boolean(busyAction) || !note.trim()} title={!note.trim() ? "Enter a note before adding it." : undefined} onClick={() => { if (busyAction || !note.trim()) return; setBusyAction("note"); void addWorkItemNote(item, note).then(() => { setNote(""); setMessage("Note added."); }).catch((err) => setError(err instanceof Error ? err.message : "Could not add note.")).finally(() => setBusyAction(null)); }}>{busyAction === "note" ? "Adding..." : "Add note"}</button>
        {item.notes.map((entry) => <p key={entry.id}><strong>{titleCase(entry.note_type)}</strong> {entry.body} <span>{formatDateTime(entry.created_at)}</span></p>)}
      </section>
      <section className="work-audit" aria-labelledby="work-audit-title">
        <h3 id="work-audit-title">Audit history</h3>
        {item.audit_history.map((entry, index) => (
          <p key={`${String(entry.id ?? entry.timestamp)}-${index}`}>
            <strong>{titleCase(String(entry.event_type ?? entry.action ?? "event"))}</strong>
            <span>{formatDateTime(String(entry.timestamp))} · {String(entry.actor ?? "system")}</span>
          </p>
        ))}
      </section>
      <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} triggerRef={evidenceTriggerRef} />
    </section>
  );
}

export function WorkQueue({ world, workItemId }: { world: World; workItemId?: string | null }) {
  const route = useAppRoute();
  const filters = useMemo(() => filtersFromQuery(route.query), [route.query]);
  const state = useWorkItems(world, filters);
  const selected = workItemId ? state.items.find((item) => item.id === workItemId) : null;
  const owners = Array.from(new Set(state.items.map((item) => item.owner).filter(Boolean))).sort() as string[];
  const metrics = canonicalMetrics(world);
  const openMetric = formatCanonicalMetric(metrics.work_open);
  const totalMetric = formatCanonicalMetric(metrics.work_total);
  const reviewMetric = formatCanonicalMetric(metrics.work_review);

  return (
    <section className="surface-page" data-surface-component="surface-work-queue">
      <SurfaceHeader
        eyebrow="Work queue"
        headline={state.error ? "Work queue unavailable" : `${state.items.length} filtered work item${state.items.length === 1 ? "" : "s"}`}
        subline={`${openMetric.displayValue} ${openMetric.displayLabel.toLowerCase()} · ${totalMetric.displayValue} ${totalMetric.displayLabel.toLowerCase()} · ${reviewMetric.displayValue} ${reviewMetric.displayLabel.toLowerCase()} · ${totalMetric.provenanceLabel}`}
      />
      <WorkItemSourceNote source={state.source} error={state.error} />
      {state.error ? (
        <EmptyState headline="Work items could not be loaded" body="Retry after the data service recovers." icon="work_queue" />
      ) : workItemId ? (
        selected ? <WorkItemDetail key={selected.id} item={selected} world={world} /> : <EmptyState headline="Work item not found" body="This work item is not in the current tenant or no longer exists." icon="work_queue" />
      ) : (
        <>
          <div className="work-filter-grid" aria-label="Work item filters">
            <label>Status<select value={filters.status ?? "all"} onChange={(event) => updateFilter(filters, { status: event.target.value as WorkItemStatus | "all" })}>{STATUSES.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : plainWorkStatus(value)}</option>)}</select></label>
            <label>Type<select value={filters.type ?? "all"} onChange={(event) => updateFilter(filters, { type: event.target.value as WorkItemType | "all" })}>{TYPES.map((value) => <option key={value} value={value}>{value === "all" ? "All types" : plainWorkType(value)}</option>)}</select></label>
            <label>Owner<select value={filters.owner ?? ""} onChange={(event) => updateFilter(filters, { owner: event.target.value })}><option value="">Any owner</option><option value="unassigned">Unassigned</option>{owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select></label>
            <label>Priority<select value={filters.priority ?? "all"} onChange={(event) => updateFilter(filters, { priority: event.target.value as WorkItemPriority | "all" })}>{PRIORITIES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
            <label>Sort<select value={filters.sort ?? "updated"} onChange={(event) => updateFilter(filters, { sort: event.target.value as WorkItemFilters["sort"] })}><option value="updated">Updated</option><option value="priority">Priority</option><option value="due_date">Due date</option><option value="account">Account</option></select></label>
            <label className="work-filter-check"><input type="checkbox" checked={Boolean(filters.overdue)} onChange={(event) => updateFilter(filters, { overdue: event.target.checked })} /> Overdue only</label>
          </div>
          <WorkItemList items={state.items} world={world} />
        </>
      )}
    </section>
  );
}
