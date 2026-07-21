// The port the brain reads the world through. The runtime cockpit adapter and
// test fixture adapter implement this interface, so the engine runs on one
// normalized operating contract without changing engine code.
//
// The optional RegionFilter is how "run the brain for the selected area" works:
// the adapter returns only that region's data and the engine scores the subset.
// Runtime and fixture adapters both honor this filter before scoring.

import type { Company, Contact, Facility, Opportunity } from "./entities.ts";
import type { OperatingSnapshot } from "./operatingSnapshot.ts";

export interface RegionFilter {
  /** Scope to a single city. Omitted = the whole portfolio. */
  city?: string;
}

export interface DataAdapter {
  getCompanies(filter?: RegionFilter): Promise<Company[]>;
  /** Raw signals — must clear the validation layer before scoring. */
  getSignals(filter?: RegionFilter): Promise<unknown[]>;
  getContacts(filter?: RegionFilter): Promise<Contact[]>;
  getFacilities(filter?: RegionFilter): Promise<Facility[]>;
  getOpportunities(filter?: RegionFilter): Promise<Opportunity[]>;
  getOperatingSnapshot(): Promise<OperatingSnapshot>;
}
