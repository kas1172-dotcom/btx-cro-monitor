// Single source of truth for the Signal contract and the score dimensions.
// INDUSTRY-FREE: no client or sector names may appear in this file (or anywhere
// under src/engine/). The engine knows about signals, dimensions and weights -
// never about a specific company or industry. Mock/demo data lives in data/.

import type { AccountStatus, BusinessMotion } from "../brain/entities.ts";

export const PORTFOLIO_SIGNAL_SUBJECT_ID = "__portfolio__";

/**
 * The dimensions the decision engine scores. To introduce a new score, add it
 * here and add a weight row in the weights config - no engine code changes.
 */
export const SCORE_DIMENSIONS = [
  "risk",
  "opportunity",
  "capacityRisk",
  "competitivePressure",
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export type SignalScope =
  | "market"
  | "program"
  | "customer"
  | "supplier"
  | "competitor"
  | "specific_account"
  | "unlinked";

export type SignalMatchMethod =
  | "exact_public_identifier"
  | "exact_uei"
  | "exact_cage_code"
  | "exact_hubspot_company_id"
  | "exact_verified_domain"
  | "exact_legal_name"
  | "verified_alias"
  | "parent_subsidiary_mapping"
  | "verified_program_relationship"
  | "manual_confirmation"
  | "exact_domain"
  | "cage_uei"
  | "alias"
  | "program"
  | "name_fuzzy"
  | "manual";

export interface SignalRelationship {
  id?: string;
  signalId?: string;
  canonical_account_id: string;
  canonicalAccountId?: string;
  source_entity_name: string;
  sourceEntityName?: string;
  match_method: SignalMatchMethod;
  matchMethod?: SignalMatchMethod;
  evidence: string;
  evidenceIds?: string[];
  evidence_ids?: string[];
  confidence: number;
  review_status: "confirmed" | "accepted" | "needs_review" | "unconfirmed" | "rejected";
  reviewStatus?: "confirmed" | "needs_review" | "rejected";
  creation_source: "resolver" | "manual" | "public_data" | "crm" | "derived";
  creationSource?: "public_data" | "crm" | "manual" | "derived";
  last_validated_at: string | null;
  lastValidatedAt?: string | null;
}

/**
 * A validated unit of evidence. This is the ONLY object the decision engine
 * consumes. It is produced by the extraction layer (LLM, strictly constrained)
 * and must clear the validation layer before it reaches scoring.
 */
export interface Signal {
  id: string;
  /** Generic business event, e.g. "supplier_delay". Never an industry term. */
  event_type: string;
  /** Named entities the source text mentions (for graph traversal). */
  entities: string[];
  /** The entity (company) this signal is scored against. Required for scoring. */
  subject_id: string;
  /** Whether this signal is account-scored or market-level only. */
  scope?: SignalScope;
  /** Evidence that justifies a specific-account signal link. */
  relationships?: SignalRelationship[];
  account_status?: AccountStatus;
  business_motion?: BusinessMotion;
  /** Optional. Present ONLY when a number was explicitly stated in the source. */
  value?: number;
  /** Extraction confidence, 0..1. The validation layer gates on this. */
  confidence: number;
  /** Verbatim supporting text - the audit trail back to the source. */
  source_quote: string;
  source_url?: string;
  document_url?: string;
  /** ISO-8601 timestamp the signal was detected (recency / decay / audit). */
  detected_at: string;
  /** Present when the signal came from monitor-engine artifacts. */
  artifact?: {
    item_id: string;
    headline: string;
    source_name: string;
    source_date: string;
    run_at: string;
    signal_type: string;
    relevance_score: number;
    analysis_text: string;
    source_url?: string;
    dollar_figures: number[];
    affected_entities: string[];
    provenance: unknown;
  };
}

export function relationshipAccountId(relationship: SignalRelationship): string {
  return relationship.canonicalAccountId ?? relationship.canonical_account_id;
}

export function relationshipEvidenceIds(relationship: SignalRelationship): string[] {
  return relationship.evidenceIds ?? relationship.evidence_ids ?? [];
}

export function relationshipReviewStatus(relationship: SignalRelationship): string {
  return relationship.reviewStatus ?? relationship.review_status;
}

export function isConfirmedAccountSignal(signal: Signal, relationship: SignalRelationship, minimumConfidence = 0.8): boolean {
  const accountId = relationshipAccountId(relationship);
  return (
    signal.scope === "specific_account" &&
    relationshipReviewStatus(relationship) === "confirmed" &&
    relationship.confidence >= minimumConfidence &&
    relationshipEvidenceIds(relationship).length > 0 &&
    accountId === signal.subject_id
  );
}
