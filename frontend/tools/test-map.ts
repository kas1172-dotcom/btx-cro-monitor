import { buildMapMarkers, mappableCompanies, mapCenter } from "../src/ui/map/mapModel.ts";
import { SCORE_DIMENSIONS, type ScoreDimension } from "../src/engine/signals/contract.ts";
import type { Company } from "../src/engine/brain/entities.ts";
import type { CompanyScore, DimensionScore } from "../src/engine/decision/score.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function dimensions(opportunity: number): Record<ScoreDimension, DimensionScore> {
  const out = {} as Record<ScoreDimension, DimensionScore>;
  for (const dimension of SCORE_DIMENSIONS) {
    out[dimension] = {
      dimension,
      score: dimension === "opportunity" ? opportunity : 0,
      raw: dimension === "opportunity" ? opportunity : 0,
      contributions: [],
    };
  }
  return out;
}

function score(subject_id: string, opportunity: number): CompanyScore {
  return {
    subject_id,
    weights_version: "test",
    signal_count: opportunity > 0 ? 1 : 0,
    dimensions: dimensions(opportunity),
  };
}

const companies: Company[] = [
  {
    id: "canonical-live-1",
    name: "Mapped Live Account",
    relationship: "target",
    location: { city: "Pittsburgh", lat: 40.44, lon: -79.99 },
    needs: [],
  },
  {
    id: "canonical-live-2",
    name: "Canonical Coordinate Account",
    relationship: "customer",
    location: { city: "Pittsburgh", lat: Number.NaN, lon: Number.NaN },
    canonical_location: { lat: 40.46, lon: -79.98 },
    needs: [],
  },
  {
    id: "canonical-live-3",
    name: "Missing Coordinate Account",
    relationship: "target",
    location: { city: "Pittsburgh", lat: Number.NaN, lon: -79.97 },
    needs: [],
  },
  {
    id: "canonical-live-4",
    name: "Supplier Pin",
    relationship: "supplier",
    location: { city: "Pittsburgh", lat: 40.42, lon: -80.01 },
    needs: [],
  },
];

const byId = new Map([
  ["canonical-live-1", score("canonical-live-1", 12)],
  ["canonical-live-2", score("canonical-live-2", 96)],
  ["canonical-live-4", score("canonical-live-4", 80)],
]);

const points = mappableCompanies(companies);
const markers = buildMapMarkers(companies, byId);
const center = mapCenter(points);

assert(points.length === 3, `expected 3 mappable companies, got ${points.length}`);
assert(markers.length === 3, `expected 3 markers, got ${markers.length}`);
assert(markers.every((marker) => Number.isFinite(marker.center[0]) && Number.isFinite(marker.center[1])), "marker included non-finite coordinates");
assert(Number.isFinite(center[0]) && Number.isFinite(center[1]), "center included non-finite coordinates");

const small = markers.find((marker) => marker.company.id === "canonical-live-1");
const large = markers.find((marker) => marker.company.id === "canonical-live-2");
const supplier = markers.find((marker) => marker.company.id === "canonical-live-4");

assert(Boolean(small && large && supplier), "expected all valid markers to be present");
assert((large?.radius ?? 0) > (small?.radius ?? 0), `prospect radius did not scale by opportunity (${small?.radius} vs ${large?.radius})`);
assert(supplier?.radius === 5, `non-prospect radius should stay fixed at 5, got ${supplier?.radius}`);

console.log("map ok: mixed coordinates filtered, canonical fallback used, opportunity radius scales");
