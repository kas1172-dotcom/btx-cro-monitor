// Loads + analyzes the world for a given region (city) through the adapter — the
// literal "run the brain for the selected area". Re-runs when the city changes.

import { useEffect, useState } from "react";
import { BrowserMockAdapter } from "../adapters/mock/BrowserMockAdapter.ts";
import { analyze, buildProspects } from "./intelligence.ts";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { Company, Contact } from "../engine/brain/entities.ts";

const adapter = new BrowserMockAdapter();

export interface World {
  city: string | null;
  companies: Company[];
  contacts: Contact[];
  analysis: Analysis;
  prospects: Prospect[];
}

export function useWorld(city: string | null): World | null {
  const [world, setWorld] = useState<World | null>(null);

  useEffect(() => {
    let alive = true;
    const filter = city ? { city } : undefined;
    void Promise.all([
      adapter.getCompanies(filter),
      adapter.getSignals(filter),
      adapter.getContacts(filter),
    ]).then(([companies, signals, contacts]) => {
      if (!alive) return;
      const analysis = analyze(companies, signals);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      setWorld({ city, companies, contacts, analysis, prospects });
    });
    return () => {
      alive = false;
    };
  }, [city]);

  return world;
}
