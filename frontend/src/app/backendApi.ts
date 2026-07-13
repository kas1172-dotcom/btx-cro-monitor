const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const BACKEND_ENDPOINT = env?.VITE_BACKEND_ENDPOINT ?? processEnv?.VITE_BACKEND_ENDPOINT;

/** Minimal shape of the global Clerk singleton once ClerkProvider has mounted. */
interface ClerkGlobal {
  session?: { getToken(): Promise<string | null> } | null;
}

async function clerkSessionToken(): Promise<string | null> {
  const clerk = (globalThis as { Clerk?: ClerkGlobal }).Clerk;
  if (!clerk?.session) return null;
  try {
    return await clerk.session.getToken();
  } catch {
    return null;
  }
}

export async function backendHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await clerkSessionToken();
  return {
    ...extra,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function backendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BACKEND_ENDPOINT) throw new Error("VITE_BACKEND_ENDPOINT is not configured.");
  const headers = await backendHeaders({ ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) });
  const response = await fetch(`${BACKEND_ENDPOINT}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Backend ${path} failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

export interface BackendDeliverableRecord {
  id: string;
  type: string;
  title: string;
  canonical_account_id?: string | null;
  program_id?: string | null;
  trip_id?: string | null;
  document: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BackendDeliverableTemplate {
  agent_id: string;
  label: string;
  enabled: boolean;
  order: number;
  prompt_override?: string | null;
  updated_at: string;
}

export interface BackendIntegrationRequest {
  id: string;
  requester_name: string;
  integration_name: string;
  notes?: string | null;
  status: "pending" | "reviewed" | "dismissed";
  created_at: string;
  updated_at: string;
}

export async function listBackendDeliverables(): Promise<BackendDeliverableRecord[]> {
  const response = await backendJson<{ records: BackendDeliverableRecord[] }>("/deliverables");
  return response.records;
}

export async function upsertBackendDeliverable(input: {
  id: string;
  type: string;
  title: string;
  canonical_account_id?: string | null;
  program_id?: string | null;
  trip_id?: string | null;
  document: Record<string, unknown>;
}): Promise<BackendDeliverableRecord> {
  return backendJson<BackendDeliverableRecord>("/deliverables", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listBackendDeliverableTemplates(): Promise<BackendDeliverableTemplate[]> {
  const response = await backendJson<{ records: BackendDeliverableTemplate[] }>("/deliverable-templates");
  return response.records;
}

export async function patchBackendDeliverableTemplate(
  agentId: string,
  patch: Partial<Pick<BackendDeliverableTemplate, "label" | "enabled" | "order" | "prompt_override">>,
): Promise<BackendDeliverableTemplate> {
  return backendJson<BackendDeliverableTemplate>(`/deliverable-templates/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function listBackendIntegrationRequests(): Promise<BackendIntegrationRequest[]> {
  const response = await backendJson<{ records: BackendIntegrationRequest[] }>("/integration-requests");
  return response.records;
}

export async function createBackendIntegrationRequest(input: {
  requester_name: string;
  integration_name: string;
  notes?: string | null;
}): Promise<BackendIntegrationRequest> {
  return backendJson<BackendIntegrationRequest>("/integration-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
