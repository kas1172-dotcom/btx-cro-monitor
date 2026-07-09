// Artifact mode is a static GitHub Pages-safe hybrid: Vite bundles the
// monitor-engine JSON artifacts into the app at build time, while CRM-side data
// continues to come from the demo adapter until a client provides live CRM data.

import runOutputData from "../../../../clients/btx/artifacts/run_output.json";
import archiveData from "../../../../clients/btx/artifacts/archive.json";
import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";
import { DemoDataAdapter } from "../demo/DemoDataAdapter.ts";
import { buildArtifactSignals, type ArtifactArchive, type ArtifactMappingResult } from "./artifactSignals.ts";

const ARTIFACT_PATH = "clients/btx/artifacts/run_output.json";
const STALE_DAYS = 7;

function isStale(runAt: string): boolean {
  const ageMs = Date.now() - Date.parse(runAt);
  return Number.isFinite(ageMs) && ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export class ArtifactDataAdapter implements DataAdapter {
  private demo = new DemoDataAdapter();
  private artifact: ArtifactMappingResult | null | undefined;
  private artifactError: string | null = null;

  private async artifactState(): Promise<ArtifactMappingResult | null> {
    if (this.artifact !== undefined) return this.artifact;
    try {
      const companies = await this.demo.getCompanies();
      this.artifact = buildArtifactSignals(runOutputData, companies);
      this.artifactError = this.artifact.signals.length ? null : "Artifact parsed, but no valid signal rows mapped.";
    } catch (error) {
      this.artifact = null;
      this.artifactError = error instanceof Error ? error.message : "Artifact could not be parsed.";
    }
    return this.artifact;
  }

  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return this.demo.getCompanies(filter);
  }

  async getSignals(filter?: RegionFilter): Promise<unknown[]> {
    const artifact = await this.artifactState();
    if (!artifact || !artifact.signals.length) return this.demo.getSignals(filter);
    if (!filter?.city) return artifact.signals;
    const ids = new Set((await this.getCompanies(filter)).map((company) => company.id));
    return artifact.signals.filter((signal) => ids.has(signal.subject_id));
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    return this.demo.getContacts(filter);
  }

  async getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    return this.demo.getFacilities(filter);
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    return this.demo.getOpportunities(filter);
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    const [snapshot, artifact] = await Promise.all([
      this.demo.getOperatingSnapshot(),
      this.artifactState(),
    ]);
    const archive = archiveData as ArtifactArchive;
    if (!artifact || !artifact.signals.length) {
      return {
        ...snapshot,
        publicSignals: {
          ...snapshot.publicSignals,
          source_mode: "artifact_fallback",
          artifact_path: ARTIFACT_PATH,
          notice: `Artifact mode requested, but ${this.artifactError ?? "artifact signals were unavailable"}. Falling back to demo signals.`,
        },
      };
    }
    return {
      ...snapshot,
      publicSignals: {
        signal_count: artifact.signals.length,
        news_count: artifact.signals.length,
        latest_signal_at: artifact.latestPublishedAt,
        latest_news_date: artifact.latestPublishedAt,
        source_name: `Monitor engine artifacts (${artifact.sourceCount} sources)`,
        source_mode: "artifact",
        run_at: artifact.runAt,
        archive_run_count: Array.isArray(archive.runs) ? archive.runs.length : 0,
        artifact_path: ARTIFACT_PATH,
        stale: isStale(artifact.runAt),
        notice: null,
      },
    };
  }
}
