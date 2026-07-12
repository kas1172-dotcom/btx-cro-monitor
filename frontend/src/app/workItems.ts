import { useEffect, useMemo, useState } from "react";
import { BACKEND_ENDPOINT, backendJson } from "./backendApi.ts";
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
  | "dismissed";

export type WorkItemStatus = "proposed" | "approved" | "in_progress" | "done" | "dismissed";
export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type ExecutionState = "not_started" | "queued" | "running" | "completed" | "failed";
export type WorkItemView = "what_changed" | "needs_attention" | "prepared" | "needs_approval" | "outcomes";

export interface WorkItem {
  id: string;
  type: WorkItemType;
  canonical_account_id: string | null;
  source_signal_ids: string[];
  owner: string | null;
  priority: WorkItemPriority;
  status: WorkItemStatus;
  due_date: string | null;
  recommended_action: string;
  generated_artifact_ref: string | null;
  approval_state: ApprovalState;
  execution_state: ExecutionState;
  outcome: string | null;
  follow_up_date: string | null;
  external_system: string | null;
  external_record_id: string | null;
  external_record_url: string | null;
  execution_idempotency_key: string | null;
  execution_error: string | null;
  audit_history: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface WorkItemCreate {
  type: WorkItemType;
  canonical_account_id?: string | null;
  source_signal_ids?: string[];
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
  source: "backend" | "derived";
  error: string | null;
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
  return world.companies.find((company) => company.id === id || company.canonical_account_id === id)?.name ?? id;
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
    source_signal_ids: world.analysis.valid.filter((signal) => signal.subject_id === rec.subject_id).slice(0, 3).map((signal) => signal.id),
    owner: null,
    priority: rec.priority === "high" ? "high" : rec.priority === "medium" ? "normal" : "low",
    status: "proposed",
    due_date: isoDate(index < 3 ? 2 : 5),
    recommended_action: `${accountName(world, rec.subject_id)}: ${rec.reason}`,
    generated_artifact_ref: null,
    approval_state: "not_required",
    execution_state: "not_started",
    outcome: null,
    follow_up_date: null,
    external_system: null,
    external_record_id: null,
    external_record_url: null,
    execution_idempotency_key: null,
    execution_error: null,
    audit_history: derivedAudit("derived_from_recommendation"),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const signalItems = world.analysis.valid.slice(0, 12).map<WorkItem>((signal) => ({
    id: `derived-signal-${signal.id}`,
    type: signalAccountId(signal) ? "research_task" : "customer_question",
    canonical_account_id: signalAccountId(signal),
    source_signal_ids: [signal.id],
    owner: null,
    priority: signal.confidence >= 0.9 ? "high" : "normal",
    status: "proposed",
    due_date: isoDate(3),
    recommended_action: signalAccountId(signal)
      ? `${accountName(world, signal.subject_id)}: review ${signal.event_type.replace(/_/g, " ")} from ${sourceLabel(signal)}.`
      : `Portfolio: review market-level ${signal.event_type.replace(/_/g, " ")} from ${sourceLabel(signal)}.`,
    generated_artifact_ref: signal.artifact?.item_id ?? null,
    approval_state: signal.value || signal.confidence >= 0.9 ? "pending" : "not_required",
    execution_state: "not_started",
    outcome: null,
    follow_up_date: null,
    external_system: null,
    external_record_id: null,
    external_record_url: null,
    execution_idempotency_key: null,
    execution_error: null,
    audit_history: derivedAudit("derived_from_signal"),
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
      source_signal_ids: world.analysis.valid.filter((signal) => signal.subject_id === opp.company_id).slice(0, 2).map((signal) => signal.id),
      owner: null,
      priority: opp.stage === "proposal" ? "high" : "normal",
      status: "approved",
      due_date: opp.close_date,
      recommended_action: `${accountName(world, opp.company_id)}: prepare for ${opp.name}.`,
      generated_artifact_ref: opp.id,
      approval_state: "pending",
      execution_state: "not_started",
      outcome: null,
      follow_up_date: null,
      external_system: null,
      external_record_id: null,
      external_record_url: null,
      execution_idempotency_key: null,
      execution_error: null,
      audit_history: derivedAudit("derived_from_opportunity"),
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
      return items.filter((item) => !["done", "dismissed"].includes(item.status) && (item.priority === "urgent" || item.priority === "high" || (item.due_date ?? "9999-99-99") < now));
    case "prepared":
      return items.filter((item) => Boolean(item.generated_artifact_ref));
    case "needs_approval":
      return items.filter((item) => item.approval_state === "pending");
    case "outcomes":
      return items.filter((item) => item.status === "done" || item.status === "dismissed");
    default:
      return items;
  }
}

export async function loadWorkItems(world: World, view?: WorkItemView): Promise<WorkItemState> {
  const derived = filterWorkItems(deriveWorkItems(world), view);
  if (!BACKEND_ENDPOINT) return { items: derived, source: "derived", error: null };
  try {
    const query = view ? `?${VIEW_PARAMS[view]}` : "";
    const response = await backendJson<{ records: WorkItem[] }>(`/work-items${query}`);
    return { items: response.records, source: "backend", error: null };
  } catch (error) {
    return {
      items: derived,
      source: "derived",
      error: error instanceof Error ? error.message : "Could not load backend work items.",
    };
  }
}

export function useWorkItems(world: World, view?: WorkItemView): WorkItemState {
  const fallback = useMemo(() => filterWorkItems(deriveWorkItems(world), view), [view, world]);
  const [state, setState] = useState<WorkItemState>({ items: fallback, source: "derived", error: null });

  useEffect(() => {
    let alive = true;
    setState({ items: fallback, source: "derived", error: null });
    void loadWorkItems(world, view).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [fallback, view, world]);

  return state;
}

export function draftToCreatePayload(draft: WorkItemDraft): WorkItemCreate {
  return {
    type: draft.type ?? "account_action",
    canonical_account_id: draft.accountId ?? null,
    source_signal_ids: draft.sourceSignalIds ?? [],
    priority: draft.priority ?? "normal",
    status: "proposed",
    due_date: draft.dueDate ?? isoDate(3),
    recommended_action: draft.title,
    generated_artifact_ref: draft.evidence ?? null,
    approval_state: "pending",
    execution_state: "not_started",
  };
}

export async function createWorkItem(draft: WorkItemDraft): Promise<WorkItem> {
  return backendJson<WorkItem>("/work-items", {
    method: "POST",
    body: JSON.stringify(draftToCreatePayload(draft)),
  });
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

export function hubSpotTaskIdempotencyKey(item: WorkItem): string {
  return item.execution_idempotency_key ?? `work-item:${item.id}:hubspot-task`;
}

export async function executeHubSpotTask(input: ExecuteHubSpotTaskInput): Promise<ExecuteHubSpotTaskResult> {
  return backendJson<ExecuteHubSpotTaskResult>(`/work-items/${input.item.id}/execute/hubspot-task`, {
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
}
