import type { AssistantCitation } from "./assistantApi.ts";
import { qualitativeSignalConfidence } from "./confidence.ts";
import { SCORE_FAMILY_LABELS } from "./presentation.ts";
import type { ScoreSnapshot } from "./revenueDataClient.ts";
import { humanSourceLabel, humanSourceReason } from "./sourceLabels.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "./signalProvenance.ts";
import type { World } from "./useWorld.ts";
import type { WorkItem } from "./workItems.ts";
import type { Deliverable, ProvenanceEntry } from "../deliverables/types.ts";
import type { Company } from "../engine/brain/entities.ts";
import type { Signal, SignalRelationship } from "../engine/signals/contract.ts";
import { relationshipAccountId, relationshipEvidenceIds, relationshipReviewStatus } from "../engine/signals/contract.ts";

export type EvidenceConclusion = "confirmed" | "supported" | "derived" | "inferred" | "unresolved";

export interface EvidenceRecord {
  id: string;
  title: string;
  publisher: string;
  publicationDate: string | null;
  eventDate: string | null;
  updatedAt: string | null;
  summary: string;
  classification: string;
  route: string | null;
  externalUrl?: string | null;
}

export interface EvidenceScoreContribution {
  family: string;
  status: string;
  value: string;
  positiveFactors: string[];
  negativeFactors: string[];
  missingInputs: string[];
  calculatedAt: string | null;
  configurationVersion: string | null;
  limitation: string;
}

export interface EvidencePackage {
  id: string;
  title: string;
  summary: string;
  conclusion: EvidenceConclusion;
  limitation: string;
  records: EvidenceRecord[];
  relationshipStatus?: string | null;
  scoreContribution?: EvidenceScoreContribution | null;
  contradictions: string[];
  advanced: Array<{ label: string; value: string }>;
  askPrompt: string;
}

function sentence(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) return fallback;
  return text.endsWith(".") ? text : `${text}.`;
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function accountName(world: World, accountId: string | null | undefined): string {
  if (!accountId) return "Portfolio";
  return world.companies.find((company) => company.id === accountId || company.canonical_account_id === accountId)?.name ?? "Account record unavailable";
}

function routeForSignal(signal: Signal): string | null {
  if (signal.scope === "specific_account" && signal.subject_id) return `/accounts/${encodeURIComponent(signal.subject_id)}`;
  if (signal.scope === "program") return "/programs";
  return "/programs";
}

function plainStatus(value: string | null | undefined): string {
  if (!value) return "Unresolved";
  if (value === "confirmed" || value === "accepted") return "Confirmed";
  if (value === "needs_review" || value === "unconfirmed") return "Awaiting review";
  if (value === "rejected") return "Rejected relationship";
  return value.replace(/_/g, " ");
}

function relationForSignal(signal: Signal): SignalRelationship | null {
  return (signal.relationships ?? []).find((relationship) => relationshipAccountId(relationship) === signal.subject_id) ?? signal.relationships?.[0] ?? null;
}

function recordFromSignal(signal: Signal): EvidenceRecord {
  return {
    id: signal.id,
    title: signalHeadline(signal),
    publisher: signalSourceName(signal),
    publicationDate: signal.artifact?.source_date ?? null,
    eventDate: signal.detected_at,
    updatedAt: signal.artifact?.run_at ?? signal.detected_at,
    summary: sentence(signal.source_quote, "No source excerpt is available."),
    classification: signal.artifact ? "Public monitor record" : "Internal evidence record",
    route: routeForSignal(signal),
    externalUrl: signal.source_url ?? signal.document_url ?? signal.artifact?.source_url ?? null,
  };
}

function scoreValue(score: ScoreSnapshot | null): string {
  if (!score || score.score === null || score.result.status === "insufficient_data") return "Unavailable";
  if (score.result.status === "provisional") return `${Math.round(score.score)} provisional`;
  if (score.result.status === "disqualified") return "Disqualified";
  return String(Math.round(score.score));
}

function scoreEvidence(world: World, score: ScoreSnapshot | null, familyLabel: string): EvidenceScoreContribution | null {
  if (!score) return null;
  const result = score.result;
  return {
    family: familyLabel,
    status: result.status.replace(/_/g, " "),
    value: scoreValue(score),
    positiveFactors: result.positiveFactors.map((factor) => `${factor.label}: ${factor.explanation}`).slice(0, 4),
    negativeFactors: result.negativeFactors.map((factor) => `${factor.label}: ${factor.explanation}`).slice(0, 4),
    missingInputs: result.missingInputs,
    calculatedAt: dateOrNull(result.calculatedAt),
    configurationVersion: result.configurationVersion,
    limitation: result.missingInputs.length
      ? `Missing inputs remain: ${result.missingInputs.slice(0, 3).join("; ")}.`
      : `Calculated from backend score snapshot for ${accountName(world, score.entityId)}.`,
  };
}

function signalsByIds(world: World, ids: string[]): Signal[] {
  const byId = new Map(world.analysis.valid.map((signal) => [signal.id, signal]));
  return ids.map((id) => byId.get(id)).filter((signal): signal is Signal => Boolean(signal));
}

export function buildSignalEvidence(world: World, signal: Signal): EvidencePackage {
  const relationship = relationForSignal(signal);
  const status = relationship ? plainStatus(relationshipReviewStatus(relationship)) : signal.scope === "specific_account" ? "Awaiting review" : "Market-level signal";
  const confirmed = status === "Confirmed";
  const evidenceIds = relationship ? relationshipEvidenceIds(relationship) : [];
  return {
    id: `signal-${signal.id}`,
    title: signalHeadline(signal),
    summary: signal.scope === "specific_account"
      ? `${accountName(world, signal.subject_id)} has a supported ${signal.event_type.replace(/_/g, " ")} development.`
      : `This is ${signal.scope ?? "market"} evidence and should not be treated as a confirmed account relationship.`,
    conclusion: confirmed ? "confirmed" : signal.scope === "specific_account" ? "unresolved" : "supported",
    limitation: confirmed ? "Account relationship is backed by reviewed evidence." : "This record is not a confirmed account relationship.",
    records: [recordFromSignal(signal)],
    relationshipStatus: status,
    contradictions: [
      ...(!confirmed && signal.scope === "specific_account" ? ["No confirmed account relationship is available yet."] : []),
      ...(evidenceIds.length === 0 && signal.scope === "specific_account" ? ["No relationship evidence ids are attached."] : []),
    ],
    advanced: [
      { label: "Signal id", value: signal.id },
      { label: "Scope", value: signal.scope ?? "market" },
      { label: "Confidence", value: qualitativeSignalConfidence(signal).label },
      { label: "Why this confidence", value: qualitativeSignalConfidence(signal).reason },
      { label: "Detected", value: dateOrNull(signal.detected_at) ?? signal.detected_at },
    ],
    askPrompt: `Explain this evidence and what BTX should do next. Signal: ${signalHeadline(signal)}. Evidence: ${signal.source_quote}`,
  };
}

export function buildScoreEvidence(world: World, score: ScoreSnapshot | null, familyKey: string, accountId: string): EvidencePackage {
  const familyLabel = SCORE_FAMILY_LABELS[familyKey as keyof typeof SCORE_FAMILY_LABELS] ?? familyKey.replace(/([A-Z])/g, " $1");
  const relatedSignals = signalsByIds(world, score?.result.evidenceIds ?? []);
  const contribution = scoreEvidence(world, score, familyLabel);
  return {
    id: `score-${familyKey}-${accountId}`,
    title: `${familyLabel} evidence`,
    summary: score ? `${familyLabel} is ${scoreValue(score)} for ${accountName(world, accountId)}.` : `${familyLabel} is unavailable for ${accountName(world, accountId)}.`,
    conclusion: score && score.score !== null ? "derived" : "unresolved",
    limitation: contribution?.limitation ?? "No backend score snapshot is available, so the value remains unavailable.",
    records: relatedSignals.length
      ? relatedSignals.map(recordFromSignal)
      : [{
          id: `score-${familyKey}-${accountId}`,
          title: `${familyLabel} score snapshot`,
          publisher: "Backend scoring service",
          publicationDate: null,
          eventDate: null,
          updatedAt: score?.calculatedAt ?? null,
          summary: contribution?.limitation ?? "No linked evidence records are available.",
          classification: score ? "Derived score snapshot" : "Missing score snapshot",
          route: `/accounts/${encodeURIComponent(accountId)}`,
        }],
    scoreContribution: contribution,
    relationshipStatus: null,
    contradictions: score?.result.hardGateFailures ?? [],
    advanced: [
      { label: "Score family", value: familyLabel },
      { label: "Configuration", value: score?.configurationVersion ?? "Unavailable" },
      { label: "Calculated", value: dateOrNull(score?.calculatedAt) ?? "Unavailable" },
    ],
    askPrompt: `Explain the ${familyLabel} score for ${accountName(world, accountId)} and identify missing information.`,
  };
}

export function buildWorkItemEvidence(world: World, item: WorkItem): EvidencePackage {
  const signals = signalsByIds(world, [item.related_signal_id, ...item.source_signal_ids].filter((id): id is string => Boolean(id)));
  return {
    id: `work-${item.id}`,
    title: `Evidence for work item`,
    summary: sentence(item.description, item.recommended_action),
    conclusion: item.source_signal_ids.length || item.generated_artifact_ref ? "supported" : "unresolved",
    limitation: item.missing_information.length ? `Missing information: ${item.missing_information.slice(0, 4).join("; ")}.` : "Work state and allowed actions remain backend-authoritative.",
    records: [
      ...signals.map(recordFromSignal),
      ...item.supporting_evidence.map((record, index) => ({
        id: String(record.id ?? `${item.id}-support-${index}`),
        title: String(record.title ?? record.source ?? "Supporting evidence"),
        publisher: String(record.publisher ?? record.system ?? "Internal record"),
        publicationDate: null,
        eventDate: null,
        updatedAt: item.updated_at,
        summary: String(record.summary ?? record.reason ?? record.id ?? "Supporting evidence attached to the work item."),
        classification: String(record.dataClassification ?? record.classification ?? "Internal record"),
        route: `/work/${encodeURIComponent(item.id)}`,
      })),
    ],
    relationshipStatus: item.related_relationship_id ? "Supported by internal records" : null,
    contradictions: item.missing_information,
    advanced: [
      { label: "Work item id", value: item.id },
      { label: "Status", value: item.status.replace(/_/g, " ") },
      { label: "Approval", value: item.approval_state.replace(/_/g, " ") },
      { label: "Execution", value: item.execution_state.replace(/_/g, " ") },
    ],
    askPrompt: `Explain this work item, its evidence, and the next safe action: ${item.recommended_action}`,
  };
}

export function buildAccountEvidence(world: World, company: Company, score: ScoreSnapshot | null, signals: Signal[]): EvidencePackage {
  return {
    id: `account-${company.id}`,
    title: `${company.name} recommendation evidence`,
    summary: `${company.name} is evaluated from account records, confirmed signals, open work, and backend score snapshots.`,
    conclusion: signals.length ? "supported" : "derived",
    limitation: signals.length ? "Confirmed account signals are shown separately from market context." : "No confirmed account development is attached yet.",
    records: signals.slice(0, 5).map(recordFromSignal),
    relationshipStatus: company.relationship === "customer" ? "Confirmed account relationship" : company.relationship,
    scoreContribution: scoreEvidence(world, score, SCORE_FAMILY_LABELS.accountAttractiveness),
    contradictions: score?.result.missingInputs ?? [],
    advanced: [
      { label: "Account id", value: company.id },
      { label: "Relationship", value: company.relationship },
      { label: "Account status", value: company.account_status ?? "Unavailable" },
    ],
    askPrompt: `Explain the recommendation for ${company.name}, what changed, and what information is missing.`,
  };
}

export function evidenceFromCitation(citation: AssistantCitation): EvidencePackage {
  return {
    id: `citation-${citation.id}`,
    title: citation.title,
    summary: citation.claim,
    conclusion: citation.claim_classification === "fact"
      ? "confirmed"
      : citation.claim_classification === "derived"
        ? "derived"
        : citation.claim_classification === "missing"
          ? "unresolved"
          : citation.claim_classification === "simulation"
            ? "inferred"
            : "inferred",
    limitation: citation.relationship_status ? `Relationship status: ${plainStatus(citation.relationship_status)}.` : "Citation reflects the assistant's internal retrieval record.",
    records: [{
      id: citation.record_id,
      title: citation.title,
      publisher: humanSourceLabel(citation.source_type),
      publicationDate: null,
      eventDate: null,
      updatedAt: null,
      summary: citation.claim,
      classification: citation.data_classification,
      route: citation.route,
    }],
    relationshipStatus: citation.relationship_status ? plainStatus(citation.relationship_status) : null,
    contradictions: citation.claim_classification === "missing" ? [citation.claim] : [],
    advanced: [
      { label: "Citation id", value: citation.id },
      { label: "Record id", value: citation.record_id },
      { label: "Claim classification", value: citation.claim_classification },
    ],
    askPrompt: `Explain this cited evidence and any limitations: ${citation.claim}`,
  };
}

export function evidenceFromDeliverableSource(deliverable: Deliverable, source: ProvenanceEntry): EvidencePackage {
  return {
    id: `deliverable-${deliverable.id}-${source.source}`,
    title: humanSourceLabel(source.source),
    summary: humanSourceReason(source.reason),
    conclusion: source.source === "user edits" ? "inferred" : "supported",
    limitation: source.records.length ? "The document links back to internal records already available in the workspace." : "No individual record ids are attached to this source entry.",
    records: source.records.map((record) => ({
      id: record,
      title: record,
      publisher: humanSourceLabel(source.source),
      publicationDate: null,
      eventDate: null,
      updatedAt: deliverable.createdAt,
      summary: humanSourceReason(source.reason),
      classification: source.source.toLowerCase().includes("simulated") ? "Demonstration data" : "Internal citation",
      route: deliverable.backendRecordId ? `/deliverables/${encodeURIComponent(deliverable.backendRecordId)}` : null,
    })),
    relationshipStatus: null,
    contradictions: source.records.length ? [] : ["No linked record ids are attached."],
    advanced: [
      { label: "Deliverable id", value: deliverable.backendRecordId ?? deliverable.id },
      { label: "Source", value: source.source },
    ],
    askPrompt: `Explain the source "${humanSourceLabel(source.source)}" for ${deliverable.title}.`,
  };
}
