// The mock implementation of the DataAdapter port. Reads frozen JSON fixtures
// from data/mock/. A real adapter (Salesforce / ERP / SAM.gov) would implement
// the SAME interface against a live API — the engine and UI can't tell which one
// they're talking to. This is the seam that lets the decision model be tested on
// fake or real data interchangeably.
//
// RegionFilter is honored locally here (filter the frozen data by city); a live
// adapter would push the filter down into the API query so only that region's
// data is ever fetched — "run the brain for the selected area".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact } from "../../engine/brain/entities.ts";

const MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../data/mock");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(MOCK_DIR, file), "utf8")) as T;
}

export class MockDataAdapter implements DataAdapter {
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
}
