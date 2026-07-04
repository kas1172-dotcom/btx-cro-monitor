import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { runAgent } from "../src/agents/runAgent.ts";
import { deliverableToMarkdown } from "../src/deliverables/markdown.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

async function loadWorld(): Promise<World> {
  const adapter = new DemoDataAdapter();
  const [companies, rawSignals, contacts, facilities, opportunities, snapshot] = await Promise.all([
    adapter.getCompanies(),
    adapter.getSignals(),
    adapter.getContacts(),
    adapter.getFacilities(),
    adapter.getOpportunities(),
    adapter.getOperatingSnapshot(),
  ]);
  const newsSignals = deriveNewsSignals(companies, newsData as MarketEvent[], extractedData as ExtractedRow[]);
  const analysis = analyze(companies, [...rawSignals, ...newsSignals]);
  return {
    city: null,
    companies,
    contacts,
    facilities,
    opportunities,
    analysis,
    prospects: buildProspects(companies, contacts, analysis.valid, analysis.byId),
    snapshot,
  };
}

function lastMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

const world = await loadWorld();
const deliverable = await runAgent("weekly_memo", { title: `Week of ${lastMonday()}` }, world);
const markdown = deliverableToMarkdown(deliverable);
const html = `<!doctype html><meta charset="utf-8"><title>${deliverable.title}</title><pre>${markdown.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</pre>`;
const outDir = join(process.cwd(), "memo_archive");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${lastMonday()}-weekly-memo.md`), markdown);
writeFileSync(join(outDir, `${lastMonday()}-weekly-memo.html`), html);
console.log(`weekly memo written to ${outDir}`);
