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
  console.log(`Would archive ${companyRows.length} previously seeded fake companies: ${companyRows.map((company) => company.name).join(", ")}`);
  console.log(`Would archive ${contactRows.length} contacts from the old fake seed set: ${contactRows.map((contact) => contact.name).join(", ")}`);
  console.log(`Would archive ${opportunityRows.length} deals from the old fake seed set: ${opportunityRows.map((opportunity) => opportunity.name).join(", ")}`);
  console.log("Would leave all records outside the known old BTX seed identifiers untouched.");
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
  const fakeDomains = new Set(companyRows.flatMap((company) => {
    const domain = worldCompanyDomain(company);
    return [domain, `${domain}.com`];
  }));
  const fakeCompanyNames = new Set(companyRows.map((company) => company.name));
  const fakeEmails = contactRows.map(deterministicEmail);
  const fakeDealExternalIds = opportunityRows.map((opportunity) => opportunity.id);

  const allCompanies = await searchAll("companies", ["name", "domain", "btx_company_domain", "createdate"]);
  const companiesToArchive = allCompanies.filter((record) => {
    const domain = record.properties.domain ?? "";
    const btxDomain = record.properties.btx_company_domain ?? "";
    const name = record.properties.name ?? "";
    return fakeDomains.has(domain) || fakeDomains.has(btxDomain) || fakeCompanyNames.has(name);
  });
  const contactsToArchive = [...(await batchReadByIdProperty("contacts", "email", fakeEmails, ["email", "firstname", "lastname"])).values()];
  const dealsToArchive = [...(await batchReadByIdProperty("deals", "btx_external_id", fakeDealExternalIds, ["btx_external_id", "dealname"])).values()];

  await archiveObjects("deals", dealsToArchive.map((record) => record.id));
  await archiveObjects("contacts", contactsToArchive.map((record) => record.id));
  await archiveObjects("companies", companiesToArchive.map((record) => record.id));

  console.log("HubSpot cleanup complete.");
  console.log(`Fake seeded companies archived: ${companiesToArchive.length}`);
  console.log(`Fake seeded contacts archived: ${contactsToArchive.length}`);
  console.log(`Fake seeded deals archived: ${dealsToArchive.length}`);
  console.log(`Other companies left untouched: ${allCompanies.length - companiesToArchive.length}`);
}
