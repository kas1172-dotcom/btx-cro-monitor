import { BACKEND_ENDPOINT, backendJson } from "./backendApi.ts";
import type { Deliverable, DeliverableType } from "../deliverables/types.ts";

export interface StoredDeliverable {
  id: string;
  type: DeliverableType;
  title: string;
  canonical_account_id: string | null;
  program_id: string | null;
  trip_id: string | null;
  document: Deliverable;
  created_at: string;
  updated_at: string;
}

interface DeliverableListResponse {
  records: StoredDeliverable[];
}

export function hasDeliverablesBackend(): boolean {
  return Boolean(BACKEND_ENDPOINT);
}

export function recordToDeliverable(record: StoredDeliverable): Deliverable {
  return {
    ...record.document,
    id: record.document.id || record.id,
    backendRecordId: record.id,
    type: record.type,
    title: record.title,
    createdAt: record.document.createdAt || record.created_at,
    canonicalAccountId: record.canonical_account_id,
    programId: record.program_id,
    tripId: record.trip_id,
  };
}

export function deliverableAccountId(deliverable: Deliverable): string | null {
  return deliverable.canonicalAccountId ?? deliverable.entityIds[0] ?? null;
}

function documentForBackend(deliverable: Deliverable): Deliverable {
  const { backendRecordId: _backendRecordId, ...document } = deliverable;
  return document;
}

export async function listStoredDeliverables(): Promise<StoredDeliverable[]> {
  const response = await backendJson<DeliverableListResponse>("/deliverables");
  return response.records;
}

export async function getStoredDeliverable(id: string): Promise<StoredDeliverable> {
  return backendJson<StoredDeliverable>(`/deliverables/${encodeURIComponent(id)}`);
}

export async function createStoredDeliverable(deliverable: Deliverable): Promise<StoredDeliverable> {
  return backendJson<StoredDeliverable>("/deliverables", {
    method: "POST",
    body: JSON.stringify({
      type: deliverable.type,
      title: deliverable.title,
      canonical_account_id: deliverable.canonicalAccountId ?? deliverable.entityIds[0] ?? null,
      program_id: deliverable.programId ?? null,
      trip_id: deliverable.tripId ?? null,
      document: documentForBackend(deliverable),
    }),
  });
}

export async function patchStoredDeliverable(recordId: string, deliverable: Deliverable): Promise<StoredDeliverable> {
  return backendJson<StoredDeliverable>(`/deliverables/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      type: deliverable.type,
      title: deliverable.title,
      canonical_account_id: deliverable.canonicalAccountId ?? deliverable.entityIds[0] ?? null,
      program_id: deliverable.programId ?? null,
      trip_id: deliverable.tripId ?? null,
      document: documentForBackend(deliverable),
    }),
  });
}

export async function saveStoredDeliverable(deliverable: Deliverable): Promise<StoredDeliverable> {
  if (deliverable.backendRecordId) return patchStoredDeliverable(deliverable.backendRecordId, deliverable);
  return createStoredDeliverable(deliverable);
}
