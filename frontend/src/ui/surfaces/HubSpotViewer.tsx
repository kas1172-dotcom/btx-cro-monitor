import { useMemo, useState } from "react";
import {
  addRecordsToHubSpotList,
  createHubSpotList,
  searchHubSpotCompanies,
  type HubSpotLookupCompany,
} from "../../app/backendApi.ts";
import type { World } from "../../app/useWorld.ts";
import type { Company, Contact, Opportunity } from "../../engine/brain/entities.ts";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";

type ListType = "company" | "contact";

interface SelectableRecord {
  id: string;
  label: string;
  detail: string;
  source: "lookup" | "world";
}

export interface HubSpotActivityItem {
  id: string;
  label: string;
  kind: "contact" | "deal";
  detail: string;
  sortDate: string;
}

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1_000)}k`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unavailable";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function hubspotRecordId(value: string | undefined, type: ListType): string | null {
  if (!value) return null;
  const prefix = type === "company" ? "hubspot-company-" : "hubspot-contact-";
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  if (/^\d+$/u.test(value)) return value;
  return null;
}

export function recentHubSpotActivity(world: World, limit = 8): HubSpotActivityItem[] {
  const dealItems = world.opportunities.map((deal) => ({
    id: deal.id,
    label: deal.name,
    kind: "deal" as const,
    detail: `${deal.stage.replace(/_/g, " ")} · ${money(deal.value)} · closes ${dateLabel(deal.close_date)}`,
    sortDate: deal.close_date,
  }));
  const contactItems = world.contacts.map((contact) => ({
    id: contact.id,
    label: contact.name,
    kind: "contact" as const,
    detail: `${contact.title} · ${world.companies.find((company) => company.id === contact.company_id)?.name ?? "Unknown account"}`,
    sortDate: "0000-00-00",
  }));
  return [...dealItems, ...contactItems]
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    .slice(0, limit);
}

export function pipelineSnapshotByStage(opportunities: Opportunity[]): Array<{ stage: string; count: number; value: number }> {
  const rows = new Map<string, { stage: string; count: number; value: number }>();
  for (const opportunity of opportunities) {
    const row = rows.get(opportunity.stage) ?? { stage: opportunity.stage, count: 0, value: 0 };
    row.count += 1;
    row.value += opportunity.value;
    rows.set(opportunity.stage, row);
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}

function lookupRecord(company: HubSpotLookupCompany): SelectableRecord | null {
  const id = company.hubspot_company_id ?? company.hubspot_id ?? hubspotRecordId(company.id, "company");
  if (!id) return null;
  const domain = company.domains?.[0];
  const place = [company.location?.city, company.location?.state].filter(Boolean).join(", ");
  return {
    id,
    label: company.name,
    detail: [domain, place, "Live lookup"].filter(Boolean).join(" · "),
    source: "lookup",
  };
}

function companyRecord(company: Company): SelectableRecord | null {
  const id = company.hubspot_company_id ?? hubspotRecordId(company.id, "company");
  if (!id) return null;
  return {
    id,
    label: company.name,
    detail: [company.domains?.[0], company.location.city, "Loaded world"].filter(Boolean).join(" · "),
    source: "world",
  };
}

function contactRecord(contact: Contact, world: World): SelectableRecord | null {
  const id = hubspotRecordId(contact.id, "contact");
  if (!id) return null;
  return {
    id,
    label: contact.name,
    detail: [contact.title, world.companies.find((company) => company.id === contact.company_id)?.name].filter(Boolean).join(" · "),
    source: "world",
  };
}

export function HubSpotViewer({ world }: { world: World }) {
  const [query, setQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<HubSpotLookupCompany[]>([]);
  const [lookupStatus, setLookupStatus] = useState("");
  const [listType, setListType] = useState<ListType>("company");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [listName, setListName] = useState("");
  const [listStatus, setListStatus] = useState("");
  const [creating, setCreating] = useState(false);

  const recent = useMemo(() => recentHubSpotActivity(world), [world]);
  const pipeline = useMemo(() => pipelineSnapshotByStage(world.opportunities), [world.opportunities]);
  const lookupRecords = useMemo(() => lookupResults.map(lookupRecord).filter((item): item is SelectableRecord => Boolean(item)), [lookupResults]);
  const worldCompanyRecords = useMemo(() => world.companies.map(companyRecord).filter((item): item is SelectableRecord => Boolean(item)), [world.companies]);
  const worldContactRecords = useMemo(() => world.contacts.map((contact) => contactRecord(contact, world)).filter((item): item is SelectableRecord => Boolean(item)), [world]);
  const selectableRecords = listType === "company"
    ? [...lookupRecords, ...worldCompanyRecords].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    : worldContactRecords;

  function toggle(id: string): void {
    setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function runLookup() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLookupStatus("Searching HubSpot...");
    setLookupResults([]);
    try {
      const response = await searchHubSpotCompanies(trimmed, 10);
      setLookupResults(response.records);
      setLookupStatus(response.records.length ? `Found ${response.records.length} companies.` : "No HubSpot companies matched that search.");
    } catch (error) {
      setLookupStatus(error instanceof Error ? error.message : "HubSpot lookup failed.");
    }
  }

  async function createClientList() {
    const name = listName.trim();
    if (!name || selectedIds.length === 0) {
      setListStatus("Add a list name and select at least one record.");
      return;
    }
    const key = `client-list:${listType}:${name}:${selectedIds.slice().sort().join(",")}`;
    setCreating(true);
    setListStatus("Creating HubSpot list...");
    try {
      const created = await createHubSpotList({ name, listType, idempotencyKey: key });
      setListStatus("Adding records and verifying membership...");
      const added = await addRecordsToHubSpotList({
        listId: created.list.id,
        listType,
        recordIds: selectedIds,
        idempotencyKey: `${key}:members`,
      });
      setListStatus(`Verified HubSpot list ${created.list.id} with ${added.list.record_ids.length} ${listType} records. ${created.duplicate ? "Reused idempotent create result." : ""}`);
    } catch (error) {
      setListStatus(error instanceof Error ? error.message : "HubSpot list creation failed.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="surface-page hubspot-viewer" data-surface-component="surface-hubspot-viewer">
      <SurfaceHeader
        eyebrow="HubSpot"
        headline="Live CRM viewer"
        subline="Curated CRM reads use the already-loaded world; lookup and list creation call the backend with the server-side HubSpot token."
      />

      <div className="hubspot-viewer-grid">
        <section className="surface-panel">
          <h2>Recent activity</h2>
          <p>Loaded from current cockpit CRM data. No live HubSpot call is made here.</p>
          <div className="hubspot-mini-list">
            {recent.map((item) => (
              <article key={item.id}>
                <span>{item.kind}</span>
                <strong>{item.label}</strong>
                <em>{item.detail}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="surface-panel">
          <h2>Pipeline snapshot</h2>
          <p>Deals grouped by stage from loaded world data.</p>
          <div className="hubspot-stage-list">
            {pipeline.map((row) => (
              <div key={row.stage}>
                <span>{row.stage.replace(/_/g, " ")}</span>
                <strong>{money(row.value)}</strong>
                <em>{row.count} deals</em>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-panel hubspot-lookup-panel">
          <h2>Company lookup</h2>
          <form onSubmit={(event) => { event.preventDefault(); void runLookup(); }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company name, domain, or website" />
            <button type="submit">Search HubSpot</button>
          </form>
          {lookupStatus && <div className={lookupStatus.includes("failed") || lookupStatus.includes("Backend") ? "live-inline-status error" : "live-inline-status"}>{lookupStatus}</div>}
          {!lookupResults.length && lookupStatus.startsWith("No ") ? <EmptyState headline="No lookup results" body="Try a company name, website, or domain from HubSpot." /> : null}
          <div className="hubspot-mini-list">
            {lookupRecords.map((record) => (
              <article key={record.id}>
                <span>company</span>
                <strong>{record.label}</strong>
                <em>{record.detail}</em>
                <button onClick={() => {
                  setListType("company");
                  toggle(record.id);
                }}>{selectedIds.includes(record.id) ? "Selected" : "Add to list"}</button>
              </article>
            ))}
          </div>
        </section>

        <section className="surface-panel hubspot-list-panel">
          <h2>Create client list</h2>
          <div className="hubspot-list-controls">
            <label>
              <span>List type</span>
              <select value={listType} onChange={(event) => { setListType(event.target.value as ListType); setSelectedIds([]); }}>
                <option value="company">Company list</option>
                <option value="contact">Contact list</option>
              </select>
            </label>
            <label>
              <span>List name</span>
              <input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="BTX priority clients" />
            </label>
          </div>
          <div className="hubspot-select-list">
            {selectableRecords.map((record) => (
              <label key={`${record.source}-${record.id}`}>
                <input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => toggle(record.id)} />
                <span><strong>{record.label}</strong><em>{record.detail}</em></span>
              </label>
            ))}
          </div>
          {!selectableRecords.length && <EmptyState headline="No HubSpot IDs available" body="Load live CRM data or search HubSpot before creating a list." />}
          {listStatus && <div className={listStatus.includes("Verified") ? "live-inline-status" : "live-inline-status error"}>{listStatus}</div>}
          <button className="hubspot-create-list" onClick={() => void createClientList()} disabled={creating}>
            {creating ? "Creating..." : `Create ${listType} list`}
          </button>
        </section>
      </div>
    </section>
  );
}
