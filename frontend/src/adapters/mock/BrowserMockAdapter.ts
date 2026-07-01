// Browser implementation of the DataAdapter port. Same interface as the Node
// fs-based MockDataAdapter (which stays as the CLI regression harness) — this one
// reads the frozen fixtures via Vite's JSON import instead of the filesystem.
// Swapping this for a live ApiAdapter (region-scoped fetch) is the only change
// needed to run the same engine + UI on real data.

import companiesData from "../../../data/mock/companies.json";
import signalsData from "../../../data/mock/signals.json";
import contactsData from "../../../data/mock/contacts.json";

import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact } from "../../engine/brain/entities.ts";

const ALL_COMPANIES = companiesData as unknown as Company[];
const ALL_SIGNALS = signalsData as unknown as Array<{ subject_id: string }>;
const ALL_CONTACTS = contactsData as unknown as Contact[];

export class BrowserMockAdapter implements DataAdapter {
  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return filter?.city
      ? ALL_COMPANIES.filter((c) => c.location.city === filter.city)
      : ALL_COMPANIES;
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
}
