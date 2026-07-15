import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import referenceData from "../../clients/btx/data/defense_primes_enrichment.json";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = join(FRONTEND_DIR, "..");
const confirmed = process.argv.includes("--confirm");

interface TokenSource {
  value: string;
  name: "HUBSPOT_ACCESS_TOKEN" | "BTX_HUBSPOT_ACCESS_TOKEN";
}

function readEnvTokenFromFile(path: string): TokenSource | undefined {
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const match = /^\s*(?:export\s+)?(HUBSPOT_ACCESS_TOKEN|BTX_HUBSPOT_ACCESS_TOKEN)\s*=\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    return {
      name: match[1] as TokenSource["name"],
      value: match[2].replace(/^['"]|['"]$/g, ""),
    };
  }
  return undefined;
}

function resolveToken(): TokenSource | undefined {
  if (process.env.HUBSPOT_ACCESS_TOKEN) return { name: "HUBSPOT_ACCESS_TOKEN", value: process.env.HUBSPOT_ACCESS_TOKEN };
  if (process.env.BTX_HUBSPOT_ACCESS_TOKEN) return { name: "BTX_HUBSPOT_ACCESS_TOKEN", value: process.env.BTX_HUBSPOT_ACCESS_TOKEN };
  return readEnvTokenFromFile(join(FRONTEND_DIR, ".env.local"))
    ?? readEnvTokenFromFile(join(FRONTEND_DIR, ".env"))
    ?? readEnvTokenFromFile(join(REPO_DIR, ".env.local"))
    ?? readEnvTokenFromFile(join(REPO_DIR, ".env"));
}

const tokenSource = resolveToken();
const token = tokenSource?.value;

type CrmObjectType = "companies" | "contacts" | "deals";
type AssociationObjectType = "companies" | "contacts" | "deals";
type PropertyValue = string | number | boolean;

interface CompanyRow {
  id: string;
  name: string;
  relationship: string;
  account_status?: string;
  location: { city: string; state?: string; address?: string; postal_code?: string };
  domain?: string;
  website_url?: string;
  aliases?: string[];
  facility_names?: string[];
  cage_code?: string;
  uei?: string;
  known_programs?: string[];
  known_customers?: string[];
  notes?: string[];
}

interface ContactRow {
  id: string;
  company_id: string;
  name: string;
  title: string;
  email?: string;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  name: string;
  value: number;
  stage: string;
  close_date: string;
}

interface BatchUpsertInput {
  id: string;
  idProperty?: string;
  objectWriteTraceId: string;
  properties: Record<string, PropertyValue>;
}

interface BatchUpsertResult {
  id: string;
  new?: boolean;
  objectWriteTraceId?: string;
}

interface BatchUpsertResponse {
  results?: BatchUpsertResult[];
  errors?: Array<{ message?: string; context?: Record<string, unknown> }>;
  numErrors?: number;
}

interface UpsertSummary {
  created: number;
  updated: number;
  idByTraceId: Map<string, string>;
}

interface AssociationPair {
  fromId: string;
  toId: string;
}

interface AssociationReadResponse {
  results?: Array<{
    from: { id: string };
    to?: Array<{ toObjectId: string | number }>;
  }>;
}

interface CrmObject {
  id: string;
  properties: Record<string, string | null | undefined>;
}

interface SearchResponse {
  results?: CrmObject[];
  paging?: { next?: { after?: string } };
}

interface DealPipelineResponse {
  results?: Array<{
    id: string;
    stages?: Array<{
      id: string;
      metadata?: {
        probability?: string;
        isClosed?: string;
      };
    }>;
  }>;
}

class HubspotError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`HubSpot ${path} failed ${status}: ${body}`);
  }
}

function logSkip(): void {
  console.log("HubSpot seed skipped: set HUBSPOT_ACCESS_TOKEN or BTX_HUBSPOT_ACCESS_TOKEN to seed the sandbox portal.");
}

async function hubspot<T>(path: string, body: unknown, options: { allowConflict?: boolean } = {}): Promise<T | undefined> {
  if (!token) return undefined;
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status === 409 && options.allowConflict) return undefined;
  if (!response.ok) {
    throw new HubspotError(path, response.status, text);
  }
  return text ? (JSON.parse(text) as T) : undefined;
}

async function hubspotGet<T>(path: string): Promise<T | undefined> {
  if (!token) return undefined;
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HubspotError(path, response.status, text);
  }
  return text ? (JSON.parse(text) as T) : undefined;
}

async function searchAll(objectType: CrmObjectType, properties: string[]): Promise<CrmObject[]> {
  const rows: CrmObject[] = [];
  let after: string | undefined;
  do {
    const response = await hubspot<SearchResponse>(`/crm/v3/objects/${objectType}/search`, {
      limit: 100,
      properties,
      sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
      ...(after ? { after } : {}),
    });
    rows.push(...(response?.results ?? []));
    after = response?.paging?.next?.after;
  } while (after);
  return rows;
}

function cleanProperties(properties: Record<string, PropertyValue | undefined>): Record<string, PropertyValue> {
  return Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, PropertyValue] => entry[1] !== undefined));
}

function traceId(objectType: CrmObjectType, id: string): string {
  return `btx-${objectType}-${id}`;
}

function worldCompanyDomain(company: CompanyRow): string {
  return company.domain ?? company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/u, "") ?? `${company.id}.example`;
}

function splitName(name: string): { firstname: string; lastname: string } {
  const [firstname, ...rest] = name.trim().split(/\s+/u);
  return { firstname: firstname ?? "", lastname: rest.join(" ") };
}

function emailLocalPart(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function deterministicEmail(contact: ContactRow): string {
  return contact.email ?? `${emailLocalPart(contact.name)}@${contact.company_id}.example.com`;
}

type ReferencePayload = {
  accounts?: Array<{
    id?: string;
    name?: string;
    aliases?: string[];
    domains?: string[];
    hq?: string;
    subsidiaries?: string[];
    cage_codes?: Array<{ code?: string | null; verified?: boolean }>;
    uei?: Array<{ value?: string | null; verified?: boolean }>;
    known_programs?: string[];
  }>;
};

function lockheedReference(): NonNullable<ReferencePayload["accounts"]>[number] {
  const account = (referenceData as ReferencePayload).accounts?.find((entry) => entry.id === "prime-lockheed-martin");
  if (!account) throw new Error("Missing Lockheed Martin reference data.");
  return account;
}

function verifiedIdentifier<T extends { verified?: boolean }>(items: T[] | undefined, pick: (item: T) => string | null | undefined, preferred?: string): string {
  const verified = (items ?? []).filter((item) => item.verified === true);
  const preferredMatch = verified.find((item) => pick(item) === preferred);
  const value = pick(preferredMatch ?? verified[0]);
  if (!value) throw new Error(`Missing verified identifier${preferred ? ` ${preferred}` : ""}.`);
  return value;
}

const lockheed = lockheedReference();

const companyRows: CompanyRow[] = [{
  id: "lockheed-martin-corporation",
  name: "Lockheed Martin Corporation",
  relationship: "existing customer",
  account_status: "active_pipeline",
  location: { city: "Bethesda", state: "MD", address: "6801 Rockledge Dr", postal_code: "20817" },
  domain: "lockheedmartin.com",
  website_url: "https://www.lockheedmartin.com",
  aliases: lockheed.aliases ?? ["Lockheed Martin", "Lockheed"],
  facility_names: ["Lockheed Martin Aeronautics", "Fort Worth Aeronautics"],
  cage_code: verifiedIdentifier(lockheed.cage_codes, (item) => item.code, "81755"),
  uei: verifiedIdentifier(lockheed.uei, (item) => item.value, "CQWLW9XRQTH5"),
  known_programs: ["F-35 Lightning II", "F-22 Raptor", "C-130J Super Hercules"],
  known_customers: ["US Department of Defense", "US Air Force", "US Navy"],
  notes: [
    "BTX relationship centers on build-to-print precision components for aircraft production and sustainment programs.",
    "Account owner should lead with F-35 timing, inspection capacity, and AS9100 controlled process fit.",
  ],
}];

const contactRows: ContactRow[] = [
  {
    id: "lockheed-supply-chain-lead",
    company_id: "lockheed-martin-corporation",
    name: "Jamie Carter",
    title: "Supply Chain Lead, Aeronautics",
    email: "jamie.carter.lockheed-demo@example.com",
  },
  {
    id: "lockheed-procurement-manager",
    company_id: "lockheed-martin-corporation",
    name: "Morgan Ellis",
    title: "Procurement Manager, F-35 Sustainment",
    email: "morgan.ellis.lockheed-demo@example.com",
  },
];

const opportunityRows: OpportunityRow[] = [
  {
    id: "lockheed-f35-build-to-print",
    company_id: "lockheed-martin-corporation",
    name: "F-35 sustainment build-to-print components",
    value: 1850000,
    stage: "proposal",
    close_date: "2026-09-30",
  },
  {
    id: "lockheed-aero-fixture-assemblies",
    company_id: "lockheed-martin-corporation",
    name: "Aeronautics fixture and small assembly package",
    value: 640000,
    stage: "qualified",
    close_date: "2026-08-15",
  },
];

async function ensureDealExternalIdProperty(): Promise<void> {
  await ensureUniqueStringProperty("deals", "dealinformation", "btx_external_id", "BTX External ID", "Stable external ID used by the BTX demo HubSpot seed script.");
}

async function ensureCompanyProperties(): Promise<void> {
  await ensureUniqueStringProperty("companies", "companyinformation", "btx_company_domain", "BTX Company Domain", "Stable company domain used by the BTX demo HubSpot seed script.");
  const plainProperties = [
    ["btx_needs", "BTX Needs", "BTX-held notes on the account need."],
    ["btx_aliases", "BTX Aliases", "Known names used by the BTX canonical resolver."],
    ["btx_facility_names", "BTX Facility Names", "Known facilities used by the BTX canonical resolver."],
    ["btx_parent_id", "BTX Parent ID", "Optional parent account identifier."],
    ["btx_subsidiary_ids", "BTX Subsidiary IDs", "Optional subsidiary account identifiers."],
    ["btx_cage_code", "BTX CAGE Code", "Verified CAGE code used by the BTX canonical resolver."],
    ["btx_uei", "BTX UEI", "Verified UEI used by the BTX canonical resolver."],
    ["btx_known_programs", "BTX Known Programs", "Known programs used by the BTX canonical resolver."],
    ["btx_known_customers", "BTX Known Customers", "Known customers used by the BTX canonical resolver."],
  ] as const;
  for (const [name, label, description] of plainProperties) {
    await ensurePlainStringProperty("companies", "companyinformation", name, label, description);
  }
}

async function ensurePlainStringProperty(objectType: CrmObjectType, groupName: string, name: string, label: string, description: string): Promise<void> {
  try {
    await hubspot(`/crm/v3/properties/${objectType}`, {
      groupName,
      name,
      label,
      description,
      type: "string",
      fieldType: "text",
    }, { allowConflict: true });
  } catch (error) {
    if (!(error instanceof HubspotError) || error.status !== 403) throw error;
    await hubspotGet(`/crm/v3/properties/${objectType}/${name}`);
  }
}

async function ensureUniqueStringProperty(objectType: CrmObjectType, groupName: string, name: string, label: string, description: string): Promise<void> {
  try {
    await hubspot(`/crm/v3/properties/${objectType}`, {
      groupName,
      name,
      label,
      description,
      hasUniqueValue: true,
      type: "string",
      fieldType: "text",
    }, { allowConflict: true });
  } catch (error) {
    if (!(error instanceof HubspotError) || error.status !== 403) throw error;

    try {
      await hubspotGet(`/crm/v3/properties/${objectType}/${name}`);
      return;
    } catch (getError) {
      if (getError instanceof HubspotError && getError.status === 404) {
        throw new Error(`HubSpot ${objectType} property ${name} does not exist, and this token cannot create it. Grant a private app token with CRM schema write scope for ${objectType} and rerun.`);
      }
      throw getError;
    }
  }
}

async function batchUpsert(objectType: CrmObjectType, idProperty: string, inputs: BatchUpsertInput[]): Promise<UpsertSummary> {
  const summary: UpsertSummary = { created: 0, updated: 0, idByTraceId: new Map() };

  for (let i = 0; i < inputs.length; i += 100) {
    const chunk = inputs.slice(i, i + 100).map((input) => ({ ...input, idProperty }));
    const response = await hubspot<BatchUpsertResponse>(`/crm/v3/objects/${objectType}/batch/upsert`, {
      idProperty,
      inputs: chunk,
    });
    if ((response?.numErrors ?? 0) > 0 || (response?.errors?.length ?? 0) > 0) {
      throw new Error(`HubSpot ${objectType} upsert returned errors: ${JSON.stringify(response?.errors ?? [])}`);
    }

    for (const [index, result] of (response?.results ?? []).entries()) {
      const resultTraceId = result.objectWriteTraceId ?? chunk[index]?.objectWriteTraceId;
      if (resultTraceId) summary.idByTraceId.set(resultTraceId, result.id);
      if (result.new) {
        summary.created += 1;
      } else {
        summary.updated += 1;
      }
    }
  }

  if (summary.idByTraceId.size !== inputs.length) {
    throw new Error(`HubSpot ${objectType} upsert returned ${summary.idByTraceId.size} IDs for ${inputs.length} inputs.`);
  }

  return summary;
}

function isNonUniqueIdPropertyError(error: unknown, idProperty: string): boolean {
  return error instanceof HubspotError
    && error.status === 400
    && error.body.includes("Unable to perform update/upsert by non-unique")
    && error.body.includes(`property ${idProperty}`);
}

function uniquePairs(pairs: AssociationPair[]): AssociationPair[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.fromId}:${pair.toId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readExistingAssociations(fromObjectType: AssociationObjectType, toObjectType: AssociationObjectType, fromIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();

  for (let i = 0; i < fromIds.length; i += 1000) {
    const chunk = fromIds.slice(i, i + 1000);
    const response = await hubspot<AssociationReadResponse>(`/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`, {
      inputs: chunk.map((id) => ({ id })),
    });

    for (const result of response?.results ?? []) {
      for (const to of result.to ?? []) {
        existing.add(`${result.from.id}:${to.toObjectId}`);
      }
    }
  }

  return existing;
}

async function createMissingAssociations(fromObjectType: AssociationObjectType, toObjectType: AssociationObjectType, pairs: AssociationPair[]): Promise<{ created: number; alreadyPresent: number }> {
  const dedupedPairs = uniquePairs(pairs);
  const existing = await readExistingAssociations(fromObjectType, toObjectType, dedupedPairs.map((pair) => pair.fromId));
  const missingPairs = dedupedPairs.filter((pair) => !existing.has(`${pair.fromId}:${pair.toId}`));

  for (let i = 0; i < missingPairs.length; i += 100) {
    await hubspot(`/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/associate/default`, {
      inputs: missingPairs.slice(i, i + 100).map((pair) => ({
        from: { id: pair.fromId },
        to: { id: pair.toId },
      })),
    });
  }

  return { created: missingPairs.length, alreadyPresent: dedupedPairs.length - missingPairs.length };
}

function idFromSummary(summary: UpsertSummary, objectType: CrmObjectType, id: string): string {
  const hubspotId = summary.idByTraceId.get(traceId(objectType, id));
  if (!hubspotId) throw new Error(`Missing HubSpot ${objectType} ID for ${id}.`);
  return hubspotId;
}

function printObjectSummary(label: string, summary: UpsertSummary): void {
  console.log(`${label}: ${summary.created} created, ${summary.updated} updated`);
}

async function dealStageIdByDemoStage(): Promise<Record<string, string>> {
  const response = await hubspotGet<DealPipelineResponse>("/crm/v3/pipelines/deals");
  const pipeline = response?.results?.find((candidate) => candidate.id === "default") ?? response?.results?.[0];
  const stages = pipeline?.stages ?? [];
  if (stages.length === 0) throw new Error("HubSpot portal has no deal pipeline stages.");

  const fallbackStage = stages[0];
  const openStages = stages.filter((stage) => stage.metadata?.isClosed !== "true");
  const wonStageId = (stages.find((stage) => stage.metadata?.isClosed === "true" && stage.metadata?.probability === "1.0") ?? stages.at(-2) ?? stages.at(-1) ?? fallbackStage).id;
  const lostStageId = (stages.find((stage) => stage.metadata?.isClosed === "true" && stage.metadata?.probability === "0.0") ?? stages.at(-1) ?? fallbackStage).id;
  const stageAt = (index: number): string => (openStages[Math.min(index, Math.max(openStages.length - 1, 0))] ?? fallbackStage).id;

  return {
    prospecting: stageAt(0),
    qualified: stageAt(1),
    proposal: stageAt(2),
    won: wonStageId,
    lost: lostStageId,
  };
}

function companyUpsertInputs(companyRows: CompanyRow[], idProperty: "domain" | "btx_company_domain"): BatchUpsertInput[] {
  return companyRows.map((company) => {
    const domain = worldCompanyDomain(company);
    const notes = company.notes?.join("\n") ?? undefined;
    return {
      id: domain,
      objectWriteTraceId: traceId("companies", company.id),
      properties: cleanProperties({
        name: company.name,
        domain,
        btx_company_domain: idProperty === "btx_company_domain" ? domain : undefined,
        city: company.location.city,
        state: company.location.state,
        address: company.location.address,
        zip: company.location.postal_code,
        website: company.website_url,
        description: notes,
        btx_needs: notes,
        btx_aliases: company.aliases?.join("; "),
        btx_facility_names: company.facility_names?.join("; "),
        btx_cage_code: company.cage_code,
        btx_uei: company.uei,
        btx_known_programs: company.known_programs?.join("; "),
        btx_known_customers: company.known_customers?.join("; "),
      }),
    };
  });
}

function printSeedDryRun(companyRows: CompanyRow[], contactRows: ContactRow[], opportunityRows: OpportunityRow[]): void {
  console.log("HubSpot seed dry-run. Pass --confirm to write to HubSpot.");
  console.log(`Would create/update ${companyRows.length} companies: ${companyRows.map((company) => company.name).join(", ")}`);
  console.log(`Would create/update ${contactRows.length} contacts: ${contactRows.map((contact) => `${contact.name} <${deterministicEmail(contact)}>`).join(", ")}`);
  console.log(`Would create/update ${opportunityRows.length} deals: ${opportunityRows.map((opportunity) => opportunity.name).join(", ")}`);
  console.log(`Would create/update ${contactRows.length} contact->company associations and ${opportunityRows.length} deal->company associations.`);
  console.log("Would archive 0 records.");
}

async function verifyHubSpotSeed(
  companyRows: CompanyRow[],
  contactRows: ContactRow[],
  opportunityRows: OpportunityRow[],
  companySummary: UpsertSummary,
  contactSummary: UpsertSummary,
  dealSummary: UpsertSummary,
): Promise<void> {
  const worldDomains = new Set(companyRows.map(worldCompanyDomain));
  const allCompanies = await searchAll("companies", ["name", "domain", "btx_company_domain"]);
  const namelessCompanies = allCompanies.filter((company) => !company.properties.name);
  const worldCompanies = allCompanies.filter((company) => worldDomains.has(company.properties.domain ?? ""));
  const nonWorldCompanies = allCompanies.filter((company) => !worldDomains.has(company.properties.domain ?? ""));

  if (namelessCompanies.length > 0) {
    throw new Error(`HubSpot verification failed: ${namelessCompanies.length} companies lack a name.`);
  }
  if (worldCompanies.length !== companyRows.length || allCompanies.length !== companyRows.length + 1) {
    throw new Error(`HubSpot verification failed: expected ${companyRows.length} named demo companies plus 1 default company; found ${allCompanies.length} total (${worldCompanies.length} demo, ${nonWorldCompanies.length} other).`);
  }

  const expectedCompanyByContactId = new Map(contactRows.map((contact) => [
    idFromSummary(contactSummary, "contacts", contact.id),
    idFromSummary(companySummary, "companies", contact.company_id),
  ]));
  const expectedCompanyByDealId = new Map(opportunityRows.map((opportunity) => [
    idFromSummary(dealSummary, "deals", opportunity.id),
    idFromSummary(companySummary, "companies", opportunity.company_id),
  ]));

  const contactAssociations = await readExistingAssociations("contacts", "companies", [...expectedCompanyByContactId.keys()]);
  const dealAssociations = await readExistingAssociations("deals", "companies", [...expectedCompanyByDealId.keys()]);

  let totalContactAssociations = 0;
  for (const [contactId, companyId] of expectedCompanyByContactId) {
    const associatedCompanyIds = [...contactAssociations].filter((key) => key.startsWith(`${contactId}:`)).map((key) => key.split(":")[1]);
    totalContactAssociations += associatedCompanyIds.length;
    if (associatedCompanyIds.length !== 1 || associatedCompanyIds[0] !== companyId) {
      throw new Error(`HubSpot verification failed: contact ${contactId} is associated to ${associatedCompanyIds.length ? associatedCompanyIds.join(", ") : "no companies"} instead of named company ${companyId}.`);
    }
  }

  let totalDealAssociations = 0;
  for (const [dealId, companyId] of expectedCompanyByDealId) {
    const associatedCompanyIds = [...dealAssociations].filter((key) => key.startsWith(`${dealId}:`)).map((key) => key.split(":")[1]);
    totalDealAssociations += associatedCompanyIds.length;
    if (associatedCompanyIds.length !== 1 || associatedCompanyIds[0] !== companyId) {
      throw new Error(`HubSpot verification failed: deal ${dealId} is associated to ${associatedCompanyIds.length ? associatedCompanyIds.join(", ") : "no companies"} instead of named company ${companyId}.`);
    }
  }

  console.log(`Verification: ${worldCompanies.length} named demo companies (+${nonWorldCompanies.length} default/other), ${totalContactAssociations} contact-company associations, ${totalDealAssociations} deal-company associations.`);
}

if (!confirmed) {
  printSeedDryRun(companyRows, contactRows, opportunityRows);
} else if (!token) {
  logSkip();
} else {
  console.log(`HubSpot token source: ${tokenSource?.name}`);
  const companyDomainById = new Map(companyRows.map((company) => [company.id, worldCompanyDomain(company)]));

  await ensureCompanyProperties();
  await ensureDealExternalIdProperty();

  let companySummary: UpsertSummary;
  try {
    companySummary = await batchUpsert("companies", "domain", companyUpsertInputs(companyRows, "domain"));
  } catch (error) {
    if (!isNonUniqueIdPropertyError(error, "domain")) throw error;
    console.log("HubSpot portal does not allow company upsert by built-in domain; using unique btx_company_domain fallback.");
    await ensureUniqueStringProperty("companies", "companyinformation", "btx_company_domain", "BTX Company Domain", "Stable fictional company domain used by the BTX demo HubSpot seed script.");
    companySummary = await batchUpsert("companies", "btx_company_domain", companyUpsertInputs(companyRows, "btx_company_domain"));
  }

  const contactSummary = await batchUpsert("contacts", "email", contactRows.map((contact) => {
    const { firstname, lastname } = splitName(contact.name);
    const email = deterministicEmail(contact);
    const expectedDomain = companyDomainById.get(contact.company_id);
    if (!expectedDomain) throw new Error(`Contact ${contact.id} references unknown company ${contact.company_id}.`);
    if (!email.endsWith(".example.com")) {
      throw new Error(`Contact ${contact.id} must use a non-real example.com address, received ${email}.`);
    }
    return {
      id: email,
      objectWriteTraceId: traceId("contacts", contact.id),
      properties: cleanProperties({
        firstname,
        lastname,
        email,
        jobtitle: contact.title,
      }),
    };
  }));

  const dealStageIds = await dealStageIdByDemoStage();
  const dealSummary = await batchUpsert("deals", "btx_external_id", opportunityRows.map((opportunity) => ({
    id: opportunity.id,
    objectWriteTraceId: traceId("deals", opportunity.id),
    properties: cleanProperties({
      dealname: opportunity.name,
      amount: opportunity.value,
      closedate: opportunity.close_date,
      dealstage: dealStageIds[opportunity.stage],
      btx_external_id: opportunity.id,
    }),
  })));

  const contactCompanyAssociations = await createMissingAssociations("contacts", "companies", contactRows.map((contact) => ({
    fromId: idFromSummary(contactSummary, "contacts", contact.id),
    toId: idFromSummary(companySummary, "companies", contact.company_id),
  })));

  const dealCompanyAssociations = await createMissingAssociations("deals", "companies", opportunityRows.map((opportunity) => ({
    fromId: idFromSummary(dealSummary, "deals", opportunity.id),
    toId: idFromSummary(companySummary, "companies", opportunity.company_id),
  })));

  printObjectSummary("Companies", companySummary);
  printObjectSummary("Contacts", contactSummary);
  printObjectSummary("Deals", dealSummary);
  console.log(`Associations: ${contactCompanyAssociations.created} contacts->companies created (${contactCompanyAssociations.alreadyPresent} already present), ${dealCompanyAssociations.created} deals->companies created (${dealCompanyAssociations.alreadyPresent} already present).`);
  await verifyHubSpotSeed(companyRows, contactRows, opportunityRows, companySummary, contactSummary, dealSummary);
  console.log("HubSpot seed complete.");
}
