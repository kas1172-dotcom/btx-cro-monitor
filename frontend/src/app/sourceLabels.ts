import type { Deliverable, ProvenanceEntry } from "../deliverables/types.ts";
import { displayLabel } from "./displayLabels.ts";

const SOURCE_LABELS: Record<string, string> = {
  "companies.json": "HubSpot CRM",
  "contacts.json": "HubSpot CRM",
  "opportunities.json": "HubSpot CRM",
  "signals.json + news.json": "Monitor engine + public sources",
  "monitor-engine artifacts": "Monitor engine",
  "Monitor engine evidence": "Monitor engine",
  "erp_capacity.json": "ERP capacity context",
  "account_monthly_revenue.json": "Revenue context",
  "bookings_backlog.json": "Bookings and backlog context",
  "pipeline_snapshots.json": "Pipeline context",
  "win_loss_history.json": "Win/loss context",
  "capacity_utilization.json": "Capacity context",
  "scoring trace": "Scoring trace",
  "user edits": "User edits",
};

const RECORD_LABELS: Record<string, string> = {
  capacity: "Capacity context",
  operating_baseline: "Production context",
};

export function humanSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/\.json\b/g, "").replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function humanSourceReason(reason: string): string {
  return reason
    .replace(/\bseeded baseline\b/gi, "production context")
    .replace(/\bseeded\b/gi, "source")
    .replace(/\bmonitor-engine\b/g, "monitor engine")
    .replace(/\bartifacts?\b/gi, "documents")
    .replace(/\bprovenance\b/gi, "source record")
    .replace(/\bcompanies\.json\b/g, "HubSpot CRM")
    .replace(/\bcontacts\.json\b/g, "HubSpot CRM")
    .replace(/\bopportunities\.json\b/g, "HubSpot CRM")
    .replace(/\berp_capacity\.json\b/g, "ERP capacity context")
    .replace(/\bsignals\.json \+ news\.json\b/g, "monitor engine and public sources");
}

export function humanRecordSummary(records: string[]): string {
  if (records.length === 0) return "No linked records";
  const named = records.map((record) => RECORD_LABELS[record]).filter((record): record is string => Boolean(record));
  if (named.length === records.length) return named.join(", ");
  return `${records.length} linked record${records.length === 1 ? "" : "s"}`;
}

export function visibleSources(sources: ProvenanceEntry[]): Array<{ label: string; reason: string; records: string }> {
  return sources
    .filter((source) => source.source !== "composition path")
    .map((source) => ({
      label: humanSourceLabel(source.source),
      reason: humanSourceReason(source.reason),
      records: humanRecordSummary(source.records),
    }));
}

export function deliverableMetaLabel(deliverable: Deliverable): string {
  const audience = deliverable.audience ? displayLabel(deliverable.audience) : "Internal";
  const form = deliverable.form ? displayLabel(deliverable.form) : displayLabel(deliverable.type);
  return `${audience} ${form} - ${deliverable.confidence} confidence`;
}
