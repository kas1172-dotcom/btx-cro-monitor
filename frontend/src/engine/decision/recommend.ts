// Deterministic recommendations — turns scores into DECISIONS. No AI. Given a
// company's relationship, scores, and fit, it emits one action with a priority
// and a plain-English reason. This is what makes the engine output feel like
// advice ("pursue Beacon", "derisk Cobalt") rather than raw numbers, and it's
// the material Jarvis delivers. Derived like fit — the locked scorer is untouched.

import type { Company } from "../brain/entities.ts";
import type { CompanyScore } from "./score.ts";
import type { FitResult } from "./fit.ts";

export type Action = "pursue" | "defend" | "derisk" | "expand" | "watch";

export interface Recommendation {
  subject_id: string;
  action: Action;
  priority: "high" | "medium" | "low";
  reason: string;
}

export function recommend(company: Company, score: CompanyScore, fit: FitResult): Recommendation {
  const d = score.dimensions;
  const risk = d.risk.score;
  const opp = d.opportunity.score;
  const pressure = d.competitivePressure.score;
  const id = company.id;

  switch (company.relationship) {
    case "target":
    case "customer": {
      if (opp >= 60 && fit.score >= 60)
        return { subject_id: id, action: "pursue", priority: "high", reason: `Opportunity ${opp} with ${fit.score}% fit — lead with ${fit.matched[0] ?? "your core capability"}.` };
      if (opp >= 40)
        return { subject_id: id, action: fit.score >= 50 ? "pursue" : "watch", priority: "medium", reason: fit.matched.length ? `Opportunity ${opp}, ${fit.score}% fit — serve ${fit.matched.slice(0, 2).join(", ")}.` : `Opportunity ${opp} but ${fit.score}% fit — likely a teaming play.` };
      return { subject_id: id, action: "watch", priority: "low", reason: `Low opportunity (${opp}) for now — keep warm.` };
    }
    case "competitor":
      if (opp >= 60)
        return { subject_id: id, action: "defend", priority: "high", reason: `${company.name} is winning (opportunity ${opp}) — expect pressure on shared accounts.` };
      return { subject_id: id, action: "watch", priority: pressure >= 30 ? "medium" : "low", reason: `Competitive pressure ${pressure} — track their moves.` };
    case "supplier":
      if (risk >= 50)
        return { subject_id: id, action: "derisk", priority: "high", reason: `Supplier risk ${risk} — line up an alternate source before it hits your schedule.` };
      return { subject_id: id, action: "watch", priority: "low", reason: `Supplier risk ${risk} — stable for now.` };
    case "self":
    default:
      if (risk >= 60)
        return { subject_id: id, action: "derisk", priority: "high", reason: `Your risk is ${risk} — address the top driver first (${d.risk.contributions[0]?.event_type ?? "see trace"}).` };
      return { subject_id: id, action: "expand", priority: "medium", reason: `Risk contained (${risk}); push opportunity (${opp}).` };
  }
}

const PRIORITY_RANK: Record<Recommendation["priority"], number> = { high: 0, medium: 1, low: 2 };

export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.subject_id.localeCompare(b.subject_id),
  );
}
