import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import companies from "../data/demo/btx/companies.json";
import contacts from "../data/demo/btx/contacts.json";
import opportunities from "../data/demo/btx/opportunities.json";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = join(FRONTEND_DIR, "..");
const confirmed = process.argv.includes("--confirm");

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
}

interface CrmObject {
  id: string;
  properties: Record<string, string | null | undefined>;
}

interface BatchReadResponse {
  results?: CrmObject[];
  errors?: unknown[];
  numErrors?: number;
}

interface SearchResponse {
  results?: CrmObject[];
  paging?: { next?: { after?: string } };
}

interface AssociationReadResponse {
  results?: Array<{
    from: { id: string };
    to?: Array<{ toObjectId: string | number }>;
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

function cleanProperties(properties: Record<string, PropertyValue | undefined>): Record<string, PropertyValue> {
  return Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, PropertyValue] => entry[1] !== undefined));
}

function worldCompanyDomain(company: CompanyRow): string {
  return company.domain ?? company.website_url?.replace(/^https?:\/\//, "").replace(/\/$/u, "") ?? `${company.id}.example`;
}

function emailLocalPart(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function deterministicEmail(contact: ContactRow): string {
  return contact.email ?? `${emailLocalPart(contact.name)}@${contact.company_id}.example.com`;
}

async function hubspot<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T | undefined> {
  if (!token) return undefined;
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new HubspotError(path, response.status, text);
  return text ? (JSON.parse(text) as T) : undefined;
}

async function searchAll(objectType: CrmObjectType, properties: string[]): Promise<CrmObject[]> {
  const rows: CrmObject[] = [];
  let after: string | undefined;
  do {
    const response = await hubspot<SearchResponse>("POST", `/crm/v3/objects/${objectType}/search`, {
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

async function batchReadByIdProperty(objectType: CrmObjectType, idProperty: string, ids: string[], properties: string[]): Promise<Map<string, CrmObject>> {
  const objects = new Map<string, CrmObject>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const response = await hubspot<BatchReadResponse>("POST", `/crm/v3/objects/${objectType}/batch/read`, {
      idProperty,
      properties,
      inputs: chunk.map((id) => ({ id })),
    });
    if ((response?.numErrors ?? 0) > 0 || (response?.errors?.length ?? 0) > 0) {
      throw new Error(`HubSpot ${objectType} batch read returned errors: ${JSON.stringify(response?.errors ?? [])}`);
    }
    for (const object of response?.results ?? []) {
      const key = object.properties[idProperty];
      if (key) objects.set(key, object);
    }
  }
  return objects;
}

async function batchUpdate(objectType: CrmObjectType, inputs: Array<{ id: string; properties: Record<string, PropertyValue> }>): Promise<void> {
  for (let i = 0; i < inputs.length; i += 100) {
    await hubspot("POST", `/crm/v3/objects/${objectType}/batch/update`, {
      inputs: inputs.slice(i, i + 100),
    });
  }
}

async function archiveObjects(objectType: CrmObjectType, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    await hubspot("POST", `/crm/v3/objects/${objectType}/batch/archive`, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id })),
    });
  }
}

async function readAssociations(fromObjectType: AssociationObjectType, toObjectType: AssociationObjectType, fromIds: string[]): Promise<Map<string, Set<string>>> {
  const associations = new Map<string, Set<string>>();
  for (const id of fromIds) associations.set(id, new Set());

  for (let i = 0; i < fromIds.length; i += 1000) {
    const chunk = fromIds.slice(i, i + 1000);
    const response = await hubspot<AssociationReadResponse>("POST", `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`, {
      inputs: chunk.map((id) => ({ id })),
    });
    for (const result of response?.results ?? []) {
      const targets = associations.get(result.from.id) ?? new Set<string>();
      for (const to of result.to ?? []) targets.add(String(to.toObjectId));
      associations.set(result.from.id, targets);
    }
  }

  return associations;
}

async function createDefaultAssociations(fromObjectType: AssociationObjectType, toObjectType: AssociationObjectType, pairs: Array<{ fromId: string; toId: string }>): Promise<void> {
  for (let i = 0; i < pairs.length; i += 100) {
    await hubspot("POST", `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/associate/default`, {
      inputs: pairs.slice(i, i + 100).map((pair) => ({
        from: { id: pair.fromId },
        to: { id: pair.toId },
      })),
    });
  }
}

async function archiveAssociations(fromObjectType: AssociationObjectType, toObjectType: AssociationObjectType, pairs: Array<{ fromId: string; toId: string }>): Promise<void> {
  for (let i = 0; i < pairs.length; i += 100) {
    await hubspot("POST", `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/archive`, {
      inputs: pairs.slice(i, i + 100).map((pair) => ({
        from: { id: pair.fromId },
        to: [{ id: pair.toId }],
      })),
    });
  }
}

function companyProperties(company: CompanyRow): Record<string, PropertyValue> {
  const domain = worldCompanyDomain(company);
  return cleanProperties({
    name: company.name,
    domain,
    btx_company_domain: domain,
    city: company.location.city,
    state: company.location.state,
    address: company.location.address,
    zip: company.location.postal_code,
  });
}

function requireRecord<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}

function printCleanupDryRun(companyRows: CompanyRow[], contactRows: ContactRow[], opportunityRows: OpportunityRow[]): void {
  console.log("HubSpot cleanup dry-run. Pass --confirm to write to HubSpot.");
  console.log(`Would update/backfill ${companyRows.length} canonical companies: ${companyRows.map((company) => company.name).join(", ")}`);
  console.log(`Would verify/repoint ${contactRows.length} contact->company associations for: ${contactRows.map((contact) => contact.name).join(", ")}`);
  console.log(`Would verify/repoint ${opportunityRows.length} deal->company associations for: ${opportunityRows.map((opportunity) => opportunity.name).join(", ")}`);
  console.log(`Would archive up to ${companyRows.length} nameless duplicate companies matching: ${companyRows.map((company) => `${worldCompanyDomain(company)}.com`).join(", ")}`);
}

const companyRows = companies as CompanyRow[];
const contactRows = contacts as ContactRow[];
const opportunityRows = opportunities as OpportunityRow[];

if (!confirmed) {
  printCleanupDryRun(companyRows, contactRows, opportunityRows);
} else if (!token) {
  console.log("HubSpot cleanup skipped: set HUBSPOT_ACCESS_TOKEN or BTX_HUBSPOT_ACCESS_TOKEN.");
} else {
  console.log(`HubSpot token source: ${tokenSource?.name}`);
  const companyById = new Map(companyRows.map((company) => [company.id, company]));
  const worldDomains = new Set(companyRows.map(worldCompanyDomain));
  const autoCompanyDomainByWorldDomain = new Map(companyRows.map((company) => [worldCompanyDomain(company), `${worldCompanyDomain(company)}.com`]));

  const allCompanies = await searchAll("companies", ["name", "domain", "btx_company_domain", "createdate"]);
  const canonicalByCompanyId = new Map<string, CrmObject>();
  const duplicateByCompanyId = new Map<string, CrmObject>();

  for (const company of companyRows) {
    const domain = worldCompanyDomain(company);
    const canonical = allCompanies.find((record) =>
      record.properties.domain === domain
      && record.properties.name === company.name
    );
    if (canonical) canonicalByCompanyId.set(company.id, canonical);

    const autoDomain = autoCompanyDomainByWorldDomain.get(domain);
    const duplicate = allCompanies.find((record) =>
      !record.properties.name
      && record.properties.domain === autoDomain
    );
    if (duplicate) duplicateByCompanyId.set(company.id, duplicate);
  }

  for (const company of companyRows) {
    requireRecord(canonicalByCompanyId.get(company.id), `Missing canonical named company for ${company.id}.`);
  }

  await batchUpdate("companies", companyRows.map((company) => ({
    id: requireRecord(canonicalByCompanyId.get(company.id), `Missing canonical named company for ${company.id}.`).id,
    properties: companyProperties(company),
  })));

  const contactByEmail = await batchReadByIdProperty("contacts", "email", contactRows.map(deterministicEmail), ["email", "firstname", "lastname"]);
  const dealByExternalId = await batchReadByIdProperty("deals", "btx_external_id", opportunityRows.map((opportunity) => opportunity.id), ["btx_external_id", "dealname"]);
  for (const contact of contactRows) requireRecord(contactByEmail.get(deterministicEmail(contact)), `Missing contact ${contact.id}.`);
  for (const opportunity of opportunityRows) requireRecord(dealByExternalId.get(opportunity.id), `Missing deal ${opportunity.id}.`);

  const contactIds = contactRows.map((contact) => requireRecord(contactByEmail.get(deterministicEmail(contact)), `Missing contact ${contact.id}.`).id);
  const dealIds = opportunityRows.map((opportunity) => requireRecord(dealByExternalId.get(opportunity.id), `Missing deal ${opportunity.id}.`).id);
  const contactAssociations = await readAssociations("contacts", "companies", contactIds);
  const dealAssociations = await readAssociations("deals", "companies", dealIds);

  const contactAssociationsToCreate: Array<{ fromId: string; toId: string }> = [];
  const contactAssociationsToRemove: Array<{ fromId: string; toId: string }> = [];
  for (const contact of contactRows) {
    const contactRecord = requireRecord(contactByEmail.get(deterministicEmail(contact)), `Missing contact ${contact.id}.`);
    const canonical = requireRecord(canonicalByCompanyId.get(contact.company_id), `Missing canonical company for ${contact.company_id}.`);
    const current = contactAssociations.get(contactRecord.id) ?? new Set<string>();
    if (!current.has(canonical.id)) contactAssociationsToCreate.push({ fromId: contactRecord.id, toId: canonical.id });
    for (const companyId of current) {
      if (companyId !== canonical.id) contactAssociationsToRemove.push({ fromId: contactRecord.id, toId: companyId });
    }
  }

  const dealAssociationsToCreate: Array<{ fromId: string; toId: string }> = [];
  const dealAssociationsToRemove: Array<{ fromId: string; toId: string }> = [];
  for (const opportunity of opportunityRows) {
    const dealRecord = requireRecord(dealByExternalId.get(opportunity.id), `Missing deal ${opportunity.id}.`);
    const canonical = requireRecord(canonicalByCompanyId.get(opportunity.company_id), `Missing canonical company for ${opportunity.company_id}.`);
    const current = dealAssociations.get(dealRecord.id) ?? new Set<string>();
    if (!current.has(canonical.id)) dealAssociationsToCreate.push({ fromId: dealRecord.id, toId: canonical.id });
    for (const companyId of current) {
      if (companyId !== canonical.id) dealAssociationsToRemove.push({ fromId: dealRecord.id, toId: companyId });
    }
  }

  await createDefaultAssociations("contacts", "companies", contactAssociationsToCreate);
  await createDefaultAssociations("deals", "companies", dealAssociationsToCreate);
  await archiveAssociations("contacts", "companies", contactAssociationsToRemove);
  await archiveAssociations("deals", "companies", dealAssociationsToRemove);

  const duplicateIds = [...duplicateByCompanyId.values()].map((record) => record.id);
  await archiveObjects("companies", duplicateIds);

  console.log("HubSpot repair complete.");
  console.log(`Canonical companies backfilled: ${companyRows.length}`);
  console.log(`Contact associations created: ${contactAssociationsToCreate.length}, removed: ${contactAssociationsToRemove.length}`);
  console.log(`Deal associations created: ${dealAssociationsToCreate.length}, removed: ${dealAssociationsToRemove.length}`);
  console.log(`Nameless duplicate companies archived: ${duplicateIds.length}`);
  console.log(`Other companies left untouched: ${allCompanies.filter((company) => !worldDomains.has(company.properties.domain ?? "") && company.properties.name).length}`);
}
