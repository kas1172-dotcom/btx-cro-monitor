import { useMemo } from "react";
import { BACKEND_ENDPOINT, backendJson } from "./backendApi.ts";
import { invalidateQueries } from "./serverState.ts";
import type { World } from "./useWorld.ts";
import { signalSourceDate, signalSourceName } from "./signalProvenance.ts";
import type { Signal } from "../engine/signals/contract.ts";

export type WorkItemType =
  | "account_action"
  | "research_task"
  | "customer_question"
  | "capacity_check"
  | "meeting_brief"
  | "outreach_draft"
  | "qualified_opportunity"
  | "relationship_review"
  | "hubspot_task"
  | "dismissal"
  | "dismissed";

export type WorkItemStatus =
  | "detected"
  | "triaged"
  | "prepared"
  | "awaiting_approval"
  | "approved"
  | "in_progress"
  | "executed"
  | "verified"
  | "outcome_recorded"
  | "dismissed"
  | "closed";
export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type ExecutionState = "not_started" | "pending" | "executed" | "verified" | "failed";
export type WorkItemView = "what_changed" | "needs_attention" | "prepared" | "needs_approval" | "outcomes";
export type WorkItemTransitionAction =
  | "triage"
  | "prepare"
  | "request_approval"
  | "approve"
  | "reject"
  | "start"
  | "mark_executed"
  | "verify"
  | "record_outcome"
  | "dismiss"
  | "close"
  | "reopen";
export type WorkItemNoteType = "general" | "finding" | "approval" | "rejection" | "execution" | "verification" | "outcome";

const TERMINAL_STATUSES = new Set<WorkItemStatus>(["dismissed", "closed"]);

export interface WorkItemNote {
  id: string;
  work_item_id: string;
  author_user_id: string | null;
  body: string;
  note_type: WorkItemNoteType;
  evidence_ids: string[];
  created_at: string;
}

export interface WorkItem {
  id: string;
  type: WorkItemType;
  canonical_account_id: string | null;
  related_signal_id: string | null;
  related_relationship_id: string | null;
  related_opportunity_id: string | null;
  program_id: string | null;
  score_snapshot_ids: string[];
  source_signal_ids: string[];
  supporting_evidence: Array<Record<string, unknown>>;
  missing_information: string[];
  dedupe_key: string | null;
  owner: string | null;
  priority: WorkItemPriority;
  priority_status: "available" | "insufficient_data" | "provisional" | "disqualified";
  status: WorkItemStatus;
  due_date: string | null;
  description: string | null;
  recommended_action: string;
  generated_artifact_ref: string | null;
  approval_state: ApprovalState;
  execution_state: ExecutionState;
  outcome: string | null;
  outcome_category: string | null;
  dismissal_reason: string | null;
  rejection_reason: string | null;
  follow_up_date: string | null;
  external_system: string | null;
  external_record_id: string | null;
  external_record_url: string | null;
  execution_idempotency_key: string | null;
  execution_error: string | null;
  allowed_actions: WorkItemTransitionAction[];
  audit_history: Array<Record<string, unknown>>;
  notes: WorkItemNote[];
  created_at: string;
  updated_at: string;
}

export interface WorkItemCreate {
  type: WorkItemType;
  canonical_account_id?: string | null;
  related_signal_id?: string | null;
  related_relationship_id?: string | null;
  related_opportunity_id?: string | null;
  program_id?: string | null;
  score_snapshot_ids?: string[];
  source_signal_ids?: string[];
  supporting_evidence?: Array<Record<string, unknown>>;
  missing_information?: string[];
  dedupe_key?: string | null;
  owner?: string | null;
  priority?: WorkItemPriority;
  status?: WorkItemStatus;
  due_date?: string | null;
  recommended_action: string;
  generated_artifact_ref?: string | null;
  approval_state?: ApprovalState;
  execution_state?: ExecutionState;
  outcome?: string | null;
  follow_up_date?: string | null;
}

export interface WorkItemDraft {
  title: string;
  accountName?: string;
  accountId?: string;
  sourceSignalIds?: string[];
  type?: WorkItemType;
  priority?: WorkItemPriority;
  dueDate?: string | null;
  evidence?: string;
}

export interface WorkItemState {
  items: WorkItem[];
  source: "backend" | "unavailable";
  error: string | null;
}

export interface WorkItemFilters {
  view?: WorkItemView;
  status?: WorkItemStatus | "all";
  type?: WorkItemType | "all";
  owner?: string;
  account?: string;
  program?: string;
  priority?: WorkItemPriority | "all";
  approval?: ApprovalState | "all";
  execution?: ExecutionState | "all";
  overdue?: boolean;
  sort?: "updated" | "priority" | "due_date" | "account";
}

const VIEW_PARAMS: Record<WorkItemView, string> = {
  what_changed: "view=what_changed",
  needs_attention: "view=needs_attention",
  prepared: "view=prepared",
  needs_approval: "view=needs_approval",
  outcomes: "view=outcomes",
};

function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function accountName(world: World, id: string | null): string {
  if (!id) return "Portfolio";
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? "Account record unavailable";
}

function signalAccountId(signal: Signal): string | null {
  return signal.scope === "specific_account" ? signal.subject_id : null;
}

function sourceLabel(signal: Signal): string {
  return `${signalSourceName(signal)} ${signalSourceDate(signal)}`.trim();
}

function derivedAudit(action: string): Array<Record<string, unknown>> {
  return [{ action, actor: "cockpit-derived", timestamp: new Date().toISOString() }];
}

export function deriveWorkItems(world: World): WorkItem[] {
  const recommendationItems = world.analysis.recommendations.slice(0, 10).map<WorkItem>((rec, index) => ({
    id: `derived-rec-${rec.subject_id}`,
    type: "account_action",
    canonical_account_id: rec.subject_id,
    related_signal_id: null,
    related_relationship_id: null,
    related_opportunity_id: null,
    program_id: null,
    score_snapshot_ids: [],
    source_signal_ids: world.analysis.valid.filter((signal) => signal.subject_id === rec.subject_id).slice(0, 3).map((signal) => signal.id),
    supporting_evidence: [],
    missing_information: [],
    dedupe_key: null,
    owner: null,
    priority: rec.priority === "high" ? "high" : rec.priority === "medium" ? "normal" : "low",
    priority_status: "available",
    status: "detected",
    due_date: isoDate(index < 3 ? 2 : 5),
    description: null,
    recommended_action: `${accountName(world, rec.subject_id)}: ${rec.reason}`,
    generated_artifact_ref: null,
    approval_state: "not_required",
    execution_state: "not_started",
    outcome: null,
    outcome_category: null,
    dismissal_reason: null,
    rejection_reason: null,
    follow_up_date: null,
    external_system: null,
    external_record_id: null,
    external_record_url: null,
    execution_idempotency_key: null,
    execution_error: null,
    allowed_actions: [],
    audit_history: derivedAudit("derived_from_recommendation"),
    notes: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const signalItems = world.analysis.valid.slice(0, 12).map<WorkItem>((signal) => ({
    id: `derived-signal-${signal.id}`,
    type: signalAccountId(signal) ? "research_task" : "customer_question",
    canonical_account_id: signalAccountId(signal),
    related_signal_id: signal.id,
    related_relationship_id: null,
    related_opportunity_id: null,
    program_id: null,
    score_snapshot_ids: [],
    source_signal_ids: [signal.id],
    supporting_evidence: [],
    missing_information: [],
    dedupe_key: null,
    owner: null,
    priority: signal.confidence >= 0.9 ? "high" : "normal",
    priority_status: "available",
    status: "detected",
    due_date: isoDate(3),
    description: null,
    recommended_action: signalAccountId(signal)
      ? `${accountName(world, signal.subject_id)}: review ${signal.event_type.replace(/_/g, " ")} from ${sourceLabel(signal)}.`
      : `Portfolio: review market-level ${signal.event_type.replace(/_/g, " ")} from ${sourceLabel(signal)}.`,
    generated_artifact_ref: signal.artifact?.item_id ?? null,
    approval_state: signal.value || signal.confidence >= 0.9 ? "pending" : "not_required",
    execution_state: "not_started",
    outcome: null,
    outcome_category: null,
    dismissal_reason: null,
    rejection_reason: null,
    follow_up_date: null,
    external_system: null,
    external_record_id: null,
    external_record_url: null,
    execution_idempotency_key: null,
    execution_error: null,
    allowed_actions: [],
    audit_history: derivedAudit("derived_from_signal"),
    notes: [],
    created_at: signal.detected_at,
    updated_at: signal.detected_at,
  }));

  const preparedItems = world.opportunities
    .filter((opp) => opp.stage !== "won" && opp.stage !== "lost")
    .slice(0, 5)
    .map<WorkItem>((opp) => ({
      id: `derived-opp-${opp.id}`,
      type: "meeting_brief",
      canonical_account_id: opp.company_id,
      related_signal_id: null,
      related_relationship_id: null,
      related_opportunity_id: opp.id,
      program_id: null,
      score_snapshot_ids: [],
      source_signal_ids: world.analysis.valid.filter((signal) => signal.subject_id === opp.company_id).slice(0, 2).map((signal) => signal.id),
      supporting_evidence: [],
      missing_information: [],
      dedupe_key: null,
      owner: null,
      priority: opp.stage === "proposal" ? "high" : "normal",
      priority_status: "available",
      status: "approved",
      due_date: opp.close_date,
      description: null,
      recommended_action: `${accountName(world, opp.company_id)}: prepare for ${opp.name}.`,
      generated_artifact_ref: opp.id,
      approval_state: "pending",
      execution_state: "not_started",
      outcome: null,
      outcome_category: null,
      dismissal_reason: null,
      rejection_reason: null,
      follow_up_date: null,
      external_system: null,
      external_record_id: null,
      external_record_url: null,
      execution_idempotency_key: null,
      execution_error: null,
      allowed_actions: [],
      audit_history: derivedAudit("derived_from_opportunity"),
      notes: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  return [...recommendationItems, ...signalItems, ...preparedItems];
}

export function filterWorkItems(items: WorkItem[], view?: WorkItemView): WorkItem[] {
  const now = new Date().toISOString().slice(0, 10);
  switch (view) {
    case "what_changed":
      return items.filter((item) => item.source_signal_ids.length > 0);
    case "needs_attention":
      return items.filter((item) => !TERMINAL_STATUSES.has(item.status) && (item.priority === "urgent" || item.priority === "high" || (item.due_date ?? "9999-99-99") < now));
    case "prepared":
      return items.filter((item) => Boolean(item.generated_artifact_ref));
    case "needs_approval":
      return items.filter((item) => item.approval_state === "pending");
    case "outcomes":
      return items.filter((item) => TERMINAL_STATUSES.has(item.status));
    default:
      return items;
  }
}

function filterQuery(filters: WorkItemFilters = {}): string {
  const query = new URLSearchParams();
  if (filters.view) query.set("view", filters.view);
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.type && filters.type !== "all") query.set("type", filters.type);
  if (filters.owner) query.set("owner", filters.owner);
  if (filters.account) query.set("account", filters.account);
  if (filters.program) query.set("program", filters.program);
  if (filters.priority && filters.priority !== "all") query.set("priority", filters.priority);
  if (filters.approval && filters.approval !== "all") query.set("approval", filters.approval);
  if (filters.execution && filters.execution !== "all") query.set("execution", filters.execution);
  if (filters.overdue) query.set("overdue", "true");
  if (filters.sort && filters.sort !== "updated") query.set("sort", filters.sort);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function refreshWorkState(): void {
  invalidateQueries("work-items");
  invalidateQueries("work-item");
  invalidateQueries("tenant:current:world-snapshot");
}

export async function loadWorkItems(_world?: World, filters: WorkItemFilters | WorkItemView = {}): Promise<WorkItemState> {
  if (!BACKEND_ENDPOINT) return { items: [], source: "unavailable", error: "VITE_BACKEND_ENDPOINT is not configured." };
  const normalized = typeof filters === "string" ? { view: filters } : filters;
  try {
    const response = await backendJson<{ records: WorkItem[] }>(`/work-items${filterQuery(normalized)}`);
    return { items: response.records, source: "backend", error: null };
  } catch (error) {
    return {
      items: [],
      source: "unavailable",
      error: error instanceof Error ? error.message : "Could not load backend work items.",
    };
  }
}

export function useWorkItems(world: World, filters?: WorkItemFilters | WorkItemView): WorkItemState {
  const normalized = typeof filters === "string" ? { view: filters } : (filters ?? {});
  return useMemo(() => {
    if (!world.worldSnapshot) {
      return {
        items: [],
        source: "unavailable",
        error: world.loadErrors[0] ?? "Work items could not be loaded.",
      };
    }
    const today = new Date().toISOString().slice(0, 10);
    let items = filterWorkItems(world.worldSnapshot.workItems, normalized.view);
    if (normalized.status && normalized.status !== "all") items = items.filter((item) => item.status === normalized.status);
    if (normalized.type && normalized.type !== "all") items = items.filter((item) => item.type === normalized.type);
    if (normalized.owner) items = items.filter((item) => normalized.owner === "unassigned" ? !item.owner : item.owner === normalized.owner);
    if (normalized.account) items = items.filter((item) => item.canonical_account_id === normalized.account);
    if (normalized.program) items = items.filter((item) => item.program_id === normalized.program);
    if (normalized.priority && normalized.priority !== "all") items = items.filter((item) => item.priority === normalized.priority);
    if (normalized.approval && normalized.approval !== "all") items = items.filter((item) => item.approval_state === normalized.approval);
    if (normalized.execution && normalized.execution !== "all") items = items.filter((item) => item.execution_state === normalized.execution);
    if (normalized.overdue) items = items.filter((item) => Boolean(item.due_date && item.due_date < today));
    return { items, source: "backend", error: null };
  }, [normalized.account, normalized.approval, normalized.execution, normalized.overdue, normalized.owner, normalized.priority, normalized.program, normalized.status, normalized.type, normalized.view, world]);
}

export function openWorkItems(world: World): WorkItem[] {
  return (world.worldSnapshot?.workItems ?? []).filter((item) => !TERMINAL_STATUSES.has(item.status));
}

export function draftToCreatePayload(draft: WorkItemDraft): WorkItemCreate {
  return {
    type: draft.type ?? "account_action",
    canonical_account_id: draft.accountId ?? null,
    source_signal_ids: draft.sourceSignalIds ?? [],
    priority: draft.priority ?? "normal",
    status: "awaiting_approval",
    due_date: draft.dueDate ?? isoDate(3),
    recommended_action: draft.title,
    generated_artifact_ref: draft.evidence ?? null,
    approval_state: "pending",
    execution_state: "not_started",
  };
}

export async function createWorkItem(draft: WorkItemDraft): Promise<WorkItem> {
  const item = await backendJson<WorkItem>("/work-items", {
    method: "POST",
    body: JSON.stringify(draftToCreatePayload(draft)),
  });
  refreshWorkState();
  return item;
}

export async function loadWorkItem(itemId: string): Promise<WorkItem> {
  return backendJson<WorkItem>(`/work-items/${encodeURIComponent(itemId)}`);
}

export async function updateWorkItemMetadata(item: WorkItem, patch: Partial<Pick<WorkItem, "owner" | "priority" | "due_date" | "follow_up_date" | "description" | "recommended_action" | "generated_artifact_ref">>): Promise<WorkItem> {
  const updated = await backendJson<WorkItem>(`/work-items/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  refreshWorkState();
  return updated;
}

export async function transitionWorkItem(item: WorkItem, action: WorkItemTransitionAction, body: { note?: string; reason?: string; outcome?: string; outcome_category?: string; follow_up_date?: string | null } = {}): Promise<WorkItem> {
  const updated = await backendJson<WorkItem>(`/work-items/${encodeURIComponent(item.id)}/transition`, {
    method: "POST",
    body: JSON.stringify({ action, ...body }),
  });
  refreshWorkState();
  return updated;
}

export async function addWorkItemNote(item: WorkItem, body: string, noteType: WorkItemNoteType = "general", evidenceIds: string[] = []): Promise<WorkItem> {
  const updated = await backendJson<WorkItem>(`/work-items/${encodeURIComponent(item.id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body, note_type: noteType, evidence_ids: evidenceIds }),
  });
  refreshWorkState();
  return updated;
}

export interface ExecuteHubSpotTaskInput {
  item: WorkItem;
  confirmed: boolean;
  accountName?: string;
  relationshipRecord?: Record<string, unknown>;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

export interface ExecuteHubSpotTaskResult {
  status: "verified";
  duplicate: boolean;
  idempotency_key: string;
  work_item: WorkItem;
  hubspot_task: {
    id: string;
    record_url: string;
    verified?: boolean;
  };
}

export interface HubSpotTaskPreview {
  status: "preview";
  integration_availability: string;
  can_execute: boolean;
  work_item: WorkItem;
  hubspot_task: {
    canonical_account_id: string | null;
    company_id: string | null;
    owner_id: string | null;
    due_at: string;
    task_type: string;
    subject: string;
    body: string;
    supporting_evidence: Array<Record<string, unknown>>;
    source_signal_ids: string[];
    related_work_item_id: string;
    idempotency_key: string;
    associations: Array<Record<string, unknown>>;
  };
}

export function hubSpotTaskIdempotencyKey(item: WorkItem): string {
  return item.execution_idempotency_key ?? `work-item:${item.id}:hubspot-task`;
}

export async function executeHubSpotTask(input: ExecuteHubSpotTaskInput): Promise<ExecuteHubSpotTaskResult> {
  const result = await backendJson<ExecuteHubSpotTaskResult>(`/work-items/${input.item.id}/execute/hubspot-task`, {
    method: "POST",
    headers: { "x-idempotency-key": hubSpotTaskIdempotencyKey(input.item) },
    body: JSON.stringify({
      confirmed: input.confirmed,
      task_text: input.item.recommended_action,
      body: [
        input.item.recommended_action,
        input.accountName ? `Account: ${input.accountName}` : "",
        input.item.source_signal_ids.length ? `Evidence signals: ${input.item.source_signal_ids.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      evidence: input.item.generated_artifact_ref ?? input.item.source_signal_ids.join(", "),
      relationship_record: input.relationshipRecord ?? null,
      company_id: input.companyId ?? input.item.canonical_account_id,
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      owner_id: input.item.owner,
      due_at: input.item.due_date,
    }),
  });
  refreshWorkState();
  return result;
}

export async function previewHubSpotTask(input: ExecuteHubSpotTaskInput): Promise<HubSpotTaskPreview> {
  return backendJson<HubSpotTaskPreview>(`/work-items/${input.item.id}/preview/hubspot-task`, {
    method: "POST",
    headers: { "x-idempotency-key": hubSpotTaskIdempotencyKey(input.item) },
    body: JSON.stringify({
      task_text: input.item.recommended_action,
      company_id: input.companyId ?? input.item.canonical_account_id,
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      owner_id: input.item.owner,
      due_at: input.item.due_date,
    }),
  });
}
