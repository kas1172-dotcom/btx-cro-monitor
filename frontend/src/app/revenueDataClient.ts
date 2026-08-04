import { backendJson } from "./backendApi.ts";
import type { Analysis, Prospect } from "./intelligence.ts";
import type { ProvenanceLabel } from "./provenance.ts";
import type { WorkItem } from "./workItems.ts";
import type { Company, Contact, Facility, Opportunity } from "../engine/brain/entities.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";
import type { Signal } from "../engine/signals/contract.ts";
import type { SignalRelationship } from "../engine/signals/contract.ts";
import type { ConnectionMode, DataMode, SourceEnvironment } from "./sourceRegistry.ts";

export type SourceAvailability = "available" | "stale" | "unavailable" | "not_configured" | "error" | "simulated";

export interface SourceHealth {
  sourceKey: string;
  displayName: string;
  availability: SourceAvailability;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  freshnessThresholdMinutes: number | null;
  recordCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  connectionMode?: ConnectionMode;
  environment?: SourceEnvironment;
  dataMode?: DataMode;
  canRead?: boolean;
  canWrite?: boolean;
  writeBlockReason?: string | null;
}

export interface TenantSummary {
  id: string;
  displayName: string;
  isDemonstration?: boolean;
  demoReferenceDate?: string | null;
  demoNotice?: string | null;
}

export type ScoreStatus = "available" | "insufficient_data" | "provisional" | "disqualified";
export type DataClassification = "public" | "derived" | "crm" | "operational" | "manual" | "simulated";

export interface ScoreFactor {
  key: string;
  label: string;
  rawValue: number | string | boolean | null;
  normalizedValue: number | null;
  weight: number;
  contribution: number | null;
  direction: "positive" | "negative" | "neutral";
  sourceClassification: DataClassification;
  sourceRecordIds: string[];
  evidenceIds: string[];
  explanation: string;
}

export interface ScoreResult {
  score: number | null;
  status: ScoreStatus;
  dataCompleteness: number;
  positiveFactors: ScoreFactor[];
  negativeFactors: ScoreFactor[];
  neutralFactors: ScoreFactor[];
  missingInputs: string[];
  hardGateFailures: string[];
  evidenceIds: string[];
  configurationVersion: string;
  sourceDataVersion: string;
  calculatedAt: string;
}

export interface ScoreSnapshot {
  id: string;
  entityType: "account" | "signal" | "opportunity" | string;
  entityId: string;
  scoreFamily: keyof ScoreFamilies | string;
  status: ScoreStatus;
  score: number | null;
  result: ScoreResult;
  configurationVersion: string;
  sourceDataVersion: string;
  calculatedAt: string;
}

export interface ScoreFamilies {
  accountAttractiveness: ScoreSnapshot[];
  signalConfidence: ScoreSnapshot[];
  pursuitPwin: ScoreSnapshot[];
  deliveryFeasibility: ScoreSnapshot[];
  relationshipHealth: ScoreSnapshot[];
  actionPriority: ScoreSnapshot[];
}

export interface WorldSnapshot {
  tenant: TenantSummary;
  accounts: Company[];
  canonicalAccounts?: Company[];
  accountIdentifiers?: unknown[];
  contacts: Contact[];
  opportunities: Opportunity[];
  programs: unknown[];
  signals: Signal[];
  signalRelationships: SignalRelationship[];
  relationshipReview?: { records: SignalRelationship[]; minimumRelationshipConfidence: number };
  facilities: Facility[];
  operatingFacts: unknown[];
  capacity: unknown | null;
  scores: ScoreFamilies;
  scoreHistory?: { records: ScoreSnapshot[] };
  scoringConfiguration?: { version: string; minimumRelationshipConfidence: number };
  workItems: WorkItem[];
  deliverables: Array<{
    id: string;
    type: string;
    title: string;
    canonical_account_id: string | null;
    program_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
  sourceHealth: SourceHealth[];
  generatedAt: string;
  dataVersion: string;
}

export interface WorkItemFilters {
  view?: string;
  account?: string;
  status?: string;
  owner?: string;
}

export type WorkItemPatch = Partial<Pick<WorkItem, "owner" | "priority" | "due_date" | "recommended_action" | "description" | "generated_artifact_ref" | "follow_up_date">>;
export type WorkItemActionRequest = Record<string, unknown>;
export type WorkItemActionResult = Record<string, unknown>;
export type DeliverableFilters = { account?: string; type?: string };
export type DeliverableSummary = WorldSnapshot["deliverables"][number];
export type AskRequest = Record<string, unknown>;
export type AskResponse = Record<string, unknown>;

export type RevenueDataClient = {
  getWorldSnapshot(signal?: AbortSignal): Promise<WorldSnapshot>;
  getWorkItems(filters?: WorkItemFilters): Promise<WorkItem[]>;
  getWorkItem(id: string): Promise<WorkItem>;
  updateWorkItem(id: string, patch: WorkItemPatch): Promise<WorkItem>;
  executeWorkItemAction(id: string, action: WorkItemActionRequest): Promise<WorkItemActionResult>;
  getDeliverables(filters?: DeliverableFilters): Promise<DeliverableSummary[]>;
  getDeliverable(id: string): Promise<unknown>;
  getSourceHealth(): Promise<SourceHealth[]>;
  ask(request: AskRequest): Promise<AskResponse>;
};

function query(params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export class BackendRevenueDataClient implements RevenueDataClient {
  getWorldSnapshot(signal?: AbortSignal): Promise<WorldSnapshot> {
    return backendJson<WorldSnapshot>("/world-snapshot", { signal });
  }

  async getWorkItems(filters: WorkItemFilters = {}): Promise<WorkItem[]> {
    const response = await backendJson<{ records: WorkItem[] }>(`/work-items${query(filters as Record<string, string | undefined>)}`);
    return response.records;
  }

  getWorkItem(id: string): Promise<WorkItem> {
    return backendJson<WorkItem>(`/work-items/${encodeURIComponent(id)}`);
  }

  updateWorkItem(id: string, patch: WorkItemPatch): Promise<WorkItem> {
    return backendJson<WorkItem>(`/work-items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  executeWorkItemAction(id: string, action: WorkItemActionRequest): Promise<WorkItemActionResult> {
    return backendJson<WorkItemActionResult>(`/work-items/${encodeURIComponent(id)}/execute/hubspot-task`, {
      method: "POST",
      body: JSON.stringify(action),
    });
  }

  async getDeliverables(filters: DeliverableFilters = {}): Promise<DeliverableSummary[]> {
    const response = await backendJson<{ records: DeliverableSummary[] }>(`/deliverables${query(filters)}`);
    return response.records;
  }

  getDeliverable(id: string): Promise<unknown> {
    return backendJson<unknown>(`/deliverables/${encodeURIComponent(id)}`);
  }

  async getSourceHealth(): Promise<SourceHealth[]> {
    const response = await backendJson<{ records: SourceHealth[] }>("/source-health");
    return response.records;
  }

  ask(request: AskRequest): Promise<AskResponse> {
    return backendJson<AskResponse>("/assistant/ask", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

export const revenueDataClient = new BackendRevenueDataClient();

export function operatingSnapshotFromWorld(snapshot: WorldSnapshot): OperatingSnapshot {
  const latestSignalAt = snapshot.signals.map((signal) => signal.detected_at).filter(Boolean).sort().at(-1) ?? null;
  const monitor = snapshot.sourceHealth.find((source) => source.sourceKey === "monitor");
  const operating = snapshot.sourceHealth.find((source) => source.sourceKey === "operating");
  return {
    crm: [],
    capacity: [],
    pipeline: {
      as_of: snapshot.generatedAt,
      summary: {
        open_pipeline_value: snapshot.opportunities.reduce((total, item) => total + (item.value ?? 0), 0),
        weighted_pipeline_value: 0,
        priority_accounts: [],
        top_action: snapshot.workItems[0]?.recommended_action ?? "No backend work item is ready.",
      },
      records: [],
      source_type: "backend",
      source_name: "Backend world snapshot",
      source_mode: "backend",
    },
    integrations: snapshot.sourceHealth.map((source) => ({
      id: source.sourceKey,
      name: source.displayName,
      category: source.sourceKey.includes("hubspot") ? "CRM" : source.sourceKey === "monitor" ? "Market signals" : "Operating data",
      status: source.availability === "available" ? "connected" : source.availability === "not_configured" ? "not_connected" : "available",
      source_ref: source.sourceKey,
      production_method: source.availability,
      description: source.errorMessage ?? `${source.displayName} status is ${source.availability}.`,
      source_kind: source.availability === "simulated" ? "planned" : source.sourceKey.includes("hubspot") ? "live" : source.sourceKey === "monitor" ? "monitor" : "planned",
    })),
    assumptions: {
      as_of: snapshot.generatedAt.slice(0, 10),
      is_seeded_baseline: false,
      summary: operating?.errorMessage ?? "Operating data is provided only by connected backend sources.",
      assumptions: [],
      source_type: "backend",
      source_name: "Backend world snapshot",
      source_mode: operating?.availability ?? "not_configured",
    },
    publicSignals: {
      signal_count: snapshot.signals.length,
      news_count: snapshot.signals.length,
      latest_signal_at: latestSignalAt,
      latest_news_date: latestSignalAt,
      source_name: monitor?.displayName ?? "Monitor pipeline",
      source_mode: monitor?.availability ?? "unavailable",
      run_at: monitor?.lastSuccessfulSyncAt,
      stale: monitor?.availability === "stale",
      notice: monitor && monitor.availability !== "available" && monitor.availability !== "stale" ? monitor.errorMessage : null,
    },
  };
}

export interface RuntimeWorld {
  city: string | null;
  companies: Company[];
  contacts: Contact[];
  facilities: Facility[];
  opportunities: Opportunity[];
  analysis: Analysis;
  prospects: Prospect[];
  snapshot: OperatingSnapshot | null;
  worldSnapshot: WorldSnapshot;
  dataSource: string | null;
  loadErrors: string[];
  provenanceSources: Array<{ label: ProvenanceLabel; count: number; detail: string }>;
  provenanceSummary: string | null;
}
