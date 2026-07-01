// End-to-end vertical slice, no UI / no AI yet. Two flows off the same engine:
//   1. GLOBAL  — validate -> score every entity -> leaderboard + self-lens
//   2. REGIONAL — "run the brain for Austin" -> prospect dossiers (opp + fit + contact)
//
// Run it (Node 23.6+ strips TypeScript natively, zero install):
//   node frontend/demo/run.ts
//
// Regenerate the frozen mock world first (deterministic, commit the output):
//   node frontend/tools/generate-mock.ts

import { MockDataAdapter } from "../src/adapters/mock/MockDataAdapter.ts";
import { validateSignals } from "../src/engine/validation/validate.ts";
import { scorePortfolio, rankBy } from "../src/engine/decision/portfolio.ts";
import { applySelfLens } from "../src/engine/decision/lens.ts";
import { scoreFit } from "../src/engine/decision/fit.ts";
import { SCORE_DIMENSIONS } from "../src/engine/signals/contract.ts";
import type { WeightsConfig } from "../src/engine/decision/weights.ts";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const readCfg = (p: string) => JSON.parse(readFileSync(join(here, p), "utf8"));
const config = readCfg("../data/config/scoring-weights.v1.json") as WeightsConfig;
const profile = readCfg("../data/config/client-profile.json") as { capabilities: string[] };

const adapter = new MockDataAdapter();

// ── 1. GLOBAL view ──────────────────────────────────────────────────────────
const companies = await adapter.getCompanies();
const label = new Map(companies.map((c) => [c.id, c.name]));
const { valid } = validateSignals(await adapter.getSignals(), config.min_confidence);
const scores = scorePortfolio(companies.map((c) => c.id), valid, config);

console.log(`\nGLOBAL — ${companies.length} entities, top risk:`);
for (const s of rankBy(scores, "risk").slice(0, 4)) {
  console.log(`  ${(label.get(s.subject_id) ?? "").padEnd(20)} risk ${s.dimensions.risk.score}`);
}
const persp = applySelfLens(companies, scores, config);
if (persp) {
  const d = persp.dimensions;
  console.log(`  BTX self-perspective: risk ${d.risk}  opp ${d.opportunity}  capRisk ${d.capacityRisk}  compPress ${d.competitivePressure}`);
}

// ── 2. REGIONAL view: "I'm in Austin — who do I call?" ─────────────────────
const CITY = "Austin";
const cityCompanies = await adapter.getCompanies({ city: CITY });
const cityContacts = await adapter.getContacts({ city: CITY });
const { valid: cityValid } = validateSignals(await adapter.getSignals({ city: CITY }), config.min_confidence);
const cityScores = scorePortfolio(cityCompanies.map((c) => c.id), cityValid, config);
const scoreById = new Map(cityScores.map((s) => [s.subject_id, s]));

// Prospects = targets + existing customers (people you can sell to).
const prospects = cityCompanies
  .filter((c) => c.relationship === "target" || c.relationship === "customer")
  .map((c) => {
    const sc = scoreById.get(c.id);
    const fit = scoreFit(c.needs, profile.capabilities);
    const contact = cityContacts.find((k) => k.company_id === c.id);
    const topSignal = cityValid
      .filter((s) => s.subject_id === c.id)
      .sort((a, b) => b.confidence - a.confidence)[0];
    return { c, opp: sc?.dimensions.opportunity.score ?? 0, fit, contact, topSignal };
  })
  .sort((a, b) => b.opp - a.opp || b.fit.score - a.fit.score || a.c.id.localeCompare(b.c.id));

console.log(`\nPROSPECTS IN ${CITY.toUpperCase()} (brain scoped to the city) — ${prospects.length} to call:`);
for (const p of prospects) {
  console.log(`\n  ${p.c.name}  [${p.c.relationship}]   opportunity ${p.opp}   fit ${p.fit.score}%`);
  console.log(`    serve with: ${p.fit.matched.join(", ") || "—"}`);
  if (p.topSignal) console.log(`    buying signal: ${p.topSignal.source_quote}`);
  if (p.contact) console.log(`    call: ${p.contact.name}, ${p.contact.title}`);
}
console.log();
