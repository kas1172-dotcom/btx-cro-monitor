import type { ProvenanceLabel } from "../../app/provenance.ts";

export function ProvenanceBadge({ label }: { label: ProvenanceLabel }) {
  return <span className={`provenance-badge prov-${label.toLowerCase()}`}>{label}</span>;
}
