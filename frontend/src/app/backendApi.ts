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

export interface HubSpotLookupCompany {
  id: string;
  hubspot_id?: string;
  hubspot_company_id?: string;
  name: string;
  domains?: string[];
  location?: { city?: string; state?: string; country?: string };
  data_provenance?: string;
}

export interface HubSpotCompanySearchResponse {
  data_provenance: "HubSpot";
  records: HubSpotLookupCompany[];
}

export interface HubSpotListCreateResponse {
  status: "verified";
  duplicate: boolean;
  idempotency_key?: string | null;
  list: {
    id: string;
    name?: string;
    list_type: "company" | "contact";
    record_url: string;
    verified: boolean;
  };
}

export interface HubSpotListMembershipResponse {
  status: "verified";
  duplicate: boolean;
  idempotency_key?: string | null;
  list: {
    id: string;
    list_type: "company" | "contact";
    record_ids: string[];
    record_url: string;
    verified: boolean;
  };
}

export async function searchHubSpotCompanies(query: string, limit = 10): Promise<HubSpotCompanySearchResponse> {
  return backendJson<HubSpotCompanySearchResponse>("/crm/company-search", {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}

export async function createHubSpotList(input: {
  name: string;
  listType: "company" | "contact";
  idempotencyKey?: string;
}): Promise<HubSpotListCreateResponse> {
  return backendJson<HubSpotListCreateResponse>("/crm/lists", {
    method: "POST",
    headers: input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : undefined,
    body: JSON.stringify({ name: input.name, list_type: input.listType }),
  });
}

export async function addRecordsToHubSpotList(input: {
  listId: string;
  listType: "company" | "contact";
  recordIds: string[];
  idempotencyKey?: string;
}): Promise<HubSpotListMembershipResponse> {
  return backendJson<HubSpotListMembershipResponse>(`/crm/lists/${encodeURIComponent(input.listId)}/records`, {
    method: "PUT",
    headers: input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : undefined,
    body: JSON.stringify({ list_type: input.listType, record_ids: input.recordIds }),
  });
}

export interface HubSpotImportRowInput {
  row_id: string;
  company: Record<string, string>;
  contact?: Record<string, string>;
}

export interface HubSpotImportRowResult {
  row_id: string;
  status: "succeeded" | "partial" | "failed";
  company_id: string | null;
  contact_id: string | null;
  reason: string | null;
}

export interface HubSpotImportResponse {
  status: "completed";
  summary: { succeeded: number; partial: number; failed: number };
  rows: HubSpotImportRowResult[];
}

export async function importProspectsToHubSpot(rows: HubSpotImportRowInput[]): Promise<HubSpotImportResponse> {
  return backendJson<HubSpotImportResponse>("/crm/import/prospects", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
