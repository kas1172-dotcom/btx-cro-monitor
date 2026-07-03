import type { Company } from "../engine/brain/entities.ts";
import type { Signal } from "../engine/signals/contract.ts";
import { USER_PROMPT_RULES } from "./promptContract.ts";

// User-prompt builders for Chatpil single-shot asks. The system prompt (jarvis.ts)
// carries the full grounding contract; each builder appends USER_PROMPT_RULES so
// one-shot prompts stay honest, and frames the ask for a CRO audience.

function relationshipFraming(company: Company): string {
  if (company.business_motion === "manage_current_business" || company.business_motion === "grow_existing_business" || company.business_motion === "reduce_risk") {
    return `This is a Current Business account (${company.business_motion}) — frame around protecting, expanding, or reducing risk in the existing relationship.`;
  }
  if (company.account_status === "current_customer" || company.account_status === "active_pipeline" || company.account_status === "past_customer" || company.account_status === "partner") {
    return `This is a Current Business account (${company.account_status}) — frame around protecting, expanding, or recovering the relationship.`;
  }
  if (company.business_motion === "prospect_new_business" || company.account_status === "target_prospect" || company.account_status === "new_logo") {
    return `This is a Prospecting account (${company.account_status ?? company.business_motion}) — frame around winning it: opportunity, fit, buying signal strength, and who to call.`;
  }
  return company.relationship === "customer" || company.relationship === "supplier"
    ? "This is a Current Business account (existing relationship) — frame around protecting/expanding and any supply/capacity risk."
    : "This is a Prospecting account (target) — frame around winning it: opportunity, fit, and who to call.";
}

export function explainRankingPrompt(companyName: string, context: string): string {
  return `Explain why ${companyName} is ranked here, for a CRO. Use only the engine context: rank, score drivers, validated signals, fit, CRM/capacity/pipeline context, and recommended action. Answer in this order: recommended action, why ranked here, evidence, missing data. Say what each provided score reflects and cite the evidence behind it. ${USER_PROMPT_RULES}\n\nContext: ${context}`;
}

export function explainAccountPrompt(company: Company, context: string): string {
  return `Why does ${company.name} matter right now? Cover why it matters, what changed recently, which facts are provided vs inferred, and the recommended next step. ${relationshipFraming(company)} ${USER_PROMPT_RULES}\n\nContext: ${context}`;
}

export function expandSignalPrompt(
  signal: Pick<Signal, "event_type" | "source_quote" | "subject_id">,
  companyName: string,
): string {
  return `Explain what this signal means for ${companyName} and what BTX should do about it. Include: what happened, why it matters, recommended action, and the evidence quote. Keep it to one tight paragraph. Company: ${companyName}. Signal type: ${signal.event_type}. Verbatim quote: "${signal.source_quote}". ${USER_PROMPT_RULES}`;
}

export function outreachPrompt(company: Company, context: string): string {
  return `Draft a concise outreach note for ${company.name}: why now (cite the signal), the relevant provided fit/context, and a clear next step. Do not include unsupported claims, invented dates, or invented savings/revenue. Keep it to 4-6 sentences a rep could send. ${relationshipFraming(company)} ${USER_PROMPT_RULES}\n\nContext: ${context}`;
}

export function nextActionPrompt(companyName: string, context: string): string {
  return `What should BTX do next with ${companyName}? Give the single highest-value action, why now, the evidence supporting it, and anything important that is missing. Ground the answer in the recommended action, scores, signals, and CRM/capacity/pipeline context. ${USER_PROMPT_RULES}\n\nContext: ${context}`;
}
