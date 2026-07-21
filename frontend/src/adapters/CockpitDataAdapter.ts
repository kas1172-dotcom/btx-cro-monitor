import runOutputData from "../../../clients/btx/artifacts/run_output.json";
import archiveData from "../../../clients/btx/artifacts/archive.json";
import companiesData from "../../data/demo/btx/companies.json";
import signalsData from "../../data/demo/btx/signals.json";
import contactsData from "../../data/demo/btx/contacts.json";
import facilitiesData from "../../data/demo/btx/facilities.json";
import opportunitiesData from "../../data/demo/btx/opportunities.json";
import crmData from "../../data/demo/btx/crm.json";
import capacityData from "../../data/demo/btx/erp_capacity.json";
import pipelineData from "../../data/demo/btx/pipeline.json";
import integrationsData from "../../data/demo/btx/integrations.json";
import assumptionsData from "../../data/demo/btx/assumptions.json";
import newsData from "../../data/demo/btx/news.json";
import type { DataAdapter, RegionFilter } from "../engine/brain/ports.ts";
import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { AssumptionsSnapshot, CapacitySnapshotRecord, CrmSnapshotRecord, IntegrationRecord, OperatingSnapshot, PipelineSnapshot } from "../engine/brain/operatingSnapshot.ts";
import { BACKEND_ENDPOINT, backendHeaders, backendJson } from "../app/backendApi.ts";
import { buildArtifactSignals, type ArtifactArchive, type ArtifactMappingResult } from "./artifact/artifactSignals.ts";

const env = (import.meta as ImportMeta & { env?: { VITE_ARTIFACT_BASE_URL?: string } }).env;
const MONITOR_BASE_URL = (env?.VITE_ARTIFACT_BASE_URL ?? "../btx").replace(/\/$/, "");
const PUBLISHED_RUN_OUTPUT_PATH = `${MONITOR_BASE_URL}/run_output.json`;
const PUBLISHED_ARCHIVE_PATH = `${MONITOR_BASE_URL}/archive.json`;
const BUNDLED_RUN_OUTPUT_PATH = "clients/btx/artifacts/run_output.json";
const BASELINE_SOURCE = "Seeded baseline — ERP integration pending";
const STALE_DAYS = 7;

const SEEDED_COMPANIES = companiesData as unknown as Company[];
const SEEDED_SIGNALS = signalsData as unknown as Array<{ subject_id: string; detected_at?: string }>;
const SEEDED_CONTACTS = contactsData as unknown as Contact[];
const SEEDED_FACILITIES = facilitiesData as unknown as Facility[];
const SEEDED_OPPORTUNITIES = opportunitiesData as unknown as Opportunity[];
const SEEDED_CRM = crmData as CrmSnapshotRecord[];
const SEEDED_CAPACITY = capacityData as CapacitySnapshotRecord[];
const SEEDED_PIPELINE = pipelineData as PipelineSnapshot;
const SEEDED_INTEGRATIONS = integrationsData as Array<Partial<IntegrationRecord> & { demo_file?: string }>;
const SEEDED_ASSUMPTIONS = assumptionsData as unknown as AssumptionsSnapshot;
const NEWS = newsData as Array<{ published_date?: string }>;

const state = {
  errors: [] as string[],
  provenance: "HubSpot + Monitor artifacts + seeded baseline",
};

interface RuntimeResponse<T> {
  data_provenance?: string;
  records: T[];
}

interface BaselinePayload {
  data_provenance?: string;
  crm: CrmSnapshotRecord[];
  capacity: CapacitySnapshotRecord[];
  pipeline: PipelineSnapshot;
  integrations: Array<Partial<IntegrationRecord> & { demo_file?: string }>;
  assumptions: AssumptionsSnapshot;
  facilities: Facility[];
  opportunities: Opportunity[];
}

interface MonitorPayload {
  artifact_path?: string;
  archive?: ArtifactArchive;
  run_output?: unknown;
}

type LoadedMonitor = {
  archive: ArtifactArchive;
  path: string;
  runOutput: unknown;
  source: "backend" | "published" | "bundled";
};

export function cockpitAdapterStatus(): { errors: string[]; provenance: string } {
  return { errors: [...state.errors], provenance: state.provenance };
}

function rememberError(message: string): void {
  if (!state.errors.includes(message)) state.errors.push(message);
}

function applyFilter<T extends { company_id?: string; location?: { city?: string }; city?: string }>(
  records: T[],
  filter?: RegionFilter,
  companies?: Company[],
): T[] {
  if (!filter?.city) return records;
  if ("location" in (records[0] ?? {})) return records.filter((record) => record.location?.city === filter.city);
  if ("city" in (records[0] ?? {})) return records.filter((record) => record.city === filter.city);
  const ids = new Set((companies ?? []).filter((company) => company.location.city === filter.city).map((company) => company.id));
  return records.filter((record) => record.company_id ? ids.has(record.company_id) : true);
}

export function normalizeCompanies(response: RuntimeResponse<Company>): Company[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((company) => ({
    ...company,
    canonical_account_id: company.canonical_account_id ?? company.id,
    hubspot_company_id: company.hubspot_company_id ?? (company as { hubspot_id?: string }).hubspot_id,
    relationship: company.relationship ?? "target",
    location: {
      city: company.location?.city ?? "Unknown",
      lat: company.location?.lat ?? 0,
      lon: company.location?.lon ?? 0,
      address: company.location?.address,
      state: company.location?.state,
      postal_code: company.location?.postal_code,
      country: company.location?.country,
    },
    needs: company.needs ?? [],
  }));
}

export function normalizeContacts(response: RuntimeResponse<Contact>): Contact[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((contact) => ({ ...contact, title: contact.title || "Contact" }));
}

export function normalizeOpportunities(response: RuntimeResponse<Opportunity>): Opportunity[] {
  state.provenance = response.data_provenance ?? state.provenance;
  return response.records.map((opportunity) => ({
    ...opportunity,
    value: Number.isFinite(Number(opportunity.value)) ? Number(opportunity.value) : 0,
    stage: opportunity.stage ?? "prospecting",
    close_date: opportunity.close_date || new Date().toISOString().slice(0, 10),
  }));
}

function seededIntegrations(): IntegrationRecord[] {
  return [
    {
      id: "hubspot",
      name: "HubSpot CRM",
      category: "CRM",
      status: "connected",
      source_ref: "btx_platform CRM adapter",
      production_method: "Authenticated backend read",
      description: "Companies, contacts, and deals are read from the backend CRM adapter when available.",
      source_kind: "live",
    },
    {
      id: "monitor",
      name: "Monitor artifacts",
      category: "Market signals",
      status: "connected",
      source_ref: PUBLISHED_RUN_OUTPUT_PATH,
      production_method: "Monitor engine output",
      description: "Public market signals are generated by the monitor pipeline and read by the cockpit.",
      source_kind: "monitor",
    },
    ...SEEDED_INTEGRATIONS.map((item) => ({
      id: item.id ?? "seeded-baseline",
      name: item.name ?? "Seeded baseline",
      category: item.category ?? "Operating baseline",
      status: (item.status === "future" ? "future" : "available") as IntegrationRecord["status"],
      source_ref: item.demo_file ?? "frontend/data/demo/btx/",
      production_method: item.production_method ?? "Backend-served seeded baseline",
      description: item.description ?? BASELINE_SOURCE,
      source_kind: "seeded" as const,
    })),
  ];
}

function normalizeBaseline(payload: BaselinePayload): OperatingSnapshot {
  const stamp = <T extends { source_name?: string; source_type?: string; source_mode?: string }>(row: T): T => ({
    ...row,
    source_type: "seeded_baseline",
    source_name: BASELINE_SOURCE,
    source_mode: "seeded_baseline",
  });
  return {
    crm: payload.crm.map(stamp) as CrmSnapshotRecord[],
    capacity: payload.capacity.map(stamp) as CapacitySnapshotRecord[],
    pipeline: {
      ...stamp(payload.pipeline),
      records: payload.pipeline.records.map(stamp) as PipelineSnapshot["records"],
    } as PipelineSnapshot,
    integrations: seededIntegrations(),
    assumptions: {
      ...stamp(payload.assumptions),
      summary: BASELINE_SOURCE,
      is_seeded_baseline: true,
    } as AssumptionsSnapshot,
    publicSignals: {
      signal_count: SEEDED_SIGNALS.length,
      news_count: NEWS.length,
      latest_signal_at: SEEDED_SIGNALS.map((signal) => signal.detected_at).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
      latest_news_date: NEWS.map((item) => item.published_date).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
      source_name: "Monitor artifacts",
      source_mode: "monitor_pending",
      notice: null,
    },
  };
}

function localBaseline(): BaselinePayload {
  return {
    data_provenance: BASELINE_SOURCE,
    crm: SEEDED_CRM,
    capacity: SEEDED_CAPACITY,
    pipeline: SEEDED_PIPELINE,
    integrations: SEEDED_INTEGRATIONS,
    assumptions: SEEDED_ASSUMPTIONS,
    facilities: SEEDED_FACILITIES,
    opportunities: SEEDED_OPPORTUNITIES,
  };
}

function stale(runAt: string): boolean {
  const ageMs = Date.now() - Date.parse(runAt);
  return Number.isFinite(ageMs) && ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export class CockpitDataAdapter implements DataAdapter {
  private baselinePromise: Promise<BaselinePayload> | undefined;
  private monitorPromise: Promise<LoadedMonitor[]> | undefined;
  private monitorState: ArtifactMappingResult | null | undefined;
  private monitorError: string | null = null;
  private activeMonitor: LoadedMonitor | null = null;

  private async baseline(): Promise<BaselinePayload> {
    if (!this.baselinePromise) {
      this.baselinePromise = backendJson<BaselinePayload>("/operating-baseline").catch((error) => {
        rememberError(error instanceof Error ? error.message : "Operating baseline unavailable.");
        return localBaseline();
      });
    }
    return this.baselinePromise;
  }

  private async getJson<T>(path: string): Promise<T> {
    if (!BACKEND_ENDPOINT) throw new Error("Backend endpoint is not configured.");
    const response = await fetch(`${BACKEND_ENDPOINT}${path}`, { headers: await backendHeaders() });
    if (!response.ok) throw new Error(`Backend ${path} failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  private async load<T>(path: string, normalize: (response: RuntimeResponse<T>) => T[], fallback: T[]): Promise<T[]> {
    try {
      return normalize(await this.getJson<RuntimeResponse<T>>(path));
    } catch (error) {
      rememberError(error instanceof Error ? error.message : `Backend ${path} failed.`);
      return fallback;
    }
  }

  async getCompanies(filter?: RegionFilter): Promise<Company[]> {
    return applyFilter(await this.load("/crm/accounts", normalizeCompanies, SEEDED_COMPANIES), filter);
  }

  async getContacts(filter?: RegionFilter): Promise<Contact[]> {
    const [contacts, companies] = await Promise.all([
      this.load("/crm/contacts", normalizeContacts, SEEDED_CONTACTS),
      this.getCompanies(),
    ]);
    return applyFilter(contacts, filter, companies);
  }

  async getOpportunities(filter?: RegionFilter): Promise<Opportunity[]> {
    const baseline = await this.baseline();
    const [opportunities, companies] = await Promise.all([
      this.load("/crm/deals", normalizeOpportunities, baseline.opportunities as Opportunity[]),
      this.getCompanies(),
    ]);
    return applyFilter(opportunities, filter, companies);
  }

  async getFacilities(filter?: RegionFilter): Promise<Facility[]> {
    return applyFilter((await this.baseline()).facilities, filter);
  }

  private async backendMonitor(): Promise<LoadedMonitor | null> {
    try {
      const payload = await backendJson<MonitorPayload>("/artifacts/latest");
      if (!payload.run_output) throw new Error("Monitor payload missing run_output");
      return {
        archive: payload.archive ?? { runs: [], pinned: [] },
        path: payload.artifact_path ?? `${BACKEND_ENDPOINT}/artifacts/latest`,
        runOutput: payload.run_output,
        source: "backend",
      };
    } catch {
      return null;
    }
  }

  private async publishedMonitor(): Promise<LoadedMonitor | null> {
    try {
      const [runOutputResponse, archiveResponse] = await Promise.all([
        fetch(PUBLISHED_RUN_OUTPUT_PATH, { cache: "no-store" }),
        fetch(PUBLISHED_ARCHIVE_PATH, { cache: "no-store" }),
      ]);
      if (!runOutputResponse.ok || !archiveResponse.ok) return null;
      return {
        archive: (await archiveResponse.json()) as ArtifactArchive,
        path: PUBLISHED_RUN_OUTPUT_PATH,
        runOutput: await runOutputResponse.json(),
        source: "published",
      };
    } catch {
      return null;
    }
  }

  private async monitorCandidates(): Promise<LoadedMonitor[]> {
    if (!this.monitorPromise) {
      this.monitorPromise = (async () => {
        const backend = await this.backendMonitor();
        const published = await this.publishedMonitor();
        const bundled: LoadedMonitor = {
          archive: archiveData as ArtifactArchive,
          path: BUNDLED_RUN_OUTPUT_PATH,
          runOutput: runOutputData,
          source: "bundled",
        };
        return [backend, published, bundled].filter((candidate): candidate is LoadedMonitor => Boolean(candidate));
      })();
    }
    return this.monitorPromise;
  }

  private async monitorSignals(): Promise<ArtifactMappingResult | null> {
    if (this.monitorState !== undefined) return this.monitorState;
    const errors: string[] = [];
    const companies = await this.getCompanies();
    for (const candidate of await this.monitorCandidates()) {
      try {
        const mapped = buildArtifactSignals(candidate.runOutput, companies, { includePinnedSignals: true });
        if (!mapped.signals.length) {
          errors.push(`${candidate.source} monitor output parsed, but no valid signal rows mapped.`);
          continue;
        }
        this.activeMonitor = candidate;
        this.monitorState = mapped;
        this.monitorError = null;
        return mapped;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${candidate.source} monitor output could not be parsed.`);
      }
    }
    this.activeMonitor = null;
    this.monitorState = null;
    this.monitorError = errors.join(" ");
    rememberError(this.monitorError || "Monitor output unavailable.");
    return null;
  }

  async getSignals(filter?: RegionFilter): Promise<unknown[]> {
    const monitor = await this.monitorSignals();
    if (!monitor?.signals.length) {
      if (!filter?.city) return SEEDED_SIGNALS;
      const ids = new Set(SEEDED_COMPANIES.filter((company) => company.location.city === filter.city).map((company) => company.id));
      return SEEDED_SIGNALS.filter((signal) => ids.has(signal.subject_id));
    }
    if (!filter?.city) return monitor.signals;
    const ids = new Set((await this.getCompanies(filter)).map((company) => company.id));
    const city = filter.city.toLowerCase();
    return monitor.signals.filter((signal) => {
      if (ids.has(signal.subject_id)) return true;
      const text = [
        signal.artifact?.headline,
        signal.artifact?.analysis_text,
        signal.source_quote,
        signal.entities.join(" "),
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(city);
    });
  }

  async getOperatingSnapshot(): Promise<OperatingSnapshot> {
    const [baselinePayload, monitor] = await Promise.all([this.baseline(), this.monitorSignals()]);
    const snapshot = normalizeBaseline(baselinePayload);
    const archive = this.activeMonitor?.archive ?? (archiveData as ArtifactArchive);
    const path = this.activeMonitor?.path ?? PUBLISHED_RUN_OUTPUT_PATH;
    if (!monitor?.signals.length) {
      return {
        ...snapshot,
        publicSignals: {
          ...snapshot.publicSignals,
          source_mode: "monitor_unavailable",
          artifact_path: path,
          notice: this.monitorError ?? "Monitor output unavailable; seeded signals are being used.",
        },
      };
    }
    return {
      ...snapshot,
      publicSignals: {
        signal_count: monitor.signals.length,
        news_count: monitor.signals.length,
        latest_signal_at: monitor.latestPublishedAt,
        latest_news_date: monitor.latestPublishedAt,
        source_name: `Monitor artifacts (${monitor.sourceCount} sources)`,
        source_mode: "monitor_output",
        run_at: monitor.runAt,
        archive_run_count: Array.isArray(archive.runs) ? archive.runs.length : 0,
        artifact_path: path,
        stale: stale(monitor.runAt),
        notice: null,
      },
    };
  }
}
