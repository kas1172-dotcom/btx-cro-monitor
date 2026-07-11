import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";
import { backendHeaders } from "../../app/backendApi.ts";

const ENDPOINT = (import.meta as ImportMeta & { env?: { VITE_BACKEND_ENDPOINT?: string } }).env?.VITE_BACKEND_ENDPOINT;
const MESSAGE = "Live API mode requires VITE_BACKEND_ENDPOINT. Use VITE_DATA_MODE=demo when the backend is unavailable.";
const state = {
  errors: [] as string[],
  provenance: null as string | null,
};

interface LiveResponse<T> {
  data_provenance?: string;
  records: T[];
}

export function liveAdapterStatus(): { errors: string[]; provenance: string | null } {
  return { errors: [...state.errors], provenance: state.provenance };
}

function rememberError(message: string): void {
  if (!state.errors.includes(message)) state.errors.push(message);
}

function applyFilter<T extends { company_id?: string; location?: { city?: string } }>(
  records: T[],
  filter?: RegionFilter,
  companies?: Company[],
): T[] {
  if (!filter?.city) return records;
  if ("location" in (records[0] ?? {})) {
    return records.filter((record) => record.location?.city === filter.city);
  }
  const ids = new Set((companies ?? []).filter((company) => company.location.city === filter.city).map((company) => company.id));
  return records.filter((record) => record.company_id ? ids.has(record.company_id) : true);
}

export function normalizeCompanies(response: LiveResponse<Company>): Company[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((company) => ({
    ...company,
    canonical_account_id: company.canonical_account_id ?? company.id,
    hubspot_company_id: company.hubspot_company_id ?? (company as { hubspot_id?: string }).hubspot_id,
    relationship: company.relationship ?? "target",
    location: {
      city: company.location?.city ?? "Unknown",
      lat: company.location?.lat ?? 0,
      lon: company.location?.lon ?? 0,
      address: company.location?.address,
      state: company.location?.state,
      postal_code: company.location?.postal_code,
      country: company.location?.country,
    },
    needs: company.needs ?? [],
  }));
}

export function normalizeContacts(response: LiveResponse<Contact>): Contact[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((contact) => ({
    ...contact,
    title: contact.title || "Contact",
  }));
}

export function normalizeOpportunities(response: LiveResponse<Opportunity>): Opportunity[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((opportunity) => ({
    ...opportunity,
    value: Number.isFinite(Number(opportunity.value)) ? Number(opportunity.value) : 0,
    stage: opportunity.stage ?? "prospecting",
    close_date: opportunity.close_date || new Date().toISOString().slice(0, 10),
  }));
}

export class LiveDataAdapter implements DataAdapter {
  private async getJson<T>(path: string): Promise<T> {
    if (!ENDPOINT) throw new Error(MESSAGE);
    const response = await fetch(`${ENDPOINT}${path}`, { headers: backendHeaders() });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Live adapter ${path} failed (${response.status}): ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async load<T>(path: string, normalize: (response: LiveResponse<T>) => T[]): Promise<T[]> {
    try {
      return normalize(await this.getJson<LiveResponse<T>>(path));
    } catch (error) {
      rememberError(error instanceof Error ? error.message : `Live adapter ${path} failed.`);
      return [];
    }
  }

  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return applyFilter(await this.load("/crm/accounts", normalizeCompanies), filter);
  }

  async getSignals(_filter?: RegionFilter): Promise<unknown[]> {
    return [];
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    const [contacts, companies] = await Promise.all([
      this.load("/crm/contacts", normalizeContacts),
      this.getCompanies(),
    ]);
    return applyFilter(contacts, filter, companies);
  }

  async getFacilities(_filter?: RegionFilter): Promise<Facility[]> {
    return [];
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    const [opportunities, companies] = await Promise.all([
      this.load("/crm/deals", normalizeOpportunities),
      this.getCompanies(),
    ]);
    return applyFilter(opportunities, filter, companies);
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    const status = liveAdapterStatus();
    return {
      crm: [],
      capacity: [],
      pipeline: {
        source_type: "demo",
        source_name: status.provenance ?? "HubSpot",
        source_mode: "static_snapshot",
        as_of: new Date().toISOString(),
        summary: {
          open_pipeline_value: 0,
          weighted_pipeline_value: 0,
          priority_accounts: [],
          top_action: status.errors.length ? "Resolve HubSpot connection errors." : "Live HubSpot CRM data is connected.",
        },
        records: [],
      },
      integrations: [{
        id: "hubspot",
        name: "HubSpot CRM",
        category: "CRM",
        status: status.errors.length ? "not_connected" : "demo_connected",
        demo_file: "",
        production_method: "btx_platform HubSpot CRM v3 API",
        description: status.errors.length ? status.errors[0] : "Live account, contact, and deal reads are served from HubSpot.",
        is_demo: false,
      }],
      assumptions: {
        source_type: "demo",
        source_name: status.provenance ?? "HubSpot",
        source_mode: "static_snapshot",
        as_of: new Date().toISOString(),
        is_static_demo: false,
        summary: status.errors.length ? "Live HubSpot reads are currently unavailable." : "CRM records are read live from HubSpot.",
        assumptions: status.errors,
      },
      publicSignals: {
        signal_count: 0,
        news_count: 0,
        latest_signal_at: null,
        latest_news_date: null,
        source_name: "Live CRM mode",
        source_mode: "static_snapshot",
        notice: status.errors.length ? status.errors.join(" ") : "Live: HubSpot",
      },
    };
  }
}
