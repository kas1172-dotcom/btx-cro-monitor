// Node/fs implementation of the demo adapter for CLI smoke tests. The browser
// DemoDataAdapter imports JSON through Vite; this one reads the same snapshots
// from disk so scripts exercise the same core DataAdapter contract.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { DataAdapter, RegionFilter } from "../src/engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../src/engine/brain/entities.ts";

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/demo/btx");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(DEMO_DIR, file), "utf8")) as T;
}

export class DemoFileDataAdapter implements DataAdapter {
  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    const all = readJson<Company[]>("companies.json");
    return filter?.city ? all.filter((c) => c.location.city === filter.city) : all;
  }

  async getSignals(filter?: RegionFilter): Promise<unknown[]> {
    const all = readJson<Array<{ subject_id: string }>>("signals.json");
    if (!filter?.city) return all;
    const inCity = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return all.filter((s) => inCity.has(s.subject_id));
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    const all = readJson<Contact[]>("contacts.json");
    if (!filter?.city) return all;
    const inCity = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return all.filter((c) => inCity.has(c.company_id));
  }

  async getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    const all = readJson<Facility[]>("facilities.json");
    return filter?.city ? all.filter((f) => f.city === filter.city) : all;
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    const all = readJson<Opportunity[]>("opportunities.json");
    if (!filter?.city) return all;
    const inCity = new Set((await this.getCompanies(filter)).map((c) => c.id));
    return all.filter((o) => inCity.has(o.company_id));
  }
}
