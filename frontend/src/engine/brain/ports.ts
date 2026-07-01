// The port the brain reads the world through. MockDataAdapter and a future live
// adapter (Salesforce / ERP / SAM.gov) implement THIS interface identically, so
// the demo runs on fake or real data interchangeably — selected by config, not
// by changing engine code. The engine defines the port; adapters implement it;
// the engine never imports an adapter (dependency points inward).
//
// The optional RegionFilter is how "run the brain for the selected area" works:
// the adapter returns only that region's data and the engine scores the subset.
// Mock filters locally; a live adapter would issue a region-scoped API query.

import type { Company, Contact } from "./entities.ts";

export interface RegionFilter {
  /** Scope to a single city. Omitted = the whole portfolio. */
  city?: string;
}

export interface DataAdapter {
  getCompanies(filter?: RegionFilter): Promise<Company[]>;
  /** Raw signals — must clear the validation layer before scoring. */
  getSignals(filter?: RegionFilter): Promise<unknown[]>;
  getContacts(filter?: RegionFilter): Promise<Contact[]>;
}
