import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { recordToDeliverable, type StoredDeliverable } from "../src/app/deliverablesApi.ts";
import { DELIVERABLE_TEMPLATE_OPTIONS } from "../src/agents/deliverableRegistry.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import { buildWizardPrefill, isAccountScopedSignal, validatePrefillProvenance } from "../src/deliverables/wizardPrefill.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function loadWorld(): Promise<World> {
  const adapter = new DemoDataAdapter();
  const [companies, rawSignals, contacts, facilities, opportunities, snapshot] = await Promise.all([
    adapter.getCompanies(),
    adapter.getSignals(),
    adapter.getContacts(),
    adapter.getFacilities(),
    adapter.getOpportunities(),
    adapter.getOperatingSnapshot(),
  ]);
  const newsSignals = deriveNewsSignals(companies, newsData as MarketEvent[], extractedData as ExtractedRow[]);
  const analysis = analyze(companies, [...rawSignals, ...newsSignals]);
  return {
    city: null,
    companies,
    contacts,
    facilities,
    opportunities,
    analysis,
    prospects: buildProspects(companies, contacts, analysis.valid, analysis.byId),
    snapshot,
    dataSource: null,
    loadErrors: [],
    dataMode: "demo",
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const world = await loadWorld();

// An account rich enough to exercise account-scoped prefill.
const richAccount = world.companies.find((company) =>
  world.contacts.some((contact) => contact.company_id === company.id) &&
  world.analysis.valid.some((signal) => signal.subject_id === company.id && isAccountScopedSignal(signal)),
);
assert(richAccount, "Demo data must contain an account with a contact and a validated signal.");

// 1. Every wizard template generates a valid deliverable from its prefill.
assert(DELIVERABLE_TEMPLATE_OPTIONS.length === 6, "Wizard must expose exactly the six templates.");
for (const option of DELIVERABLE_TEMPLATE_OPTIONS) {
  const prefill = buildWizardPrefill(option.id, world, option.requiresAccount ? richAccount!.id : undefined);
  const violations = validatePrefillProvenance(prefill.fields);
  assert(violations.length === 0, `${option.id} prefill provenance violations: ${violations.join("; ")}`);
  const deliverable = await runAgent(option.id, prefill.inputs, world);
  assert(deliverable.sections.length > 0, `${option.id} produced no sections.`);
  assert(deliverable.sources.length > 0, `${option.id} produced no provenance sources.`);
  assert(["low", "medium", "high"].includes(deliverable.confidence), `${option.id} has no confidence rating.`);
}

// 2. Account-scoped prefill fields must be backed by real records with source and confidence.
const richPrefill = buildWizardPrefill("meeting_brief", world, richAccount!.id);
const accountFields = richPrefill.fields.filter((field) => field.scope === "account");
assert(accountFields.length >= 2, "Rich account should prefill multiple account-scoped fields.");
for (const field of accountFields) {
  assert(field.source && field.source !== "Market-level default", `Account field ${field.field} lacks a real source.`);
  assert(field.confidence !== null, `Account field ${field.field} lacks confidence.`);
}
const evidenceField = richPrefill.fields.find((field) => field.field === "evidence");
assert(evidenceField && evidenceField.scope === "account", "Rich account must surface signal-backed evidence.");
assert((evidenceField!.confidence ?? 0) > 0, "Signal-backed evidence must carry the signal confidence.");

// 3. An account with no evidence gets market-level labels — never fabricated facts.
const bareAccount = world.companies.find((company) =>
  !world.contacts.some((contact) => contact.company_id === company.id) &&
  !world.analysis.valid.some((signal) => signal.subject_id === company.id),
);
if (bareAccount) {
  const barePrefill = buildWizardPrefill("capabilities_assessment", world, bareAccount.id);
  assert(!barePrefill.fields.some((field) => field.field === "contact"), "No contact record means no contact field — never invented.");
  const bareEvidence = barePrefill.fields.find((field) => field.field === "evidence");
  assert(bareEvidence?.scope === "market", "Unsourced evidence must be labeled market-level.");
  assert(validatePrefillProvenance(barePrefill.fields).length === 0, "Market-labeled fields are conformant.");
}

// An unknown account id prefills nothing account-scoped at all.
const unknownPrefill = buildWizardPrefill("meeting_brief", world, "no-such-account");
assert(unknownPrefill.fields.every((field) => field.scope !== "account"), "Unknown accounts must not yield account facts.");

// 4. The provenance validator actually rejects a fabricated account claim.
const fabricated = validatePrefillProvenance([
  { field: "contact", label: "Primary contact", value: "Made Up (CEO)", scope: "account", source: "Market-level default", method: "market_default", confidence: null },
]);
assert(fabricated.length > 0, "Validator must reject unsourced account claims.");

// 5. Canonical-record round trip preserves multi-account linkage.
const generated = await runAgent("capabilities_assessment", buildWizardPrefill("capabilities_assessment", world, richAccount!.id).inputs, world);
generated.entityIds = [richAccount!.id, "hubspot-company-secondary"];
const stored: StoredDeliverable = {
  id: "record-32-char-id",
  type: generated.type,
  title: generated.title,
  canonical_account_id: richAccount!.id,
  program_id: null,
  trip_id: null,
  entity_ids: generated.entityIds,
  document: { ...generated, entityIds: [] },
  created_at: generated.createdAt,
  updated_at: generated.createdAt,
};
const roundTripped = recordToDeliverable(stored);
assert(roundTripped.entityIds.join(",") === `${richAccount!.id},hubspot-company-secondary`, "entity_ids column must round-trip to entityIds.");
assert(roundTripped.backendRecordId === "record-32-char-id", "Round trip must keep the backend record id.");
assert(roundTripped.canonicalAccountId === richAccount!.id, "Round trip must keep the canonical account id.");

console.log(`deliverable wizard ok: ${DELIVERABLE_TEMPLATE_OPTIONS.length} templates generate with enforced provenance; entity_ids round-trips`);
