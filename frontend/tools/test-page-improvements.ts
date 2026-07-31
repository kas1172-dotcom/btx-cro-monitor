import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const industry = read("src/ui/intelligence/IndustryUpdates.tsx");
const prospects = read("src/ui/surfaces/Prospecting.tsx");
const capacity = read("src/ui/surfaces/CapacityAssessment.tsx");
const analysis = read("src/ui/surfaces/AnalysisDashboard.tsx");
const map = read("src/ui/map/ProspectMap.tsx");

assert(industry.includes("Record retrieved") && industry.includes("Last successful run"), "Industry freshness labels must expose explicit run and record dates.");
assert(industry.includes("New since"), "Industry filters must define New since the relevant run.");
assert(industry.includes("wordBoundary") && industry.includes("…"), "Industry summaries must truncate at word boundaries with ellipses.");
assert(industry.includes("uniqueReasons"), "Industry relevance reasons must remove duplicated summaries.");
assert(industry.includes("Undo will restore the prior backend review status") && industry.includes("restore_previous") && industry.includes("undoLastReview"), "Industry review mutations need reversible backend feedback.");

assert(prospects.includes("Not scored"), "Prospects must distinguish not scored from a real zero score.");
assert(prospects.includes("nextBestAction") && prospects.includes("Next best action"), "Prospects must establish one next-best action.");
assert(prospects.includes("No pipeline value available"), "Prospects empty/partial revenue state should be explicit.");

assert(capacity.includes("canonicalMetrics") && capacity.includes("crm_synced_accounts"), "Capacity must use the canonical CRM/account metric.");
assert(capacity.includes("capacity-mobile-context") && capacity.includes("Mobile and desktop views use the same context"), "Capacity mobile view must retain desktop context.");

assert(analysis.includes("Partial analysis data"), "Analysis must show partial-data state when some metrics are unavailable.");
assert(analysis.includes("Precise figures and concentration conclusions are suppressed"), "Analysis must enforce missing-data suppression.");
assert(analysis.includes("unavailableMetrics"), "Analysis must apply the shared unavailable/stale/error metric contract.");

assert(map.includes("No accounts have coordinates yet"), "Map must reduce the empty map when no coordinates exist.");
assert(map.includes("Coordinate remediation workflow"), "Map must provide obvious coordinate remediation.");
assert(map.includes("omitted: missing coordinates") && map.includes("mappedMetric"), "Map must label omitted and mapped account counts canonically.");
assert(!map.includes('<button\\n              key={p.company.id}'), "Map prospect rail must not use nested interactive row buttons.");
assert(map.includes("Show on map"), "Map rail needs a separate navigation/action button.");

console.log("Page improvement checks passed.");
