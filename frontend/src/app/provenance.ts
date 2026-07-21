import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { Signal } from "../engine/signals/contract.ts";
import type { World } from "./useWorld.ts";

export type ProvenanceLabel = "CRM" | "Monitor" | "Seeded baseline";

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
  if (!record) return "Seeded baseline";
  const meta = record as ProvenanceRecord;
  if (meta.artifact) return "Monitor";
  const text = sourceName(meta);
  if (text.includes("hubspot") || text.includes("crm") || text.includes("live")) return "CRM";
  if (text.includes("monitor") || text.includes("artifact")) return "Monitor";
  return "Seeded baseline";
}

export function provenanceCounts(world: World): Array<{ label: ProvenanceLabel; count: number; detail: string }> {
  const crmIds = new Set([
    ...world.companies.filter((item) => provenanceForRecord(item) === "CRM").map((item) => item.id),
    ...world.contacts.filter((item) => provenanceForRecord(item) === "CRM").map((item) => item.id),
    ...world.opportunities.filter((item) => provenanceForRecord(item) === "CRM").map((item) => item.id),
  ]);
  const monitorIds = new Set(world.analysis.valid.filter((item) => provenanceForRecord(item) === "Monitor").map((item) => item.id));
  const seededIds = new Set([
    ...world.facilities.filter((item) => provenanceForRecord(item) === "Seeded baseline").map((item) => item.id),
    ...(world.snapshot?.capacity ?? []).map((item) => item.facility_id),
  ]);
  return [
    { label: "CRM", count: crmIds.size, detail: "real CRM" },
    { label: "Monitor", count: monitorIds.size, detail: "real signals" },
    { label: "Seeded baseline", count: seededIds.size, detail: "ERP pending" },
  ];
}

export function provenanceSummary(world: World): string {
  return provenanceCounts(world).map((item) => `${item.label} (${item.detail})`).join(", ");
}
