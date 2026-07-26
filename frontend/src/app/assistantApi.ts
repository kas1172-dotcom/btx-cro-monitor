import { backendJson } from "./backendApi.ts";
import type { WorkItem } from "./workItems.ts";

export interface AssistantContext {
  account_id?: string | null;
  program_id?: string | null;
  work_item_id?: string | null;
  signal_id?: string | null;
  deliverable_id?: string | null;
  route?: string | null;
}

export interface AssistantCitation {
  id: string;
  source_type: string;
  record_id: string;
  title: string;
  route: string;
  claim: string;
  claim_classification: "fact" | "derived" | "inference" | "missing" | "simulation";
  data_classification: string;
  relationship_status: string | null;
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

export function askAssistant(input: { message: string; conversation_id?: string | null; context?: AssistantContext }): Promise<AssistantAskResponse> {
  return backendJson<AssistantAskResponse>("/assistant/ask", {
    method: "POST",
    body: JSON.stringify(input),
  });
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
