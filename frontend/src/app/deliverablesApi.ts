import { backendJson } from "./backendApi.ts";
import type { Deliverable } from "../deliverables/types.ts";

export interface BackendDeliverableRecord {
  id: string;
  type: string;
  title: string;
  canonical_account_id: string | null;
  entity_ids: string[];
  document: Deliverable;
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

export function listDeliverableRecords(): Promise<{ records: BackendDeliverableRecord[] }> {
  return backendJson<{ records: BackendDeliverableRecord[] }>("/deliverables");
}

export function patchDeliverableRecord(
  id: string,
  patch: { title?: string; entity_ids?: string[]; document?: Deliverable },
): Promise<BackendDeliverableRecord> {
  return backendJson<BackendDeliverableRecord>(`/deliverables/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
