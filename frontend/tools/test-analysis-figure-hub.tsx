import React from "react";
import { renderToString } from "react-dom/server";
import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import { computeChart } from "../src/metrics/chartSpec.ts";
import { AnalysisFigure } from "../src/ui/analysis/ChartFigure.tsx";
import { FigureTypePicker } from "../src/ui/analysis/FigureTypePicker.tsx";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import type { World } from "../src/app/useWorld.ts";
import type { ChartSpec } from "../src/metrics/types.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

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
    dataSource: null,
    loadErrors: [],
    dataMode: "demo",
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const world = await loadWorld();
const spec: ChartSpec = { metric: "revenue", viz: "heatmap", rows: "account", cols: "quarter" };
const pickerHtml = renderToString(<FigureTypePicker spec={spec} world={world} onSelect={() => undefined} />);

assert((pickerHtml.match(/figure-picker-preview/g) ?? []).length === 4, "Figure type picker must render one live preview per chart type.");
assert((pickerHtml.match(/role=\"radio\"/g) ?? []).length === 4, "Figure type picker must expose four radio-style options.");
assert(pickerHtml.includes("Heatmap") && pickerHtml.includes("Trend") && pickerHtml.includes("Ranked bar") && pickerHtml.includes("Retention grid"), "Figure picker labels should cover the four existing viz types.");

const accountId = world.companies[0]?.id;
assert(accountId, "Fixture world needs at least one account.");
const scoped = computeChart({ ...spec, filters: { accountId } }, world);
assert(scoped.grid?.rows.length === 1, "Account-scoped heatmap should only include one account row.");
assert(scoped.grid.rows[0] === world.companies[0].name, "Account-scoped heatmap row should use the selected account name.");

const figureHtml = renderToString(<AnalysisFigure spec={spec} world={world} interactive={false} />);
assert(figureHtml.includes("analysis-figure"), "Chart-spec renderer should produce a rendered figure container.");
assert(figureHtml.includes("analysis-grid"), "Heatmap chart specs should render as grids, not raw JSON.");

console.log(`analysis figure hub ok: 4 previews, scoped account ${world.companies[0].name}`);
