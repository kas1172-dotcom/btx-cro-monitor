import {
  createProgramMemoryRecord,
  listDeliverableRecords,
  patchDeliverableRecord,
  PROSPECT_GENERATION_RECORD_TYPE,
} from "./deliverablesApi.ts";

interface ProspectGenerationDocument {
  kind: "prospect_generation_state";
  prospect_id: string;
  has_generated: boolean;
  updated_at: string;
}

const STORAGE_KEY = "btx.prospecting.generated.v1";

function recordId(prospectId: string): string {
  return `prospect-generated-${prospectId}`.slice(0, 120);
}

function now(): string {
  return new Date().toISOString();
}

function markerDocument(prospectId: string): ProspectGenerationDocument {
  return {
    kind: "prospect_generation_state",
    prospect_id: prospectId,
    has_generated: true,
    updated_at: now(),
  };
}

function localSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveLocal(set: Set<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function localProspectGenerated(prospectId: string): boolean {
  return localSet().has(prospectId);
}

export async function prospectHasGenerated(prospectId: string): Promise<boolean> {
  if (localProspectGenerated(prospectId)) return true;
  try {
    const result = await listDeliverableRecords<ProspectGenerationDocument>({
      account: prospectId,
      type: PROSPECT_GENERATION_RECORD_TYPE,
    });
    const hasGenerated = result.records.some((record) => record.document.has_generated === true);
    if (hasGenerated) {
      const next = localSet();
      next.add(prospectId);
      saveLocal(next);
    }
    return hasGenerated;
  } catch {
    return false;
  }
}

export async function markProspectGenerated(prospectId: string): Promise<void> {
  const next = localSet();
  next.add(prospectId);
  saveLocal(next);

  const document = markerDocument(prospectId);
  try {
    const existing = await listDeliverableRecords<ProspectGenerationDocument>({
      account: prospectId,
      type: PROSPECT_GENERATION_RECORD_TYPE,
    });
    const current = existing.records[0];
    if (current) {
      await patchDeliverableRecord(current.id, { document });
      return;
    }
    await createProgramMemoryRecord({
      id: recordId(prospectId),
      type: PROSPECT_GENERATION_RECORD_TYPE,
      title: `Prospecting actions generated for ${prospectId}`,
      canonical_account_id: prospectId,
      entity_ids: [prospectId],
      document,
    });
  } catch {
    // Local persistence still preserves demo-mode refresh behavior when the backend is unavailable.
  }
}
