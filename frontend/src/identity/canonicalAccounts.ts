import referenceData from "../../../clients/btx/data/defense_primes_enrichment.json";
import type { Company } from "../engine/brain/entities.ts";
import type { SignalMatchMethod, SignalRelationship } from "../engine/signals/contract.ts";

export const RELATIONSHIP_CONFIDENCE_FLOOR = 0.72;

export interface CanonicalAccount {
  id: string;
  hubspot_company_id?: string;
  name: string;
  domains: string[];
  aliases: string[];
  facility_names: string[];
  parent_id?: string;
  subsidiary_ids: string[];
  cage_code?: string;
  uei?: string;
  known_programs: string[];
  known_customers: string[];
}

export interface ReferenceIdentifier {
  value: string;
  verified: boolean;
}

export interface ReferenceEntity {
  id: string;
  name: string;
  domains: string[];
  aliases: string[];
  subsidiaries: string[];
  cage_codes: ReferenceIdentifier[];
  ueis: ReferenceIdentifier[];
  known_programs: string[];
}

export interface ExtractedSignalEntity {
  name: string;
  domains: string[];
  programs: string[];
  cage_codes: string[];
  ueis: string[];
  aliases: string[];
  unconfirmed_identifiers?: string[];
}

export interface ResolutionResult {
  scope: "specific_account" | "program" | "market" | "unlinked";
  relationships: SignalRelationship[];
  entities: ExtractedSignalEntity[];
}

type ReferencePayload = {
  accounts?: Array<{
    id?: unknown;
    name?: unknown;
    domains?: unknown;
    aliases?: unknown;
    subsidiaries?: unknown;
    cage_codes?: unknown;
    uei?: unknown;
    known_programs?: unknown;
  }>;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return uniq(value.flatMap((entry) => splitList(entry)));
  const raw = clean(value);
  if (!raw) return [];
  return uniq(raw.split(/[;,|]/).map((entry) => entry.trim()));
}

function host(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0] ?? "";
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokenSet(value: string): Set<string> {
  return new Set(norm(value).split(" ").filter((token) => token.length > 2));
}

function containsTerm(haystack: string, needle: string): boolean {
  const normalizedNeedle = norm(needle);
  if (!normalizedNeedle) return false;
  return ` ${haystack} `.includes(` ${normalizedNeedle} `);
}

function similarity(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function referenceIdentifiers(value: unknown, key: "code" | "value"): ReferenceIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry as { code?: unknown; value?: unknown; verified?: unknown } | null;
      const identifier = clean(row?.[key]);
      if (!identifier) return null;
      return { value: identifier, verified: row?.verified === true };
    })
    .filter((entry): entry is ReferenceIdentifier => Boolean(entry));
}

export function loadReferenceEntities(payload: ReferencePayload = referenceData as ReferencePayload): ReferenceEntity[] {
  return (payload.accounts ?? []).map((entry) => ({
    id: clean(entry.id),
    name: clean(entry.name),
    domains: splitList(entry.domains).map(host),
    aliases: splitList(entry.aliases),
    subsidiaries: splitList(entry.subsidiaries),
    cage_codes: referenceIdentifiers(entry.cage_codes, "code"),
    ueis: referenceIdentifiers(entry.uei, "value"),
    known_programs: splitList(entry.known_programs),
  })).filter((entry) => entry.id && entry.name);
}

export const DEFENSE_REFERENCE_ENTITIES = loadReferenceEntities();

export function canonicalAccountsFromCompanies(companies: Company[]): CanonicalAccount[] {
  return companies.map((company) => {
    const websiteDomain = company.website_url ? host(company.website_url) : "";
    const explicitDomains = company.domains?.map(host) ?? [];
    const hubspotCompanyId = company.hubspot_company_id ?? (company as { hubspot_id?: string }).hubspot_id;
    return {
      id: company.canonical_account_id ?? company.id,
      hubspot_company_id: hubspotCompanyId,
      name: company.name,
      domains: uniq([...explicitDomains, websiteDomain]),
      aliases: uniq([...(company.aliases ?? []), company.name]),
      facility_names: company.facility_names ?? [],
      parent_id: company.parent_id,
      subsidiary_ids: company.subsidiary_ids ?? [],
      cage_code: company.cage_code,
      uei: company.uei,
      known_programs: company.known_programs ?? [],
      known_customers: company.known_customers ?? [],
    };
  });
}

function referencedEntityForText(text: string, references: ReferenceEntity[]): ExtractedSignalEntity[] {
  const normalized = norm(text);
  const matches: ExtractedSignalEntity[] = [];
  for (const ref of references) {
    const names = [ref.name, ...ref.aliases, ...ref.subsidiaries].filter(Boolean);
    const mentionedByName = names.some((name) => containsTerm(normalized, name));
    const mentionedPrograms = ref.known_programs.filter((program) => containsTerm(normalized, program));
    const mentionedDomains = ref.domains.filter((domain) => text.toLowerCase().includes(domain));
    const mentionedCages = ref.cage_codes.filter((item) => containsTerm(normalized, item.value));
    const mentionedUeis = ref.ueis.filter((item) => containsTerm(normalized, item.value));
    if (!mentionedByName && !mentionedPrograms.length && !mentionedDomains.length && !mentionedCages.length && !mentionedUeis.length) continue;
    matches.push({
      name: mentionedByName ? ref.name : mentionedPrograms[0] ?? ref.name,
      domains: mentionedDomains,
      programs: mentionedPrograms,
      cage_codes: mentionedCages.map((item) => item.value),
      ueis: mentionedUeis.map((item) => item.value),
      aliases: mentionedByName ? names : [],
      unconfirmed_identifiers: [
        ...mentionedCages.filter((item) => !item.verified).map((item) => `cage:${item.value}`),
        ...mentionedUeis.filter((item) => !item.verified).map((item) => `uei:${item.value}`),
      ],
    });
  }
  return matches;
}

export function extractSignalEntities(
  sourceText: string,
  namedEntities: string[] = [],
  references: ReferenceEntity[] = DEFENSE_REFERENCE_ENTITIES,
): ExtractedSignalEntity[] {
  const combinedText = `${sourceText} ${namedEntities.join(" ")}`;
  const extracted = referencedEntityForText(combinedText, references);
  const knownNames = new Set(extracted.map((entity) => norm(entity.name)));
  for (const name of namedEntities) {
    const cleaned = clean(name);
    if (!cleaned || knownNames.has(norm(cleaned))) continue;
    extracted.push({ name: cleaned, domains: [], programs: [], cage_codes: [], ueis: [], aliases: [cleaned] });
  }
  return extracted;
}

function relationship(
  account: CanonicalAccount,
  entity: ExtractedSignalEntity,
  match_method: SignalMatchMethod,
  evidence: string,
  confidence: number,
  review_status: SignalRelationship["review_status"] = "accepted",
): SignalRelationship {
  return {
    canonical_account_id: account.id,
    source_entity_name: entity.name,
    match_method,
    evidence,
    confidence,
    review_status,
    creation_source: "resolver",
    last_validated_at: review_status === "accepted" ? new Date().toISOString() : null,
  };
}

function bestRelationshipForEntity(account: CanonicalAccount, entity: ExtractedSignalEntity): SignalRelationship | null {
  const accountDomains = new Set(account.domains.map(host));
  const domain = entity.domains.map(host).find((entry) => accountDomains.has(entry));
  if (domain) return relationship(account, entity, "exact_domain", `domain:${domain}`, 0.98);

  const accountCage = account.cage_code?.toUpperCase();
  const cage = entity.cage_codes.find((entry) => entry.toUpperCase() === accountCage);
  if (cage) {
    const evidence = `cage:${cage}`;
    return relationship(
      account,
      entity,
      "cage_uei",
      evidence,
      0.96,
      entity.unconfirmed_identifiers?.includes(evidence) ? "unconfirmed" : "accepted",
    );
  }

  const accountUei = account.uei?.toUpperCase();
  const uei = entity.ueis.find((entry) => entry.toUpperCase() === accountUei);
  if (uei) {
    const evidence = `uei:${uei}`;
    return relationship(
      account,
      entity,
      "cage_uei",
      evidence,
      0.96,
      entity.unconfirmed_identifiers?.includes(evidence) ? "unconfirmed" : "accepted",
    );
  }

  const accountAliases = [account.name, ...account.aliases, ...account.facility_names].map(norm).filter(Boolean);
  const entityAliases = [entity.name, ...entity.aliases].map(norm).filter(Boolean);
  const alias = entityAliases.find((entry) => accountAliases.includes(entry));
  if (alias) return relationship(account, entity, "alias", `alias:${alias}`, 0.9);

  const accountPrograms = account.known_programs.map(norm);
  const program = entity.programs.find((entry) => accountPrograms.includes(norm(entry)));
  if (program) return relationship(account, entity, "program", `program:${program}`, 0.82);

  const fuzzy = Math.max(similarity(account.name, entity.name), ...account.aliases.map((aliasName) => similarity(aliasName, entity.name)));
  if (fuzzy >= 0.82) return relationship(account, entity, "name_fuzzy", `token_similarity:${fuzzy.toFixed(2)}`, fuzzy);

  return null;
}

export function resolveSignalRelationships(
  entities: ExtractedSignalEntity[],
  accounts: CanonicalAccount[],
  confidenceFloor = RELATIONSHIP_CONFIDENCE_FLOOR,
): ResolutionResult {
  const relationships = entities
    .flatMap((entity) => accounts.map((account) => bestRelationshipForEntity(account, entity)).filter(Boolean) as SignalRelationship[])
    .filter((record) => record.confidence >= confidenceFloor)
    .sort((a, b) => b.confidence - a.confidence || a.canonical_account_id.localeCompare(b.canonical_account_id));

  if (relationships.length) {
    return { scope: "specific_account", relationships: [relationships[0]], entities };
  }
  if (entities.some((entity) => entity.programs.length > 0)) return { scope: "program", relationships: [], entities };
  return { scope: entities.length ? "unlinked" : "market", relationships: [], entities };
}
