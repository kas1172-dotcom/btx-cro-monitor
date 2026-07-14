import {
  autoMapColumn,
  confirmedHubSpotRows,
  dedupeImportRows,
  mappedRowsFromCsv,
  type CsvRow,
  type ImportTargetField,
} from "../src/ui/prospecting/ImportListModal.tsx";
import type { Company } from "../src/engine/brain/entities.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const existing: Company = {
  id: "hubspot-company-332413222630",
  canonical_account_id: "hubspot-company-332413222630",
  hubspot_company_id: "332413222630",
  name: "Trinity Defense Components",
  relationship: "target",
  account_status: "target_prospect",
  business_motion: "prospect_new_business",
  location: { city: "Pittsburgh", state: "PA", lat: 40.44, lon: -79.99, country: "USA" },
  domains: ["trinity-defense.example"],
  aliases: ["Trinity Defense"],
  cage_code: "1TRIN",
  known_programs: ["F-35"],
  needs: ["precision machining"],
};

const csvRows: CsvRow[] = [
  {
    rowId: "row-1",
    values: {
      "Company Name": "Trinity Defense Components",
      Domain: "trinity-defense.example",
      "Contact Name": "Ari Lee",
      Email: "ari@trinity-defense.example",
    },
  },
  {
    rowId: "row-2",
    values: {
      "Company Name": "Northstar Machining",
      Domain: "northstar-machining.example",
      "Contact Name": "Riley Shah",
      Email: "riley@northstar-machining.example",
    },
  },
  {
    rowId: "row-3",
    values: {
      "Company Name": "",
      Domain: "",
      "Contact Name": "No Company",
      Email: "missing@example.com",
    },
  },
];

const mapping: Record<string, ImportTargetField> = {
  "Company Name": autoMapColumn("Company Name"),
  Domain: autoMapColumn("Domain"),
  "Contact Name": autoMapColumn("Contact Name"),
  Email: autoMapColumn("Email"),
};

assert(mapping["Company Name"] === "companyName", "Company Name did not map to companyName");
assert(mapping.Domain === "domain", "Domain did not map to domain");
assert(mapping["Contact Name"] === "contactName", "Contact Name did not map to contactName");
assert(mapping.Email === "email", "Email did not map to email");

const mapped = mappedRowsFromCsv(csvRows, mapping);
const deduped = dedupeImportRows(mapped, [existing]);
const byId = new Map(deduped.map((row) => [row.rowId, row]));

assert(byId.get("row-1")?.likelyDuplicate === true, "existing Trinity row was not flagged as duplicate");
assert(byId.get("row-1")?.matchedAccountName === "Trinity Defense Components", "duplicate match did not name existing account");
assert((byId.get("row-1")?.confidence ?? 0) >= 0.72, "duplicate confidence did not meet floor");
assert(byId.get("row-2")?.likelyDuplicate === false, "new Northstar row was incorrectly flagged as duplicate");
assert(byId.get("row-3")?.missingRequired === true, "missing required row was not flagged");

const excluded = new Set(["row-1", "row-3"]);
const confirmed = confirmedHubSpotRows(deduped, excluded);

assert(confirmed.length === 1, `expected 1 confirmed row, got ${confirmed.length}`);
assert(confirmed[0].row_id === "row-2", `expected row-2 to be confirmed, got ${confirmed[0].row_id}`);
assert(confirmed[0].company.companyName === "Northstar Machining", "confirmed company name was not mapped");
assert(confirmed[0].contact?.email === "riley@northstar-machining.example", "confirmed contact email was not mapped");

console.log("import list ok: headers map, duplicates flag before confirm, missing rows block, payload excludes skipped rows");
