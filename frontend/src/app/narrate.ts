// Deterministic narrator. Formats the engine's structured output into readable
// business language — NOT AI, just better presentation of the numbers. This is
// the fallback the dossier uses when no baked LLM narration exists for a company,
// so the demo always reads like a sales brief. The per-event "what this means"
// templates carry BTX/industry framing and therefore live in data/config.

import type { Company } from "../engine/brain/entities.ts";
import type { FitResult } from "../engine/decision/fit.ts";
import type { Signal } from "../engine/signals/contract.ts";
import { PROFILE } from "./config.ts";
import meanings from "../../data/config/finding-meanings.json";

const MEANINGS = meanings as Record<string, string>;

export function findingMeaning(eventType: string): string {
  return MEANINGS[eventType] ?? "";
}

export function narrateOpportunity(
  company: Company,
  opportunity: number,
  fit: FitResult,
  signals: Signal[],
): string {
  const tier = opportunity >= 70 ? "a strong" : opportunity >= 40 ? "a moderate" : "an early-stage";
  const types = [...new Set(signals.map((s) => s.event_type))]
    .slice(0, 3)
    .map((t) => t.replace(/_/g, " "));
  const drivers = types.length ? ` Recent activity — ${types.join(", ")} — points to new work.` : "";
  const fitClause = fit.matched.length
    ? ` ${PROFILE.name} fits ${fit.score}%, serving ${fit.matched.slice(0, 3).join(", ")}.`
    : ` ${PROFILE.name} has no direct capability match (${fit.score}%) — likely a teaming play.`;
  const action = fit.matched.length ? ` Lead with ${fit.matched[0]}.` : "";
  return `${company.name} is ${tier} opportunity (${opportunity}).${drivers}${fitClause}${action}`;
}
