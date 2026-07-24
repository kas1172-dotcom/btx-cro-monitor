// Loads + analyzes the world for a given region (city) through the backend
// WorldSnapshot contract. The frontend never swaps in fixture records when a
// backend source is missing.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getScoringConfigVersion, subscribeScoringConfig } from "./config.ts";
import { provenanceCounts, provenanceSummary, type ProvenanceLabel } from "./provenance.ts";
import { analyze, buildProspects } from "./intelligence.ts";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";
import { operatingSnapshotFromWorld, revenueDataClient, type ScoreFamilies, type WorldSnapshot } from "./revenueDataClient.ts";

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
  worldSnapshot: WorldSnapshot | null;
  scoreResults: ScoreFamilies | null;
  dataSource: string | null;
  loadErrors: string[];
  provenanceSources: Array<{ label: ProvenanceLabel; count: number; detail: string }>;
  provenanceSummary: string | null;
}

function filterByCity<T extends { location?: { city?: string | null }; city?: string | null }>(records: T[], city: string | null): T[] {
  if (!city) return records;
  return records.filter((record) => (record.location?.city ?? record.city ?? "").toLowerCase() === city.toLowerCase());
}

function emptyWorld(city: string | null, message: string): World {
  const analysis = analyze([], []);
  return {
    city,
    companies: [],
    contacts: [],
    facilities: [],
    opportunities: [],
    analysis,
    prospects: [],
    snapshot: null,
    worldSnapshot: null,
    scoreResults: null,
    dataSource: "Backend world snapshot",
    loadErrors: [message],
    provenanceSources: [],
    provenanceSummary: null,
  };
}

export function useWorld(city: string | null): World | null {
  const [world, setWorld] = useState<World | null>(null);
  const configVersion = useSyncExternalStore(subscribeScoringConfig, getScoringConfigVersion, getScoringConfigVersion);

  useEffect(() => {
    let alive = true;
    void revenueDataClient.getWorldSnapshot().then((worldSnapshot) => {
      if (!alive) return;
      const companies = filterByCity(worldSnapshot.accounts, city);
      const companyIds = new Set(companies.map((company) => company.id));
      const resolvedSignals = city
        ? worldSnapshot.signals.filter((signal) => !signal.subject_id || companyIds.has(signal.subject_id))
        : worldSnapshot.signals;
      const contacts = city ? worldSnapshot.contacts.filter((contact) => companyIds.has(contact.company_id)) : worldSnapshot.contacts;
      const facilities = filterByCity(worldSnapshot.facilities, city);
      const opportunities = city ? worldSnapshot.opportunities.filter((opportunity) => companyIds.has(opportunity.company_id)) : worldSnapshot.opportunities;
      const analysis = analyze(companies, resolvedSignals);
      const prospects = buildProspects(companies, contacts, analysis.valid, analysis.byId);
      const draft = {
        city,
        companies,
        contacts,
        facilities,
        opportunities,
        analysis,
        prospects,
        snapshot: operatingSnapshotFromWorld(worldSnapshot),
        worldSnapshot,
        scoreResults: worldSnapshot.scores,
        dataSource: "Backend world snapshot",
        loadErrors: worldSnapshot.sourceHealth
          .filter((source) => source.availability === "error" || source.availability === "unavailable")
          .map((source) => `${source.displayName}: ${source.errorMessage ?? source.availability}`),
        provenanceSources: [] as Array<{ label: ProvenanceLabel; count: number; detail: string }>,
        provenanceSummary: null as string | null,
      };
      draft.provenanceSources = provenanceCounts(draft);
      draft.provenanceSummary = provenanceSummary(draft);
      setWorld({
        ...draft,
      });
    }).catch((error) => {
      if (alive) setWorld(emptyWorld(city, error instanceof Error ? error.message : "Could not load backend world snapshot."));
    });
    return () => {
      alive = false;
    };
  }, [city, configVersion]);

  return world;
}
