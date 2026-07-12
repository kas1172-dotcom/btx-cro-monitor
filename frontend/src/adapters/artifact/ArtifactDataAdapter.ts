// Artifact mode is a static GitHub Pages-safe hybrid: the production cockpit
// fetches the latest monitor-engine JSON artifacts from the same Pages deploy,
// while local/dev builds fall back to Vite-bundled artifacts. CRM-side data
// continues to come from the demo adapter until a client provides live CRM data.

import runOutputData from "../../../../clients/btx/artifacts/run_output.json";
import archiveData from "../../../../clients/btx/artifacts/archive.json";
import type { DataAdapter, RegionFilter } from "../../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../../engine/brain/operatingSnapshot.ts";
import { BACKEND_ENDPOINT, backendJson } from "../../app/backendApi.ts";
import { DemoDataAdapter } from "../demo/DemoDataAdapter.ts";
import { buildArtifactSignals, type ArtifactArchive, type ArtifactMappingResult } from "./artifactSignals.ts";

const env = (import.meta as ImportMeta & { env?: { VITE_ARTIFACT_BASE_URL?: string } }).env;
const DEFAULT_ARTIFACT_BASE_URL = "../btx";
const ARTIFACT_BASE_URL = (env?.VITE_ARTIFACT_BASE_URL ?? DEFAULT_ARTIFACT_BASE_URL).replace(/\/$/, "");
const PUBLISHED_RUN_OUTPUT_PATH = `${ARTIFACT_BASE_URL}/run_output.json`;
const PUBLISHED_ARCHIVE_PATH = `${ARTIFACT_BASE_URL}/archive.json`;
const BUNDLED_ARTIFACT_PATH = "clients/btx/artifacts/run_output.json";
const STALE_DAYS = 7;

type LoadedArtifacts = {
  archive: ArtifactArchive;
  artifactPath: string;
  runOutput: unknown;
  source: "backend" | "published" | "bundled";
};

interface BackendArtifactPayload {
  artifact_path?: string;
  archive?: ArtifactArchive;
  run_output?: unknown;
}

function isStale(runAt: string): boolean {
  const ageMs = Date.now() - Date.parse(runAt);
  return Number.isFinite(ageMs) && ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export class ArtifactDataAdapter implements DataAdapter {
  private demo = new DemoDataAdapter();
  private artifact: ArtifactMappingResult | null | undefined;
  private artifactError: string | null = null;
  private artifacts: Promise<LoadedArtifacts[]> | undefined;
  private activeArtifacts: LoadedArtifacts | null = null;

  constructor(private accountProvider: Pick<DataAdapter, "getCompanies"> = new DemoDataAdapter()) {}

  private async backendArtifacts(): Promise<LoadedArtifacts | null> {
    if (!BACKEND_ENDPOINT) return null;
    try {
      const payload = await backendJson<BackendArtifactPayload>("/artifacts/latest");
      if (!payload.run_output) throw new Error("Backend artifact payload missing run_output");
      return {
        archive: payload.archive ?? { runs: [], pinned: [] },
        artifactPath: payload.artifact_path ?? `${BACKEND_ENDPOINT}/artifacts/latest`,
        runOutput: payload.run_output,
        source: "backend",
      };
    } catch {
      return null;
    }
  }

  private async publishedArtifacts(): Promise<LoadedArtifacts | null> {
    try {
      const [runOutputResponse, archiveResponse] = await Promise.all([
        fetch(PUBLISHED_RUN_OUTPUT_PATH, { cache: "no-store" }),
        fetch(PUBLISHED_ARCHIVE_PATH, { cache: "no-store" }),
      ]);
      if (!runOutputResponse.ok) {
        throw new Error(`Published artifact fetch failed: ${runOutputResponse.status} ${runOutputResponse.statusText}`);
      }
      if (!archiveResponse.ok) {
        throw new Error(`Published archive fetch failed: ${archiveResponse.status} ${archiveResponse.statusText}`);
      }
      return {
        archive: (await archiveResponse.json()) as ArtifactArchive,
        artifactPath: PUBLISHED_RUN_OUTPUT_PATH,
        runOutput: await runOutputResponse.json(),
        source: "published",
      };
    } catch {
      return null;
    }
  }

  private async artifactCandidates(): Promise<LoadedArtifacts[]> {
    if (!this.artifacts) {
      this.artifacts = (async () => {
        const backend = await this.backendArtifacts();
        const published = await this.publishedArtifacts();
        const bundled: LoadedArtifacts = {
          archive: archiveData as ArtifactArchive,
          artifactPath: BUNDLED_ARTIFACT_PATH,
          runOutput: runOutputData,
          source: "bundled",
        };
        return [backend, published, bundled].filter((candidate): candidate is LoadedArtifacts => Boolean(candidate));
      })();
    }
    return this.artifacts;
  }

  private async artifactState(): Promise<ArtifactMappingResult | null> {
    if (this.artifact !== undefined) return this.artifact;
    const errors: string[] = [];
    const companies = await this.accountProvider.getCompanies();
    for (const candidate of await this.artifactCandidates()) {
      try {
        const artifact = buildArtifactSignals(candidate.runOutput, companies);
        if (!artifact.signals.length) {
          errors.push(`${candidate.source} artifact parsed, but no valid signal rows mapped.`);
          continue;
        }
        this.activeArtifacts = candidate;
        this.artifact = artifact;
        this.artifactError = null;
        return this.artifact;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${candidate.source} artifact could not be parsed.`);
      }
    }
    this.activeArtifacts = null;
    this.artifact = null;
    this.artifactError = errors.join(" ");
    return this.artifact;
  }

  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return this.accountProvider.getCompanies(filter);
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
    const archive = this.activeArtifacts?.archive ?? (archiveData as ArtifactArchive);
    const artifactPath = this.activeArtifacts?.artifactPath ?? PUBLISHED_RUN_OUTPUT_PATH;
    if (!artifact || !artifact.signals.length) {
      return {
        ...snapshot,
        publicSignals: {
          ...snapshot.publicSignals,
          source_mode: "artifact_fallback",
          artifact_path: artifactPath,
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
        artifact_path: artifactPath,
        stale: isStale(artifact.runAt),
        notice: null,
      },
    };
  }
}
