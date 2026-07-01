// Loads the baked LLM narration (insights.json), committed by the CI workflow.
// The file ships empty; the dossier falls back to the deterministic narrator when
// a company has no baked insight, so the app works with or without the CI run.

import insights from "../../data/mock/insights.json";

export interface CompanyInsight {
  /** LLM prose explaining "why this is a target" — grounded in the trace. */
  opportunity?: string;
  /** signal_id -> one-line "what this means for BTX". */
  findings?: Record<string, string>;
}

const INSIGHTS = insights as Record<string, CompanyInsight>;

export function getInsight(companyId: string): CompanyInsight | undefined {
  return INSIGHTS[companyId];
}
