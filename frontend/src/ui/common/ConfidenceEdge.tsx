import type { ReactNode } from "react";
import { RELATIONSHIP_CONFIDENCE_FLOOR } from "../../identity/canonicalAccounts.ts";

/**
 * Confidence-gradient border for account-linked claims: a verified,
 * relationship-backed link renders solid/full-opacity/teal; an unlinked or
 * low-confidence claim renders dashed/muted. Distinct from ProvenanceBadge
 * (which answers "where did this come from", not "how sure are we it's
 * linked to the right account").
 */
export type ConfidenceTier = "verified" | "confident" | "weak";

export function confidenceTier(confidence: number | undefined, linked: boolean): ConfidenceTier {
  if (!linked || typeof confidence !== "number") return "weak";
  if (confidence >= 0.85) return "verified";
  if (confidence >= RELATIONSHIP_CONFIDENCE_FLOOR) return "confident";
  return "weak";
}

export function ConfidenceEdge({ confidence, linked, children }: { confidence?: number; linked: boolean; children: ReactNode }) {
  const tier = confidenceTier(confidence, linked);
  return <div className={`confidence-edge confidence-${tier}`}>{children}</div>;
}
