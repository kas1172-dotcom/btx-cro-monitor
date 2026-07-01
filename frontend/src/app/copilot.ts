// Deterministic Copilot. It NARRATES/ROUTES the engine's output — it never
// computes a score. Every answer is assembled from validated signals, scores,
// the trace, and the prospect list. (The LLM free-form upgrade later swaps this
// resolver for a proxy call, keeping the same "explain, don't decide" contract.)

import type { World } from "./useWorld.ts";
import type { ScoreDimension } from "../engine/signals/contract.ts";
import { groupTrace, summarizeGroups } from "../engine/decision/explain.ts";
import { CONFIG } from "./config.ts";

const DIMENSION_WORDS: Array<[RegExp, ScoreDimension]> = [
  [/\brisk\b/, "risk"],
  [/\bcapacity\b/, "capacityRisk"],
  [/(competit|pressure|rival)/, "competitivePressure"],
  [/(opportunit|prospect|target|sell|win|pursue)/, "opportunity"],
];

export const SUGGESTIONS = [
  "What needs my attention today?",
  "Who should I call in Austin?",
  "Why is BTX Precision high risk?",
  "What's the top opportunity?",
];

export function answer(question: string, world: World): string {
  const q = question.toLowerCase().trim();
  if (!q) return help();

  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;

  const cities = [...new Set(world.companies.map((c) => c.location.city))];
  const city = cities.find((ci) => q.includes(ci.toLowerCase()));

  const company = [...world.companies]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => {
      const n = c.name.toLowerCase();
      const first = n.split(" ")[0];
      return q.includes(n) || q.includes(c.id) || (first.length >= 3 && q.includes(first));
    });

  const dim = DIMENSION_WORDS.find(([re]) => re.test(q))?.[1];
  const wantsProspects = /(call|prospect|who|sell|target|pursue)/.test(q);

  // 1) "who should I call in <city>"
  if (city && (wantsProspects || !company)) {
    const rows = world.prospects.filter((p) => p.company.location.city === city).slice(0, 4);
    if (rows.length === 0) return `No BTX prospects on file in ${city} yet.`;
    const lines = rows.map(
      (p) =>
        `• ${p.company.name} — opportunity ${p.opportunity}, fit ${p.fit.score}%` +
        (p.contact ? ` — call ${p.contact.name} (${p.contact.title})` : "") +
        (p.fit.matched.length ? `\n   serve with: ${p.fit.matched.join(", ")}` : ""),
    );
    return `Prospects in ${city}, ranked:\n${lines.join("\n")}`;
  }

  // 2) a specific company
  if (company) {
    const score = world.analysis.byId.get(company.id);
    if (dim && dim !== "opportunity" && score) {
      const d = score.dimensions[dim];
      if (d.score === 0) return `${company.name} has no ${dim} signals right now.`;
      return `${company.name} — ${dim} ${d.score}. Driven by ${summarizeGroups(groupTrace(d, CONFIG))}.`;
    }
    const prospect = world.prospects.find((p) => p.company.id === company.id);
    if (prospect) {
      return (
        `${company.name} — opportunity ${prospect.opportunity}, fit ${prospect.fit.score}%` +
        (prospect.fit.matched.length ? ` (serve with ${prospect.fit.matched.join(", ")})` : "") +
        (prospect.contact ? `. Call ${prospect.contact.name}, ${prospect.contact.title}.` : ".")
      );
    }
    if (score) {
      const d = score.dimensions;
      return `${company.name} — risk ${d.risk.score}, opportunity ${d.opportunity.score}, capacityRisk ${d.capacityRisk.score}, competitivePressure ${d.competitivePressure.score}.`;
    }
    return `I don't have data on ${company.name}.`;
  }

  // 3) portfolio-level
  if (/(what should i do|priorit|\baction|focus|today|attention)/.test(q)) {
    const top = world.analysis.recommendations.filter((r) => r.priority !== "low").slice(0, 5);
    if (top.length) return "Top actions:\n" + top.map((r) => `• ${r.action} ${nameOf(r.subject_id)} — ${r.reason}`).join("\n");
  }
  if (/\brisk\b/.test(q)) {
    const top = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score)[0];
    return top ? `Highest risk: ${nameOf(top.subject_id)} at ${top.dimensions.risk.score}.` : help();
  }
  if (dim === "opportunity" || /\bbest\b/.test(q)) {
    const top = world.prospects[0];
    return top
      ? `Top opportunity: ${top.company.name} — opportunity ${top.opportunity}, fit ${top.fit.score}%${top.contact ? `, call ${top.contact.name}` : ""}.`
      : help();
  }
  return help();
}

function help(): string {
  return `Ask about the engine's output — e.g. "who should I call in Austin?", "why is Cobalt Alloys high risk?", "what's the top opportunity?". I only report what the deterministic engine computed.`;
}
