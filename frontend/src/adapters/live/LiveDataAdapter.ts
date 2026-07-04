import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";

const ENDPOINT = (import.meta as ImportMeta & { env?: { VITE_BACKEND_ENDPOINT?: string } }).env?.VITE_BACKEND_ENDPOINT;
const MESSAGE = "Live API mode requires VITE_BACKEND_ENDPOINT. Use VITE_DATA_MODE=demo when the backend is unavailable.";

export class LiveDataAdapter implements DataAdapter {
  private async getJson<T>(path: string): Promise<T> {
    if (!ENDPOINT) throw new Error(MESSAGE);
    const response = await fetch(`${ENDPOINT}${path}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Live adapter ${path} failed (${response.status}): ${body}`);
    }
    return response.json() as Promise<T>;
  }

  async getCompanies(_filter?: RegionFilter): Promise<Company[]> {
    const data = await this.getJson<{ records: Company[] }>("/crm/accounts");
    return data.records;
  }

  async getSignals(_filter?: RegionFilter): Promise<unknown[]> {
    return [];
  }

  async getContacts(_filter?: RegionFilter): Promise<Contact[]> {
    const data = await this.getJson<{ records: Contact[] }>("/crm/contacts");
    return data.records;
  }

  async getFacilities(_filter?: RegionFilter): Promise<Facility[]> {
    return [];
  }

  async getOpportunities(_filter?: RegionFilter): Promise<Opportunity[]> {
    const data = await this.getJson<{ records: Opportunity[] }>("/crm/deals");
    return data.records;
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    throw new Error("Live operating snapshot is not implemented yet. Use demo mode for the full cockpit.");
  }
}
