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

export interface IndustryMonitorSource {
  id: string;
  name: string;
  publisher: string;
  domain: string;
  publicUrl: string;
  sourceType: "official_api" | "rss" | "government_feed" | "press_room" | "public_web";
  collectionMode: "live" | "snapshot" | "disabled";
  schedule: string;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  freshnessSlaHours: number;
  health: "healthy" | "degraded" | "failed" | "disabled";
  safeResultStatus: string;
  recordsDiscovered: number;
  recordsAccepted: number;
  duplicatesRejected: number;
  recordsRejectedIrrelevant: number;
  parsingFailures: number;
  sanitizedError?: string | null;
}

export interface IndustryUpdateRecord {
  id: string;
  canonicalUrl: string;
  sourceId: string;
  publisher: string;
  headline: string;
  normalizedSummary: string;
  eventDate?: string | null;
  publicationDate?: string | null;
  retrievedAt: string;
  contentFingerprint: string;
  entities: Array<{ name: string; type: string }>;
  programs: Array<{ name: string; type: string }>;
  markets: string[];
  capabilityTags: string[];
  relationshipState: "market_only" | "candidate_account_match" | "confirmed_account_development" | "rejected_match";
  evidenceClass: "public_source";
  relevanceScore: number;
  relevanceReasons: string[];
  reviewStatus: "new" | "reviewed" | "needs_account_match" | "promoted" | "dismissed";
  runId: string;
  sourceVariants: Array<{ publisher: string; headline: string; url: string }>;
  relationship?: { id: string; review_status: string; source_entity_name: string; canonical_account_id: string };
}

export interface IndustryMonitorResponse {
  state: "never_run" | "running" | "delayed" | "complete" | "partial_failure" | "failed" | "stale";
  ingestionMode: "live" | "stored_snapshot" | "seeded_demonstration" | "stale" | "failed";
  status: string;
  run: null | {
    id: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    version: string;
    lastAttemptAt: string | null;
    lastSuccessfulAt: string | null;
    expectedNextRun: string | null;
    latestRetrievedAt: string | null;
    counts: {
      sourcesChecked: number;
      newRecords: number;
      unchangedRecords: number;
      duplicatesRejected: number;
      irrelevantRecordsRejected: number;
      failedSources: number;
    };
  };
  sources: IndustryMonitorSource[];
  updates: IndustryUpdateRecord[];
}

export function getIndustryMonitor(): Promise<IndustryMonitorResponse> {
  return backendJson<IndustryMonitorResponse>("/industry-monitor");
}

export function reviewIndustryUpdate(
  id: string,
  action: "mark_reviewed" | "dismiss" | "needs_account_match",
  reason?: string,
): Promise<{ id: string; reviewStatus: IndustryUpdateRecord["reviewStatus"] }> {
  return backendJson(`/industry-monitor/updates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ action, reason }),
  });
}

export function createIndustryWorkItem(id: string): Promise<{ id: string; recommended_action: string }> {
  return backendJson(`/industry-monitor/updates/${encodeURIComponent(id)}/work-item`, { method: "POST" });
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
  company_record_url?: string | null;
  contact_record_url?: string | null;
  reason: string | null;
}

export interface HubSpotImportResponse {
  status: "completed";
  summary: { succeeded: number; partial: number; failed: number };
  rows: HubSpotImportRowResult[];
  idempotency_key?: string | null;
}

export async function importProspectsToHubSpot(rows: HubSpotImportRowInput[], idempotencyKey?: string): Promise<HubSpotImportResponse> {
  return backendJson<HubSpotImportResponse>("/crm/import/prospects", {
    method: "POST",
    headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : undefined,
    body: JSON.stringify({ rows }),
  });
}

export interface HubSpotTaskResponse {
  status: "created";
  id: string;
  record_url: string;
  title: string;
  duplicate?: boolean;
  idempotency_key?: string | null;
}

export async function createHubSpotTask(input: {
  title: string;
  body?: string;
  evidence?: string;
  dueAt?: string;
  priority?: string;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  idempotencyKey?: string;
}): Promise<HubSpotTaskResponse> {
  return backendJson<HubSpotTaskResponse>("/crm/task", {
    method: "POST",
    headers: input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : undefined,
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      evidence: input.evidence,
      due_at: input.dueAt,
      priority: input.priority,
      company_id: input.companyId,
      contact_id: input.contactId,
      deal_id: input.dealId,
    }),
  });
}
