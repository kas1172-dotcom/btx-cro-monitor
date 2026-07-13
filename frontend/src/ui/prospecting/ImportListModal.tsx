import Papa from "papaparse";
import { useMemo, useState } from "react";
import type { HubSpotImportResponse, HubSpotImportRowInput } from "../../app/backendApi.ts";
import { importProspectsToHubSpot } from "../../app/backendApi.ts";
import type { World } from "../../app/useWorld.ts";
import type { Company } from "../../engine/brain/entities.ts";
import {
  canonicalAccountsFromCompanies,
  RELATIONSHIP_CONFIDENCE_FLOOR,
  resolveSignalRelationships,
  type ExtractedSignalEntity,
} from "../../identity/canonicalAccounts.ts";

export type ImportTargetField =
  | "ignore"
  | "companyName"
  | "domain"
  | "website"
  | "contactName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "title"
  | "city"
  | "state"
  | "country"
  | "cageCode"
  | "uei"
  | "program";

export interface CsvRow {
  rowId: string;
  values: Record<string, string>;
}

export interface MappedImportRow {
  rowId: string;
  fields: Partial<Record<Exclude<ImportTargetField, "ignore">, string>>;
  missingRequired: boolean;
}

export interface DedupeImportRow extends MappedImportRow {
  likelyDuplicate: boolean;
  matchedAccountName?: string;
  confidence?: number;
  matchMethod?: string;
}

type Step = "upload" | "mapping" | "dedupe" | "confirm" | "results";

const FIELD_OPTIONS: Array<{ value: ImportTargetField; label: string; required?: boolean }> = [
  { value: "ignore", label: "Ignore column" },
  { value: "companyName", label: "Company name", required: true },
  { value: "domain", label: "Domain", required: true },
  { value: "website", label: "Website" },
  { value: "contactName", label: "Contact name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "title", label: "Title" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "country", label: "Country" },
  { value: "cageCode", label: "CAGE code" },
  { value: "uei", label: "UEI" },
  { value: "program", label: "Program" },
];

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function autoMapColumn(header: string): ImportTargetField {
  const key = normalizedHeader(header);
  const map: Record<string, ImportTargetField> = {
    company: "companyName",
    companyname: "companyName",
    account: "companyName",
    accountname: "companyName",
    organization: "companyName",
    organizationname: "companyName",
    domain: "domain",
    companydomain: "domain",
    website: "website",
    websiteurl: "website",
    contact: "contactName",
    contactname: "contactName",
    fullname: "contactName",
    name: "contactName",
    firstname: "firstName",
    first: "firstName",
    lastname: "lastName",
    last: "lastName",
    email: "email",
    emailaddress: "email",
    phone: "phone",
    phonenumber: "phone",
    title: "title",
    jobtitle: "title",
    role: "title",
    city: "city",
    state: "state",
    province: "state",
    country: "country",
    cage: "cageCode",
    cagecode: "cageCode",
    uei: "uei",
    program: "program",
    programname: "program",
  };
  return map[key] ?? "ignore";
}

export function mappedRowsFromCsv(
  rows: CsvRow[],
  mapping: Record<string, ImportTargetField>,
): MappedImportRow[] {
  return rows.map((row) => {
    const fields: MappedImportRow["fields"] = {};
    for (const [column, target] of Object.entries(mapping)) {
      if (target === "ignore") continue;
      const value = clean(row.values[column]);
      if (value) fields[target] = value;
    }
    return {
      rowId: row.rowId,
      fields,
      missingRequired: !fields.companyName && !fields.domain,
    };
  });
}

function entityForRow(row: MappedImportRow): ExtractedSignalEntity {
  const fields = row.fields;
  const aliases = [fields.companyName, fields.domain].filter(Boolean) as string[];
  return {
    name: fields.companyName || fields.domain || `Imported row ${row.rowId}`,
    domains: fields.domain ? [fields.domain] : [],
    programs: fields.program ? [fields.program] : [],
    cage_codes: fields.cageCode ? [fields.cageCode] : [],
    ueis: fields.uei ? [fields.uei] : [],
    aliases,
  };
}

export function dedupeImportRows(rows: MappedImportRow[], companies: Company[]): DedupeImportRow[] {
  const accounts = canonicalAccountsFromCompanies(companies);
  return rows.map((row) => {
    if (row.missingRequired) {
      return { ...row, likelyDuplicate: false };
    }
    const result = resolveSignalRelationships([entityForRow(row)], accounts);
    const best = result.relationships.sort((a, b) => b.confidence - a.confidence)[0];
    if (!best || best.confidence < RELATIONSHIP_CONFIDENCE_FLOOR) {
      return { ...row, likelyDuplicate: false };
    }
    const match = companies.find((company) => (company.canonical_account_id ?? company.id) === best.canonical_account_id);
    return {
      ...row,
      likelyDuplicate: true,
      matchedAccountName: match?.name ?? best.canonical_account_id,
      confidence: best.confidence,
      matchMethod: best.match_method,
    };
  });
}

export function confirmedHubSpotRows(rows: DedupeImportRow[], excludedIds: Set<string>): HubSpotImportRowInput[] {
  return rows
    .filter((row) => !row.missingRequired && !excludedIds.has(row.rowId))
    .map((row) => {
      const fields = row.fields;
      const company = {
        companyName: fields.companyName ?? "",
        domain: fields.domain ?? "",
        website: fields.website ?? "",
        phone: fields.phone ?? "",
        city: fields.city ?? "",
        state: fields.state ?? "",
        country: fields.country ?? "",
      };
      const contact = {
        contactName: fields.contactName ?? "",
        firstName: fields.firstName ?? "",
        lastName: fields.lastName ?? "",
        email: fields.email ?? "",
        phone: fields.phone ?? "",
        title: fields.title ?? "",
        companyName: fields.companyName ?? "",
      };
      const hasContact = Object.entries(contact).some(([key, value]) => key !== "companyName" && value.trim());
      return {
        row_id: row.rowId,
        company,
        ...(hasContact ? { contact } : {}),
      };
    });
}

function resultRows(
  rows: DedupeImportRow[],
  excludedIds: Set<string>,
  response: HubSpotImportResponse | null,
): Array<{ rowId: string; label: string; detail: string }> {
  const byId = new Map((response?.rows ?? []).map((row) => [row.row_id, row]));
  return rows.map((row) => {
    if (row.missingRequired) return { rowId: row.rowId, label: "failed", detail: "Missing company name or domain." };
    if (excludedIds.has(row.rowId)) {
      return {
        rowId: row.rowId,
        label: row.likelyDuplicate ? "skipped-as-duplicate" : "skipped",
        detail: row.likelyDuplicate
          ? `Matched ${row.matchedAccountName} at ${Math.round((row.confidence ?? 0) * 100)}% confidence.`
          : "Excluded before confirm.",
      };
    }
    const backend = byId.get(row.rowId);
    if (!backend) return { rowId: row.rowId, label: "failed", detail: "No backend result returned." };
    return {
      rowId: row.rowId,
      label: backend.status,
      detail: backend.reason ?? ([backend.company_id, backend.contact_id].filter(Boolean).join(" / ") || "Created in HubSpot."),
    };
  });
}

export function ImportListModal({ world, onClose }: { world: World; onClose: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportTargetField>>({});
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [response, setResponse] = useState<HubSpotImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPushing, setIsPushing] = useState(false);

  const mappedRows = useMemo(() => mappedRowsFromCsv(rows, mapping), [rows, mapping]);
  const dedupedRows = useMemo(() => dedupeImportRows(mappedRows, world.companies), [mappedRows, world.companies]);
  const pushRows = useMemo(() => confirmedHubSpotRows(dedupedRows, excludedIds), [dedupedRows, excludedIds]);
  const counts = useMemo(() => {
    const missing = dedupedRows.filter((row) => row.missingRequired).length;
    const duplicates = dedupedRows.filter((row) => row.likelyDuplicate).length;
    return {
      missing,
      duplicates,
      newCompanies: dedupedRows.length - missing - duplicates,
      selectedForPush: pushRows.length,
    };
  }, [dedupedRows, pushRows.length]);

  function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const detected = result.meta.fields?.filter(Boolean) ?? [];
        const parsedRows = result.data
          .filter((row) => Object.values(row).some((value) => clean(value)))
          .map((row, index) => ({ rowId: `row-${index + 1}`, values: row }));
        if (!detected.length || !parsedRows.length) {
          setError("No columns or rows were found in that CSV.");
          return;
        }
        const nextMapping = Object.fromEntries(detected.map((column) => [column, autoMapColumn(column)]));
        setColumns(detected);
        setRows(parsedRows);
        setMapping(nextMapping);
        setStep("mapping");
      },
      error: (parseError) => setError(parseError.message),
    });
  }

  function reviewDedupe() {
    const duplicateIds = new Set(dedupedRows.filter((row) => row.likelyDuplicate || row.missingRequired).map((row) => row.rowId));
    setExcludedIds(duplicateIds);
    setStep("dedupe");
  }

  function updateExcluded(rowId: string, excluded: boolean) {
    setExcludedIds((current) => {
      const next = new Set(current);
      if (excluded) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  async function confirmPush() {
    setIsPushing(true);
    setError(null);
    try {
      const result = await importProspectsToHubSpot(pushRows);
      setResponse(result);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "HubSpot import failed.");
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <div className="import-list-overlay" role="dialog" aria-modal="true" aria-labelledby="import-list-title">
      <div className="import-list-modal">
        <div className="import-list-head">
          <div>
            <p className="eyebrow">HubSpot import</p>
            <h2 id="import-list-title">Import list</h2>
            <p>Upload a CSV, map columns, review duplicates, then explicitly confirm before anything reaches HubSpot.</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        {error && <div className="import-error" role="status">{error}</div>}

        {step === "upload" && (
          <section className="import-step">
            <label className="import-file-picker">
              <span>Choose CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
            </label>
          </section>
        )}

        {step === "mapping" && (
          <section className="import-step">
            <div className="import-columns">
              {columns.map((column) => (
                <label key={column}>
                  <span>{column}</span>
                  <select
                    value={mapping[column] ?? "ignore"}
                    onChange={(event) => setMapping((current) => ({ ...current, [column]: event.target.value as ImportTargetField }))}
                  >
                    {FIELD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}{option.required ? " (required one of)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="import-note">
              Required: company name or domain. Columns mapped to Ignore are excluded from the HubSpot payload.
            </p>
            <ImportPreview columns={columns} rows={rows.slice(0, 5)} />
            <div className="import-actions">
              <button type="button" onClick={() => setStep("upload")}>Back</button>
              <button type="button" onClick={reviewDedupe}>Review duplicates</button>
            </div>
          </section>
        )}

        {(step === "dedupe" || step === "confirm") && (
          <section className="import-step">
            <div className="import-counts">
              <span><strong>{counts.newCompanies}</strong> new</span>
              <span><strong>{counts.duplicates}</strong> likely duplicates</span>
              <span><strong>{counts.missing}</strong> missing required</span>
              <span><strong>{counts.selectedForPush}</strong> selected for push</span>
            </div>
            <ImportDedupeTable rows={dedupedRows} excludedIds={excludedIds} onExcludedChange={updateExcluded} />
            <div className="import-actions">
              <button type="button" onClick={() => setStep("mapping")}>Back</button>
              {step === "dedupe" ? (
                <button type="button" onClick={() => setStep("confirm")}>Continue to confirm</button>
              ) : (
                <button type="button" onClick={() => void confirmPush()} disabled={isPushing || pushRows.length === 0}>
                  {isPushing ? "Pushing..." : "Confirm and push to HubSpot"}
                </button>
              )}
            </div>
          </section>
        )}

        {step === "results" && (
          <section className="import-step">
            <div className="import-counts">
              <span><strong>{response?.summary.succeeded ?? 0}</strong> succeeded</span>
              <span><strong>{response?.summary.partial ?? 0}</strong> partial</span>
              <span><strong>{response?.summary.failed ?? 0}</strong> failed</span>
            </div>
            <div className="import-results">
              {resultRows(dedupedRows, excludedIds, response).map((row) => (
                <div key={row.rowId} className={`import-result import-result-${row.label}`}>
                  <strong>{row.rowId}</strong>
                  <span>{row.label}</span>
                  <em>{row.detail}</em>
                </div>
              ))}
            </div>
            <div className="import-actions">
              <button type="button" onClick={onClose}>Done</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ImportPreview({ columns, rows }: { columns: string[]; rows: CsvRow[] }) {
  return (
    <div className="import-table-wrap">
      <table className="import-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowId}>
              {columns.map((column) => <td key={column}>{row.values[column]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportDedupeTable({
  rows,
  excludedIds,
  onExcludedChange,
}: {
  rows: DedupeImportRow[];
  excludedIds: Set<string>;
  onExcludedChange: (rowId: string, excluded: boolean) => void;
}) {
  return (
    <div className="import-table-wrap">
      <table className="import-table">
        <thead>
          <tr>
            <th>Push?</th>
            <th>Company</th>
            <th>Domain</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowId} className={row.likelyDuplicate ? "import-duplicate-row" : ""}>
              <td>
                <input
                  type="checkbox"
                  checked={!excludedIds.has(row.rowId)}
                  disabled={row.missingRequired}
                  onChange={(event) => onExcludedChange(row.rowId, !event.target.checked)}
                  aria-label={`Push ${row.fields.companyName ?? row.rowId}`}
                />
              </td>
              <td>{row.fields.companyName ?? "Missing"}</td>
              <td>{row.fields.domain ?? "Missing"}</td>
              <td>
                {row.missingRequired && "Missing company name or domain"}
                {row.likelyDuplicate && !row.missingRequired &&
                  `Likely duplicate: ${row.matchedAccountName} (${Math.round((row.confidence ?? 0) * 100)}%, ${row.matchMethod})`}
                {!row.likelyDuplicate && !row.missingRequired && "New company candidate"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
