export interface CompanyInsight {
  /** LLM prose explaining "why this is a target" - grounded in the trace. */
  opportunity?: string;
  /** signal_id -> one-line "what this means for BTX". */
  findings?: Record<string, string>;
}

const INSIGHTS: Record<string, CompanyInsight> = {};

export function getInsight(companyId: string): CompanyInsight | undefined {
  return INSIGHTS[companyId];
}
