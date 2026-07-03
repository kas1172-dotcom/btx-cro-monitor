// Signal Extraction layer — the front of the pipeline. Reads unstructured news
// (data/demo/btx/news.json), and for each article asks Claude to extract ONE strict
// JSON signal (event_type from a fixed taxonomy, entities, optional value ONLY
// if explicitly stated, confidence, verbatim source_quote). Then the VALIDATION
// gate runs: a signal counts only if event_type != "none" and confidence >= 0.7.
// Output committed to data/demo/btx/extracted-signals.json (frozen; the Feed view
// renders it). Runs OFFLINE/CI with ANTHROPIC_API_KEY — never in the browser.
// Raw fetch, no SDK, so the project stays dependency-free.
//
//   ANTHROPIC_API_KEY=... node frontend/tools/extract-signals.ts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — this runs in CI with the repo secret.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const MIN_CONFIDENCE = 0.7;
const EVENT_TYPES = [
  "supplier_delay", "quality_escape", "capacity_constraint", "pricing_pressure",
  "regulatory_change", "government_contract_award", "contract_win", "contract_loss",
  "demand_spike", "competitor_expansion", "hiring_surge", "competitor_won_deal", "none",
];

const news = JSON.parse(readFileSync(join(here, "../data/demo/btx/news.json"), "utf8")) as Array<{
  id: string;
  headline: string;
  body: string;
}>;

const SYSTEM = `You extract exactly ONE structured business signal from a news article. A signal is a concrete, actionable business EVENT (a contract award, a supplier delay, a quality issue, a capacity change, a price move, a hiring surge, a regulatory change), not a vague topic, opinion, or general summary. Rules:
- event_type MUST be one of the provided enum values. If the text describes no clear, specific business event, use "none".
- entities: the canonical/full company or organization name(s) the event is about (not abbreviations or partials).
- value: include ONLY if a specific dollar amount is explicitly stated in the text; otherwise omit it. Never guess or estimate a number.
- confidence: 0..1, how clearly the text supports the event. Firm, stated fact -> high (>=0.85). Hedged/rumored/unconfirmed ("may", "could", "reportedly", "sources say") -> low (<0.5).
- source_quote: a VERBATIM span copied from the body that directly supports the signal — do not paraphrase.
Extract only what the text states. No free-text reasoning, no interpretation, no invented detail — just the structured extraction.`;

const SCHEMA = {
  type: "object",
  properties: {
    event_type: { type: "string", enum: EVENT_TYPES },
    entities: { type: "array", items: { type: "string" } },
    value: { type: "number" },
    confidence: { type: "number" },
    source_quote: { type: "string" },
  },
  required: ["event_type", "entities", "confidence", "source_quote"],
  additionalProperties: false,
};

interface Extracted {
  event_type: string;
  entities: string[];
  value?: number;
  confidence: number;
  source_quote: string;
}

async function extract(headline: string, body: string): Promise<Extracted | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY as string, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 512,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `HEADLINE: ${headline}\n\nBODY: ${body}` }],
    }),
  });
  if (!res.ok) {
    console.error(`  HTTP ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((b) => b.type === "text")?.text;
  return text ? (JSON.parse(text) as Extracted) : null;
}

const out: unknown[] = [];
for (const article of news) {
  const extracted = await extract(article.headline, article.body);
  // VALIDATION gate — only confident, real signals pass.
  const valid = Boolean(extracted && extracted.event_type !== "none" && extracted.confidence >= MIN_CONFIDENCE);
  const reason = !extracted
    ? "extraction failed"
    : extracted.event_type === "none"
      ? "no clear signal"
      : extracted.confidence < MIN_CONFIDENCE
        ? `confidence ${extracted.confidence} below ${MIN_CONFIDENCE}`
        : "";
  out.push({ news_id: article.id, headline: article.headline, extracted, valid, reason });
  console.log(`  ${valid ? "✓" : "✗"} ${article.id} ${extracted?.event_type ?? "?"} (${extracted?.confidence ?? "?"})`);
}

writeFileSync(join(here, "../data/demo/btx/extracted-signals.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`extracted ${out.filter((o) => (o as { valid: boolean }).valid).length}/${news.length} valid signals`);
