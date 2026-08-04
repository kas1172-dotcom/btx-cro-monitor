import { backendHeaders, backendJson, BACKEND_ENDPOINT } from "./backendApi.ts";
import type { WorkItem } from "./workItems.ts";

export interface AssistantContext {
  account_id?: string | null;
  program_id?: string | null;
  work_item_id?: string | null;
  signal_id?: string | null;
  deliverable_id?: string | null;
  route?: string | null;
  metric_states?: Record<string, { state: "available" | "unavailable" | "stale" | "error"; value: number | null; reason: string; asOf: string | null }>;
}

export interface AssistantCitation {
  id: string;
  source_type: string;
  record_id: string;
  title: string;
  route: string;
  claim: string;
  claim_classification: "fact" | "derived" | "inference" | "missing" | "simulation" | "workspace_fact" | "public_fact" | "derived_analysis" | "market_level_hypothesis" | "unconfirmed_account_match" | "missing_information";
  data_classification: string;
  relationship_status: string | null;
  url?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  retrieved_at?: string | null;
  freshness?: string | null;
}

export interface AssistantMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  tool_activity: string[];
  citations: AssistantCitation[];
  related_records: Array<{ type?: string; id?: string; title?: string; route?: string }>;
  action_draft: { requires_confirmation: boolean; create_via: string; payload: Record<string, unknown> } | null;
  deliverable_draft: { requires_confirmation: boolean; create_via: string; payload: Record<string, unknown> } | null;
  metadata: {
    orchestration?: string;
    engine_mode?: "llm_connected" | "rules_based_fallback" | "cached_answer" | "unavailable";
    scope?: "workspace" | "account" | "program" | "work_item" | "deliverable";
    requested_source_mode?: AssistantSourceMode;
    actual_source_mode?: Exclude<AssistantSourceMode, "automatic">;
    as_of?: string;
    model?: string;
    sources_reviewed?: number;
    search_count?: number;
    warnings?: string[];
    partial_failure?: boolean;
  };
  created_at: string;
}

export interface AssistantConversation {
  id: string;
  title: string;
  status: "active" | "archived";
  context: AssistantContext | null;
  related_account_id: string | null;
  related_program_id: string | null;
  related_work_item_id: string | null;
  related_signal_id: string | null;
  related_deliverable_id: string | null;
  message_count: number;
  preview: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  messages: AssistantMessage[];
}

export interface AssistantAskResponse {
  conversation: AssistantConversation;
  user_message: AssistantMessage;
  assistant_message: AssistantMessage;
}

export type AssistantSourceMode = "automatic" | "workspace" | "workspace_web" | "web";

export interface StoredAssistantDeliverable {
  id: string;
  title: string;
  type: string;
  canonical_account_id: string | null;
  program_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAssistantConversations(status: "active" | "archived" | "all" = "active", search = ""): Promise<AssistantConversation[]> {
  const params = new URLSearchParams({ status });
  if (search.trim()) params.set("q", search.trim());
  const response = await backendJson<{ records: AssistantConversation[] }>(`/assistant/conversations?${params.toString()}`);
  return response.records;
}

export function getAssistantConversation(id: string): Promise<AssistantConversation> {
  return backendJson<AssistantConversation>(`/assistant/conversations/${encodeURIComponent(id)}`);
}

export function createAssistantConversation(context?: AssistantContext, title?: string): Promise<AssistantConversation> {
  return backendJson<AssistantConversation>("/assistant/conversations", {
    method: "POST",
    body: JSON.stringify({ context, title }),
  });
}

export function updateAssistantConversation(id: string, patch: { title?: string; status?: "active" | "archived"; context?: AssistantContext }): Promise<AssistantConversation> {
  return backendJson<AssistantConversation>(`/assistant/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function askAssistant(input: { message: string; conversation_id?: string | null; context?: AssistantContext; source_mode?: AssistantSourceMode }, signal?: AbortSignal): Promise<AssistantAskResponse> {
  return backendJson<AssistantAskResponse>("/assistant/ask", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function askAssistantStream(
  input: { message: string; conversation_id?: string | null; context?: AssistantContext; source_mode?: AssistantSourceMode },
  handlers: { onStatus?: (message: string) => void; onDelta?: (text: string) => void },
  signal?: AbortSignal,
): Promise<AssistantAskResponse> {
  if (!BACKEND_ENDPOINT) throw new Error("VITE_BACKEND_ENDPOINT is not configured.");
  const headers = await backendHeaders({ "content-type": "application/json", accept: "text/event-stream" });
  const response = await fetch(`${BACKEND_ENDPOINT}/assistant/ask/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Backend Ask stream failed (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AssistantAskResponse | null = null;
  function dispatch(raw: string) {
    const eventName = raw.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
    if (eventName === "status") handlers.onStatus?.(String(data.message ?? "Working"));
    if (eventName === "delta") handlers.onDelta?.(String(data.text ?? ""));
    if (eventName === "error") throw new Error(String(data.detail ?? "Ask stream failed."));
    if (eventName === "final") final = data as unknown as AssistantAskResponse;
  }
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) dispatch(part);
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
  if (!final) throw new Error("Ask stream ended before the final answer arrived.");
  return final;
}

export function createWorkItemFromAssistantDraft(payload: Record<string, unknown>): Promise<WorkItem> {
  return backendJson<WorkItem>("/work-items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createDeliverableFromAssistantDraft(payload: Record<string, unknown>): Promise<StoredAssistantDeliverable> {
  return backendJson<StoredAssistantDeliverable>("/deliverables", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
