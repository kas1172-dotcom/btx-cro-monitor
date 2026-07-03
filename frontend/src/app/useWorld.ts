// Loads + analyzes the world for a given region (city) through the adapter — the
// literal "run the brain for the selected area". Re-runs when the city changes.

import { useEffect, useState } from "react";
import { BrowserMockAdapter } from "../adapters/mock/BrowserMockAdapter.ts";
import { analyze, buildProspects } from "./intelligence.ts";
import { deriveNewsSignals } from "./newsIngest.ts";
import newsData from "../../data/mock/news.json";
import extractedData from "../../data/mock/extracted-signals.json";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { ExtractedRow } from "./newsIngest.ts";
import type { Company, Contact, Facility, Opportunity, MarketEvent } from "../engine/brain/entities.ts";

const adapter = new BrowserMockAdapter();
const NEWS = newsData as unknown as MarketEvent[];
const EXTRACTED = extractedData as unknown as ExtractedRow[];

export interface World {
  city: string | null;
  companies: Company[];
  contacts: Contact[];
  facilities: Facility[];
  opportunities: Opportunity[];
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
      adapter.getFacilities(filter),
      adapter.getOpportunities(filter),
    ]).then(([companies, signals, contacts, facilities, opportunities]) => {
      if (!alive) return;
      const newsSignals = deriveNewsSignals(companies, NEWS, EXTRACTED);
      const analysis = analyze(companies, [...(signals as unknown[]), ...newsSignals]);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      setWorld({ city, companies, contacts, facilities, opportunities, analysis, prospects });
    });
    return () => {
      alive = false;
    };
  }, [city]);

  return world;
}
