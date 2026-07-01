// Baked insight generator. Runs OFFLINE (in CI, where ANTHROPIC_API_KEY is a
// repo secret) — never in the browser, never with a key on disk. For each
// company it sends the DETERMINISTIC engine output to Claude and asks for prose
// that EXPLAINS it: a "why this is a target" narrative + one line per signal.
// The model never computes or changes a score — it translates the trace.
//
// Output is committed to data/mock/insights.json (frozen → deterministic demo).
// Raw fetch, no SDK, so the project stays dependency-free (CLAUDE.md rule #5).
//
//   ANTHROPIC_API_KEY=... node frontend/tools/generate-insights.ts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateSignals } from "../src/engine/validation/validate.ts";
import { scorePortfolio } from "../src/engine/decision/portfolio.ts";
import { scoreFit } from "../src/engine/decision/fit.ts";
import { SCORE_DIMENSIONS } from "../src/engine/signals/contract.ts";
import type { WeightsConfig } from "../src/engine/decision/weights.ts";
import type { Company } from "../src/engine/brain/entities.ts";
import type { Signal } from "../src/engine/signals/contract.ts";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this runs in CI with the repo secret.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(join(here, p), "utf8"));

const config = read("../data/config/scoring-weights.v1.json") as WeightsConfig;
const profile = read("../data/config/client-profile.json") as { name: string; capabilities: string[] };
const companies = read("../data/mock/companies.json") as Company[];
const rawSignals = read("../data/mock/signals.json") as unknown[];

const { valid } = validateSignals(rawSignals, config.min_confidence);
const scores = scorePortfolio(companies.map((c) => c.id), valid, config);
const scoreById = new Map(scores.map((s) => [s.subject_id, s]));

const SYSTEM = `You are a corporate strategist for ${profile.name}, a precision-machining manufacturer.
You are given a DETERMINISTIC scoring output for a prospect. Your ONLY job is to EXPLAIN it in
plain business language a sales rep can act on. Rules:
- NEVER invent, change, or recompute any number. Use only the numbers and signals provided.
- Ground every claim in a provided signal or the fit data.
- Be concrete and concise. No hedging, no preamble.`;

const SCHEMA = {
  type: "object",
  properties: {
    opportunity: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { signal_id: { type: "string" }, meaning: { type: "string" } },
        required: ["signal_id", "meaning"],
        additionalProperties: false,
      },
    },
  },
  required: ["opportunity", "findings"],
  additionalProperties: false,
};

interface Insight {
  opportunity: string;
  findings: Record<string, string>;
}

async function narrate(company: Company, signals: Signal[]): Promise<Insight | null> {
  const score = scoreById.get(company.id);
  const fit = scoreFit(company.needs, profile.capabilities);
  const trace = SCORE_DIMENSIONS.map((d) => {
    const dim = score?.dimensions[d];
    if (!dim || dim.contributions.length === 0) return null;
    return `${d}=${dim.score} (${dim.contributions.map((c) => `${c.event_type}+${c.delta}`).join(", ")})`;
  }).filter(Boolean).join("; ");

  const prompt = [
    `Prospect: ${company.name} (${company.relationship}, ${company.location.city})`,
    `Opportunity score: ${score?.dimensions.opportunity.score ?? 0}`,
    `Fit to ${profile.name}: ${fit.score}% — can serve: ${fit.matched.join(", ") || "none"}; gaps: ${fit.missing.join(", ") || "none"}`,
    `Score trace: ${trace || "none"}`,
    `Signals:`,
    ...signals.map((s) => `  [${s.id}] ${s.event_type}: ${s.source_quote}`),
    ``,
    `Write a 2-3 sentence "why this is a target" narrative, then one short "what this means for ${profile.name}" line per signal (by signal_id).`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY as string,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error(`  ${company.id}: HTTP ${res.status} ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) return null;
  const parsed = JSON.parse(text) as { opportunity: string; findings: Array<{ signal_id: string; meaning: string }> };
  const findings: Record<string, string> = {};
  for (const f of parsed.findings) findings[f.signal_id] = f.meaning;
  return { opportunity: parsed.opportunity, findings };
}

const insights: Record<string, Insight> = {};
for (const company of companies) {
  const mine = valid.filter((s) => s.subject_id === company.id);
  if (mine.length === 0) continue;
  const insight = await narrate(company, mine);
  if (insight) {
    insights[company.id] = insight;
    console.log(`  ✓ ${company.name}`);
  }
}

writeFileSync(join(here, "../data/mock/insights.json"), JSON.stringify(insights, null, 2) + "\n");
console.log(`wrote insights for ${Object.keys(insights).length} companies`);
