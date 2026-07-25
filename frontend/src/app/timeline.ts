import { SCORE_FAMILY_LABELS, plainWorkStatus } from "./presentation.ts";
import { signalHeadline, signalSourceName } from "./signalProvenance.ts";
import type { ScoreSnapshot } from "./revenueDataClient.ts";
import type { World } from "./useWorld.ts";
import type { WorkItem } from "./workItems.ts";
import type { Signal } from "../engine/signals/contract.ts";

export type MeaningfulTimelineCategory =
  | "signal"
  | "relationship"
  | "score"
  | "work"
  | "approval"
  | "execution"
  | "verification"
  | "outcome"
  | "note";

export interface MeaningfulTimelineEvent {
  id: string;
  occurredAt: string;
  category: MeaningfulTimelineCategory;
  title: string;
  summary: string | null;
  actorLabel: string | null;
  sourceRecordType: string;
  sourceRecordId: string;
  importance: "major" | "standard" | "supporting";
  dataClassification: string | null;
  route: string | null;
  evidenceId?: string | null;
}

function accountName(world: World, accountId: string | null | undefined): string {
  if (!accountId) return "Portfolio";
  return world.companies.find((company) => company.id === accountId || company.canonical_account_id === accountId)?.name ?? accountId;
}

function eventTime(value: string | null | undefined, fallback: string): string {
  return value || fallback;
}

function scoreValue(score: ScoreSnapshot): string {
  if (score.score === null || score.result.status === "insufficient_data") return "unavailable";
  if (score.result.status === "provisional") return `${Math.round(score.score)} provisional`;
  if (score.result.status === "disqualified") return "disqualified";
  return String(Math.round(score.score));
}

function signalEvent(world: World, signal: Signal): MeaningfulTimelineEvent {
  return {
    id: `signal-${signal.id}`,
    occurredAt: signal.detected_at,
    category: "signal",
    title: "Signal detected",
    summary: `${signalHeadline(signal)} from ${signalSourceName(signal)}.`,
    actorLabel: "Monitor",
    sourceRecordType: "signal",
    sourceRecordId: signal.id,
    importance: signal.scope === "specific_account" ? "major" : "standard",
    dataClassification: signal.artifact ? "Public monitor record" : "Internal evidence record",
    route: signal.scope === "specific_account" ? `/accounts/${encodeURIComponent(signal.subject_id)}` : "/programs",
    evidenceId: `signal-${signal.id}`,
  };
}

function relationshipEvents(signal: Signal): MeaningfulTimelineEvent[] {
  return (signal.relationships ?? []).map((relationship) => ({
    id: `relationship-${relationship.id ?? signal.id}-${relationship.canonical_account_id}`,
    occurredAt: eventTime(relationship.last_validated_at ?? relationship.lastValidatedAt, signal.detected_at),
    category: "relationship",
    title: relationship.review_status === "confirmed" || relationship.review_status === "accepted" ? "Evidence confirmed" : relationship.review_status === "rejected" ? "Relationship rejected" : "Relationship awaiting review",
    summary: `${relationship.source_entity_name} matched by ${relationship.match_method.replace(/_/g, " ")} with ${Math.round(relationship.confidence * 100)}% confidence.`,
    actorLabel: relationship.creation_source.replace(/_/g, " "),
    sourceRecordType: "signal_relationship",
    sourceRecordId: relationship.id ?? signal.id,
    importance: relationship.review_status === "confirmed" || relationship.review_status === "accepted" ? "major" : "supporting",
    dataClassification: "Relationship review",
    route: `/accounts/${encodeURIComponent(relationship.canonical_account_id)}`,
    evidenceId: `signal-${signal.id}`,
  }));
}

function scoreEvents(world: World, accountId: string): MeaningfulTimelineEvent[] {
  const scores = world.scoreResults;
  if (!scores) return [];
  return (Object.entries(SCORE_FAMILY_LABELS) as Array<[keyof typeof SCORE_FAMILY_LABELS, string]>)
    .map(([family, label]) => scores[family]?.filter((score) => score.entityType === "account" && score.entityId === accountId).sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0])
    .filter((score): score is ScoreSnapshot => Boolean(score))
    .map((score) => ({
      id: `score-${score.scoreFamily}-${score.id}`,
      occurredAt: score.calculatedAt,
      category: "score",
      title: `${SCORE_FAMILY_LABELS[score.scoreFamily as keyof typeof SCORE_FAMILY_LABELS] ?? score.scoreFamily} updated`,
      summary: `Current value is ${scoreValue(score)}. ${score.result.missingInputs.length ? `Missing ${score.result.missingInputs.slice(0, 2).join("; ")}.` : "No major missing input surfaced."}`,
      actorLabel: "Scoring service",
      sourceRecordType: "score_snapshot",
      sourceRecordId: score.id,
      importance: score.result.status === "available" ? "standard" : "supporting",
      dataClassification: "Derived score snapshot",
      route: `/accounts/${encodeURIComponent(accountId)}`,
      evidenceId: `score-${score.scoreFamily}-${accountId}`,
    }));
}

function actionCategory(action: string): MeaningfulTimelineCategory {
  if (action.includes("approval") || action === "approve" || action === "reject") return "approval";
  if (action.includes("execute") || action.includes("hubspot") || action.includes("start")) return "execution";
  if (action.includes("verify")) return "verification";
  if (action.includes("outcome")) return "outcome";
  return "work";
}

function workAuditEvents(item: WorkItem): MeaningfulTimelineEvent[] {
  const seen = new Set<string>();
  return item.audit_history.flatMap((entry, index) => {
    const action = String(entry.event_type ?? entry.action ?? "work_updated");
    const timestamp = String(entry.timestamp ?? item.updated_at);
    const key = `${action}-${timestamp.slice(0, 16)}`;
    if (seen.has(key) && !["approve", "verify", "record_outcome"].includes(action)) return [];
    seen.add(key);
    const category = actionCategory(action);
    return [{
      id: `audit-${item.id}-${index}`,
      occurredAt: timestamp,
      category,
      title: category === "approval" ? "Approval state changed" : category === "execution" ? "External action represented" : category === "verification" ? "External action verified" : category === "outcome" ? "Outcome recorded" : "Work item updated",
      summary: String(entry.reason ?? entry.note ?? entry.outcome ?? entry.status ?? action).replace(/_/g, " "),
      actorLabel: String(entry.actor ?? "system"),
      sourceRecordType: "work_item_audit",
      sourceRecordId: item.id,
      importance: category === "verification" || category === "outcome" || category === "approval" ? "major" : "supporting",
      dataClassification: "Internal work history",
      route: `/work/${encodeURIComponent(item.id)}`,
      evidenceId: `work-${item.id}`,
    } satisfies MeaningfulTimelineEvent];
  });
}

function workEvents(world: World, item: WorkItem): MeaningfulTimelineEvent[] {
  return [
    {
      id: `work-created-${item.id}`,
      occurredAt: item.created_at,
      category: "work",
      title: "Work item created",
      summary: `${item.recommended_action} for ${accountName(world, item.canonical_account_id)}.`,
      actorLabel: "BTX cockpit",
      sourceRecordType: "work_item",
      sourceRecordId: item.id,
      importance: "major",
      dataClassification: "Internal work item",
      route: `/work/${encodeURIComponent(item.id)}`,
      evidenceId: `work-${item.id}`,
    },
    {
      id: `work-current-${item.id}`,
      occurredAt: item.updated_at,
      category: item.status === "verified" ? "verification" : item.status === "outcome_recorded" ? "outcome" : "work",
      title: "Current work state",
      summary: `${plainWorkStatus(item.status)}. ${item.owner ? `Owner: ${item.owner}.` : "Owner not assigned."}`,
      actorLabel: "Backend lifecycle",
      sourceRecordType: "work_item",
      sourceRecordId: item.id,
      importance: "standard",
      dataClassification: "Internal work item",
      route: `/work/${encodeURIComponent(item.id)}`,
      evidenceId: `work-${item.id}`,
    },
    ...workAuditEvents(item),
    ...item.notes.map((note) => ({
      id: `note-${note.id}`,
      occurredAt: note.created_at,
      category: "note" as const,
      title: `${note.note_type.replace(/_/g, " ")} note`,
      summary: note.body,
      actorLabel: note.author_user_id ?? "Operator",
      sourceRecordType: "work_item_note",
      sourceRecordId: note.id,
      importance: note.note_type === "outcome" || note.note_type === "verification" ? "standard" as const : "supporting" as const,
      dataClassification: "Internal note",
      route: `/work/${encodeURIComponent(item.id)}`,
      evidenceId: `work-${item.id}`,
    })),
  ];
}

function sortTimeline(events: MeaningfulTimelineEvent[]): MeaningfulTimelineEvent[] {
  return [...events]
    .filter((event) => event.occurredAt)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
}

export function buildAccountTimeline(world: World, accountId: string): MeaningfulTimelineEvent[] {
  const signals = world.analysis.valid.filter((signal) => signal.subject_id === accountId);
  const workItems = (world.worldSnapshot?.workItems ?? []).filter((item) => item.canonical_account_id === accountId);
  return sortTimeline([
    ...signals.flatMap((signal) => [signalEvent(world, signal), ...relationshipEvents(signal)]),
    ...scoreEvents(world, accountId),
    ...workItems.flatMap((item) => workEvents(world, item).filter((event) => event.importance !== "supporting")),
  ]).slice(0, 14);
}

export function buildWorkTimeline(world: World, item: WorkItem): MeaningfulTimelineEvent[] {
  const signals = world.analysis.valid.filter((signal) => [item.related_signal_id, ...item.source_signal_ids].includes(signal.id));
  return sortTimeline([
    ...signals.flatMap((signal) => [signalEvent(world, signal), ...relationshipEvents(signal)]),
    ...workEvents(world, item),
  ]);
}
