// Loads + analyzes the world for a given region (city) through the adapter — the
// literal "run the brain for the selected area". Re-runs when the city changes.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createDataAdapter, getDataMode } from "../adapters/createDataAdapter.ts";
import { liveAdapterStatus } from "../adapters/live/LiveDataAdapter.ts";
import { getScoringConfigVersion, subscribeScoringConfig } from "./config.ts";
import { provenanceCounts, provenanceSummary, type ProvenanceLabel } from "./provenance.ts";
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
const SARONIC_PROSPECT_ID = "signal-prospect-saronic";

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
  dataMode: "demo" | "artifact" | "live" | "hybrid";
  provenanceSources: Array<{ label: ProvenanceLabel; count: number; detail: string }>;
  provenanceSummary: string | null;
}

function hasSaronicSignal(signals: unknown[]): boolean {
  return signals.some((signal) => {
    const row = signal as { id?: unknown; entities?: unknown; artifact?: { headline?: unknown } };
    const text = [
      typeof row.id === "string" ? row.id : "",
      Array.isArray(row.entities) ? row.entities.join(" ") : "",
      typeof row.artifact?.headline === "string" ? row.artifact.headline : "",
    ].join(" ").toLowerCase();
    return text.includes("saronic");
  });
}

function withSignalProspects(companies: Company[], signals: unknown[], city: string | null): Company[] {
  const hasRealSaronic = companies.some((company) =>
    company.name.toLowerCase().includes("saronic") ||
    company.domains?.some((domain) => domain.toLowerCase() === "saronic.com"),
  );
  if (hasRealSaronic || !hasSaronicSignal(signals)) return companies;
  if (city && city !== "Austin") return companies;
  return [
    ...companies,
    {
      id: SARONIC_PROSPECT_ID,
      name: "Saronic Technologies",
      relationship: "target",
      account_status: "new_logo",
      business_motion: "prospect_new_business",
      location: {
        city: "Austin",
        state: "TX",
        country: "USA",
        lat: 30.2672,
        lon: -97.7431,
      },
      website_url: "https://www.saronic.com",
      source_url: "https://app.dealroom.co/news/note/saronic-raises-1-75b-at-9-25b-valuation-to-scale-autonomous-warships-for-us-navy",
      needs: [],
      domains: ["saronic.com"],
      aliases: ["Saronic"],
      known_programs: ["Corsair autonomous surface vessel"],
    },
  ];
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
      const companies = withSignalProspects(rawCompanies, signals, city);
      const usesArtifactSignals = DATA_MODE === "artifact" && snapshot?.publicSignals.source_mode === "artifact";
      const newsSignals = usesArtifactSignals ? [] : deriveNewsSignals(companies, NEWS, EXTRACTED);
      const analysis = analyze(companies, [...signals, ...newsSignals]);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      const liveStatus = DATA_MODE === "live" ? liveAdapterStatus() : { errors: [], provenance: null };
      const draft = {
        city,
        companies,
        contacts,
        facilities,
        opportunities,
        analysis,
        prospects,
        snapshot,
        dataSource: DATA_MODE === "live" ? liveStatus.provenance ?? "Live CRM" : null,
        loadErrors: DATA_MODE === "live" || DATA_MODE === "hybrid" ? liveAdapterStatus().errors : [],
        dataMode: DATA_MODE,
        provenanceSources: [] as Array<{ label: ProvenanceLabel; count: number; detail: string }>,
        provenanceSummary: null as string | null,
      };
      draft.provenanceSources = DATA_MODE === "hybrid" ? provenanceCounts(draft) : [];
      draft.provenanceSummary = DATA_MODE === "hybrid" ? provenanceSummary(draft) : null;
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
