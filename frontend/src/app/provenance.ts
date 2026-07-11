import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { Signal } from "../engine/signals/contract.ts";
import type { World } from "./useWorld.ts";

export type ProvenanceLabel = "HubSpot" | "Monitor" | "Demo";

type ProvenanceRecord = {
  data_provenance?: string;
  source_name?: string;
  source_mode?: string;
  artifact?: unknown;
};

function sourceName(record: ProvenanceRecord): string {
  return `${record.data_provenance ?? ""} ${record.source_name ?? ""} ${record.source_mode ?? ""}`.toLowerCase();
}

export function provenanceForRecord(record: Company | Contact | Facility | Opportunity | Signal | null | undefined): ProvenanceLabel {
  if (!record) return "Demo";
  const meta = record as ProvenanceRecord;
  if (meta.artifact) return "Monitor";
  const text = sourceName(meta);
  if (text.includes("hubspot") || text.includes("live")) return "HubSpot";
  if (text.includes("monitor") || text.includes("artifact")) return "Monitor";
  return "Demo";
}

export function provenanceCounts(world: World): Array<{ label: ProvenanceLabel; count: number; detail: string }> {
  const hubspotIds = new Set([
    ...world.companies.filter((item) => provenanceForRecord(item) === "HubSpot").map((item) => item.id),
    ...world.contacts.filter((item) => provenanceForRecord(item) === "HubSpot").map((item) => item.id),
    ...world.opportunities.filter((item) => provenanceForRecord(item) === "HubSpot").map((item) => item.id),
  ]);
  const monitorIds = new Set(world.analysis.valid.filter((item) => provenanceForRecord(item) === "Monitor").map((item) => item.id));
  const demoIds = new Set([
    ...world.facilities.filter((item) => provenanceForRecord(item) === "Demo").map((item) => item.id),
    ...(world.snapshot?.capacity ?? []).map((item) => item.facility_id),
  ]);
  return [
    { label: "HubSpot", count: hubspotIds.size, detail: "real CRM" },
    { label: "Monitor", count: monitorIds.size, detail: "real signals" },
    { label: "Demo", count: demoIds.size, detail: "fallback" },
  ];
}

export function provenanceSummary(world: World): string {
  return provenanceCounts(world).map((item) => `${item.label} (${item.detail})`).join(", ");
}
