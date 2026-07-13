import { backendJson } from "./backendApi.ts";
import type { Deliverable } from "../deliverables/types.ts";

export const PROSPECT_GENERATION_RECORD_TYPE = "prospect_generation_state";

export interface BackendDeliverableRecord<TDocument = Deliverable> {
  id: string;
  type: string;
  title: string;
  canonical_account_id: string | null;
  entity_ids: string[];
  document: TDocument;
  created_at: string;
  updated_at: string;
}

export function createDeliverableRecord(deliverable: Deliverable): Promise<BackendDeliverableRecord> {
  return backendJson<BackendDeliverableRecord>("/deliverables", {
    method: "POST",
    body: JSON.stringify({
      id: deliverable.id,
      type: deliverable.type,
      title: deliverable.title,
      canonical_account_id: deliverable.entityIds[0] ?? null,
      entity_ids: deliverable.entityIds,
      document: deliverable,
    }),
  });
}

export function listDeliverableRecords<TDocument = Deliverable>(
  filters: { account?: string; type?: string } = {},
): Promise<{ records: Array<BackendDeliverableRecord<TDocument>> }> {
  const params = new URLSearchParams();
  if (filters.account) params.set("account", filters.account);
  if (filters.type) params.set("type", filters.type);
  const query = params.toString();
  return backendJson<{ records: Array<BackendDeliverableRecord<TDocument>> }>(`/deliverables${query ? `?${query}` : ""}`);
}

export function patchDeliverableRecord(
  id: string,
  patch: { title?: string; entity_ids?: string[]; document?: unknown },
): Promise<BackendDeliverableRecord> {
  return backendJson<BackendDeliverableRecord>(`/deliverables/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function createProgramMemoryRecord<TDocument>(payload: {
  id: string;
  type: string;
  title: string;
  canonical_account_id: string | null;
  entity_ids: string[];
  document: TDocument;
}): Promise<BackendDeliverableRecord<TDocument>> {
  return backendJson<BackendDeliverableRecord<TDocument>>("/deliverables", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
