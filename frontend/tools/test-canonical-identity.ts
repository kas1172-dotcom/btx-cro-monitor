import { buildArtifactSignals } from "../src/adapters/artifact/artifactSignals.ts";
import { PORTFOLIO_SIGNAL_SUBJECT_ID } from "../src/engine/signals/contract.ts";
import { analyze } from "../src/app/intelligence.ts";
import { resolveSignalRelationships, type ExtractedSignalEntity } from "../src/identity/canonicalAccounts.ts";
import type { Company } from "../src/engine/brain/entities.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function artifactRun(item: Record<string, unknown>): Record<string, unknown> {
  return {
    meta: { run_id: "identity", run_at: "2026-07-08T12:00:00Z" },
    items: [{
      item_id: "identity-item",
      raw_title: "Identity fixture item",
      title: "Identity fixture item",
      source_id: "Identity Fixture",
      published_at: "2026-07-08T10:00:00Z",
      per_edition: { bd: { relevance_score: 90, so_what: "", now_what: "", categories: ["Contract Award"] } },
      entities: [],
      ...item,
    }],
  };
}

const boeing: Company = {
  id: "hubspot-company-100",
  canonical_account_id: "hubspot-company-100",
  hubspot_company_id: "100",
  name: "The Boeing Company",
  relationship: "customer",
  account_status: "active_pipeline",
  business_motion: "grow_existing_business",
  location: { city: "Pittsburgh", state: "PA", lat: 40.44, lon: -79.99, country: "USA" },
  website_url: "https://boeing.com",
  domains: ["boeing.com"],
  aliases: ["Boeing", "Boeing Defense"],
  cage_code: "81205",
  uei: "BOEINGUEI1",
  known_programs: ["F-15EX Eagle II", "MUOS"],
  known_customers: ["U.S. Navy"],
  needs: ["AS9100", "precision machining"],
};

const acme: Company = {
  id: "hubspot-company-200",
  canonical_account_id: "hubspot-company-200",
  hubspot_company_id: "200",
  name: "Acme Precision",
  relationship: "target",
  account_status: "target_prospect",
  business_motion: "prospect_new_business",
  location: { city: "Pittsburgh", state: "PA", lat: 40.44, lon: -79.99, country: "USA" },
  website_url: "https://acme.example",
  domains: ["acme.example"],
  aliases: ["Acme"],
  known_programs: [],
  needs: ["machining"],
};

function linkedSignal(title: string, entityName: string): ReturnType<typeof buildArtifactSignals>["signals"][number] {
  return buildArtifactSignals(artifactRun({
    item_id: `linked-${entityName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    raw_title: title,
    per_edition: { bd: { relevance_score: 90, so_what: title, now_what: "Prepare account action.", categories: ["Contract Award"] } },
    entities: [{ name: entityName }],
  }), [boeing, acme]).signals[0];
}

for (const [title, entityName, expectedMethod] of [
  ["boeing.com receives F-15EX aircraft parts contract", "boeing.com", "exact_domain"],
  ["CAGE 81205 receives F-15EX aircraft parts contract", "81205", "cage_uei"],
  ["Boeing Defense receives aircraft parts contract", "Boeing Defense", "alias"],
  ["F-15EX Eagle II supplier demand is rising", "F-15EX Eagle II", "program"],
] as const) {
  const signal = linkedSignal(title, entityName);
  assert(signal.subject_id === "hubspot-company-100", `${expectedMethod} linked to ${signal.subject_id}`);
  assert(signal.scope === "specific_account", `${expectedMethod} should be specific_account`);
  assert(signal.relationships?.[0]?.match_method === expectedMethod, `${expectedMethod} produced ${signal.relationships?.[0]?.match_method}`);
  const score = analyze([boeing, acme], [signal]).byId.get("hubspot-company-100");
  assert((score?.dimensions.opportunity.score ?? 0) > 0, `${expectedMethod} did not contribute to Boeing score`);
}

const unrelated = buildArtifactSignals(artifactRun({
  item_id: "unrelated",
  raw_title: "Cloud software analytics award",
  per_edition: { bd: { relevance_score: 90, so_what: "A civilian analytics office awarded cloud software support.", now_what: "Monitor market context.", categories: ["Contract Award"] } },
  entities: [{ name: "Civilian Analytics Office" }],
}), [boeing, acme]).signals[0];
assert(unrelated.scope === "unlinked", `unrelated scope was ${unrelated.scope}`);
assert(unrelated.subject_id === PORTFOLIO_SIGNAL_SUBJECT_ID, `unrelated subject was ${unrelated.subject_id}`);
assert((unrelated.relationships ?? []).length === 0, "unrelated signal produced relationship evidence");
const baseline = analyze([boeing, acme], []);
const withUnrelated = analyze([boeing, acme], [unrelated]);
for (const score of baseline.scores) {
  const next = withUnrelated.byId.get(score.subject_id);
  assert(JSON.stringify(next?.dimensions) === JSON.stringify(score.dimensions), `unrelated signal changed ${score.subject_id}`);
}

const hybridSignal = linkedSignal("Boeing receives MUOS spacecraft platform work", "Boeing");
assert(hybridSignal.subject_id === "hubspot-company-100", "hybrid namespace did not resolve to HubSpot canonical id");
assert(hybridSignal.relationships?.[0]?.canonical_account_id === "hubspot-company-100", "hybrid relationship lost canonical id");

const weakEntity: ExtractedSignalEntity = {
  name: "Boreal Air",
  domains: [],
  programs: [],
  cage_codes: [],
  ueis: [],
  aliases: ["Boreal Air"],
};
const weak = resolveSignalRelationships([weakEntity], [{
  id: "hubspot-company-300",
  name: "Boeing Air",
  domains: [],
  aliases: ["Boeing"],
  facility_names: [],
  subsidiary_ids: [],
  known_programs: [],
  known_customers: [],
}], 0.72);
assert(weak.scope === "unlinked", `weak match should stay unlinked, got ${weak.scope}`);
assert(weak.relationships.length === 0, "weak match produced relationship evidence");

const unconfirmedIdentifier = resolveSignalRelationships([{
  name: "Unconfirmed Supplier",
  domains: [],
  programs: [],
  cage_codes: ["9ZZZ9"],
  ueis: [],
  aliases: [],
  unconfirmed_identifiers: ["cage:9ZZZ9"],
}], [{
  id: "hubspot-company-400",
  name: "Unconfirmed Supplier",
  domains: [],
  aliases: [],
  facility_names: [],
  subsidiary_ids: [],
  cage_code: "9ZZZ9",
  known_programs: [],
  known_customers: [],
}]);
assert(unconfirmedIdentifier.relationships[0]?.review_status === "unconfirmed", "unverified CAGE evidence was not flagged");

console.log("canonical identity ok: evidence links score, unrelated stays unlinked, HubSpot namespace bridges, weak match is rejected");
