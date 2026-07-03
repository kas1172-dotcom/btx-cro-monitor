// The port the brain reads the world through. DemoDataAdapter and a future live
// adapter (Salesforce / ERP / SAM.gov) should implement THIS interface, so the
// engine can run on static snapshots now and live data later without changing
// engine code. The engine defines the port; adapters implement it.
//
// The optional RegionFilter is how "run the brain for the selected area" works:
// the adapter returns only that region's data and the engine scores the subset.
// Demo filters locally; a live adapter would issue a region-scoped API query.

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
