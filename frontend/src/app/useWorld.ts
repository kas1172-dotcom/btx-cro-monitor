// Loads + analyzes the world for a given region (city) through the adapter - the
// literal "run the brain for the selected area". Re-runs when the city changes.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createDataAdapter } from "../adapters/createDataAdapter.ts";
import { cockpitAdapterStatus } from "../adapters/CockpitDataAdapter.ts";
import { getScoringConfigVersion, subscribeScoringConfig } from "./config.ts";
import { provenanceCounts, provenanceSummary, type ProvenanceLabel } from "./provenance.ts";
import { analyze, buildProspects } from "./intelligence.ts";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";

const adapter = createDataAdapter();
export interface World {
  city: string | null;
  companies: Company[];
  contacts: Contact[];
  facilities: Facility[];
  opportunities: Opportunity[];
  analysis: Analysis;
  prospects: Prospect[];
  /** CRM, monitor, capacity, pipeline, and assumptions context. */
  snapshot: OperatingSnapshot | null;
  dataSource: string | null;
  loadErrors: string[];
  provenanceSources: Array<{ label: ProvenanceLabel; count: number; detail: string }>;
  provenanceSummary: string | null;
}

export function useWorld(city: string | null): World | null {
  const [world, setWorld] = useState<World | null>(null);
  const configVersion = useSyncExternalStore(subscribeScoringConfig, getScoringConfigVersion, getScoringConfigVersion);

  useEffect(() => {
    let alive = true;
    const filter = city ? { city } : undefined;
    void Promise.all([
      adapter.getCompanies(filter),
      adapter.getSignals(filter),
      adapter.getContacts(filter),
      adapter.getFacilities(filter),
      adapter.getOpportunities(filter),
      adapter.getOperatingSnapshot().catch(() => null),
    ]).then(([rawCompanies, signals, contacts, facilities, opportunities, snapshot]) => {
      if (!alive) return;
      const companies = rawCompanies;
      const resolvedSignals = signals;
      const analysis = analyze(companies, resolvedSignals);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      const adapterStatus = cockpitAdapterStatus();
      const draft = {
        city,
        companies,
        contacts,
        facilities,
        opportunities,
        analysis,
        prospects,
        snapshot,
        dataSource: adapterStatus.provenance,
        loadErrors: adapterStatus.errors,
        provenanceSources: [] as Array<{ label: ProvenanceLabel; count: number; detail: string }>,
        provenanceSummary: null as string | null,
      };
      draft.provenanceSources = provenanceCounts(draft);
      draft.provenanceSummary = provenanceSummary(draft);
      setWorld({
        ...draft,
      });
    });
    return () => {
      alive = false;
    };
  }, [city, configVersion]);

  return world;
}
