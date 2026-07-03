// Browser implementation of the DataAdapter port. Same interface as the Node
// fs-based MockDataAdapter (the CLI regression harness) — this one reads the
// frozen fixtures via Vite's JSON import. Swap for a live region-scoped API and
// the engine + UI don't change.

import companiesData from "../../../data/mock/companies.json";
import signalsData from "../../../data/mock/signals.json";
import contactsData from "../../../data/mock/contacts.json";
import facilitiesData from "../../../data/mock/facilities.json";
import opportunitiesData from "../../../data/mock/opportunities.json";

import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";

const ALL_COMPANIES = companiesData as unknown as Company[];
const ALL_SIGNALS = signalsData as unknown as Array<{ subject_id: string }>;
const ALL_CONTACTS = contactsData as unknown as Contact[];
const ALL_FACILITIES = facilitiesData as unknown as Facility[];
const ALL_OPPORTUNITIES = opportunitiesData as unknown as Opportunity[];

export class BrowserMockAdapter implements DataAdapter {
  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return filter?.city ? ALL_COMPANIES.filter((c) => c.location.city === filter.city) : ALL_COMPANIES;
  }

  async getSignals(filter?: RegionFilter): Promise<unknown[]> {
    if (!filter?.city) return ALL_SIGNALS;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_SIGNALS.filter((s) => ids.has(s.subject_id));
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    if (!filter?.city) return ALL_CONTACTS;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_CONTACTS.filter((c) => ids.has(c.company_id));
  }

  async getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    return filter?.city ? ALL_FACILITIES.filter((f) => f.city === filter.city) : ALL_FACILITIES;
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    if (!filter?.city) return ALL_OPPORTUNITIES;
    const ids = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return ALL_OPPORTUNITIES.filter((o) => ids.has(o.company_id));
  }
}
