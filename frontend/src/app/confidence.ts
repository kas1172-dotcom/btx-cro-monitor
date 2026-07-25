import type { Contact, Opportunity, Company } from "../engine/brain/entities.ts";
import type { Signal } from "../engine/signals/contract.ts";

export type EvidenceBand = "high" | "medium" | "low";

export function qualitativeSignalConfidence(signal: Signal): { band: EvidenceBand; label: string; reason: string } {
  const acceptedLink = signal.scope === "specific_account" && (signal.relationships ?? []).some((relationship) => relationship.review_status === "accepted");
  if (acceptedLink) {
    return {
      band: "high",
      label: "high confidence",
      reason: "verified account link and supporting source records",
    };
  }
  if (signal.scope === "specific_account") {
    return {
      band: "medium",
      label: "medium confidence",
      reason: "linked signal, needs more supporting records",
    };
  }
  return {
    band: "low",
    label: "needs qualification",
    reason: "unlinked prospect signal",
  };
}

/**
 * Describes how an account link was matched and whether a human has accepted it.
 * The stored match score is an internal resolver value, not a calibrated
 * probability, so it is never rendered as a percentage.
 */
export function relationshipMatchDescription(relationship: { match_method: string; review_status?: string | null }): string {
  const method = relationship.match_method.replace(/_/g, " ");
  const status = relationship.review_status;
  if (status === "confirmed" || status === "accepted") return `Matched by ${method} and confirmed by review.`;
  if (status === "rejected") return `Matched by ${method}, then rejected on review.`;
  return `Matched by ${method}. Not yet reviewed, so treat the account link as unconfirmed.`;
}

export function prospectQualificationLabel(input: {
  company: Company;
  contact?: Contact;
  opportunities: Opportunity[];
  fitMatched: string[];
}): { label: string; gaps: string[] } {
  const gaps: string[] = [];
  if (!input.company.cage_code) gaps.push("no CAGE match");
  if (!input.contact) gaps.push("no contact");
  if (!input.opportunities.some((opportunity) => opportunity.stage !== "won" && opportunity.stage !== "lost")) gaps.push("no pipeline");
  if (input.fitMatched.length === 0 || gaps.length > 0) gaps.push("unconfirmed fit");
  if (gaps.length === 0) return { label: "qualified fit", gaps: [] };
  return { label: "needs qualification", gaps: [...new Set(gaps)] };
}
