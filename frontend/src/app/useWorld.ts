// Loads + analyzes the world for a given region (city) through the adapter — the
// literal "run the brain for the selected area". Re-runs when the city changes.

import { useEffect, useState } from "react";
import { createDataAdapter, getDataMode } from "../adapters/createDataAdapter.ts";
import { liveAdapterStatus } from "../adapters/live/LiveDataAdapter.ts";
import { analyze, buildProspects } from "./intelligence.ts";
import { deriveNewsSignals } from "./newsIngest.ts";
import newsData from "../../data/demo/btx/news.json";
import extractedData from "../../data/demo/btx/extracted-signals.json";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { ExtractedRow } from "./newsIngest.ts";
import type { Company, Contact, Facility, Opportunity, MarketEvent } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";

const adapter = createDataAdapter();
const DATA_MODE = getDataMode();
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
  /** Simulated CRM / ERP-capacity / pipeline / assumptions context (demo snapshot). */
  snapshot: OperatingSnapshot | null;
  dataSource: string | null;
  loadErrors: string[];
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
      adapter.getOperatingSnapshot().catch(() => null),
    ]).then(([companies, signals, contacts, facilities, opportunities, snapshot]) => {
      if (!alive) return;
      const usesArtifactSignals = DATA_MODE === "artifact" && snapshot?.publicSignals.source_mode === "artifact";
      const newsSignals = usesArtifactSignals ? [] : deriveNewsSignals(companies, NEWS, EXTRACTED);
      const analysis = analyze(companies, [...signals, ...newsSignals]);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      const liveStatus = DATA_MODE === "live" ? liveAdapterStatus() : { errors: [], provenance: null };
      setWorld({
        city,
        companies,
        contacts,
        facilities,
        opportunities,
        analysis,
        prospects,
        snapshot,
        dataSource: DATA_MODE === "live" ? liveStatus.provenance ?? "HubSpot" : null,
        loadErrors: liveStatus.errors,
      });
    });
    return () => {
      alive = false;
    };
  }, [city]);

  return world;
}
