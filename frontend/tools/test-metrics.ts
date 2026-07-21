import { DemoDataAdapter } from "../src/adapters/demo/DemoDataAdapter.ts";
import { analyze, buildProspects } from "../src/app/intelligence.ts";
import { deriveNewsSignals } from "../src/app/newsIngest.ts";
import newsData from "../data/demo/btx/news.json";
import extractedData from "../data/demo/btx/extracted-signals.json";
import { METRICS } from "../src/metrics/catalog.ts";
import { computeChart } from "../src/metrics/chartSpec.ts";
import { computeMetric } from "../src/metrics/catalog.ts";
import { priorQuarter, quarterWindow } from "../src/metrics/time.ts";
import { scoreFit } from "../src/engine/decision/fit.ts";
import { PROFILE } from "../src/app/config.ts";
import bookingsBacklogData from "../data/demo/btx/bookings_backlog.json";
import type { World } from "../src/app/useWorld.ts";
import type { ExtractedRow } from "../src/app/newsIngest.ts";
import type { MarketEvent } from "../src/engine/brain/entities.ts";
import type { ChartSpec, MetricId } from "../src/metrics/types.ts";
import { boardDeckAgent } from "../src/agents/boardDeckAgent.ts";
import revenueDataRaw from "../data/demo/btx/account_monthly_revenue.json";

const revenueRows = revenueDataRaw as Array<{ month: string; account_id: string; revenue: number }>;

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
    provenanceSources: [],
    provenanceSummary: null,
  };
}

const specs: ChartSpec[] = [
  { viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter" },
  { viz: "trend", metric: "bookings" },
  { viz: "ranked_bar", metric: "revenue", rows: "account" },
  { viz: "retention_grid", metric: "repeat_revenue_rate", rows: "account", cols: "month" },
];

const world = await loadWorld();
for (const metric of Object.values(METRICS)) {
  const result = metric.compute(world);
  assert(Number.isFinite(result.value), `${metric.id} produced a non-finite value`);
  assert(result.provenance.length > 0, `${metric.id} missing provenance`);
}

for (const spec of specs) {
  const result = computeChart(spec, world);
  assert(result.provenance.length > 0, `${spec.viz} missing provenance`);
  assert(Boolean(result.grid || result.series), `${spec.viz} produced no data`);
}

const q2 = quarterWindow("Q2 2026");
const q1 = priorQuarter(q2);
const q2Revenue = computeMetric("revenue", world, undefined, q2).value;
const heatmap = computeChart({ viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter", timeRange: q2 }, world);
const heatmapRevenue = heatmap.grid?.values.flat().reduce((sum, value) => sum + value, 0) ?? 0;
assert(Math.abs(q2Revenue - heatmapRevenue) <= 1, `Q2 revenue ${q2Revenue} does not match heatmap ${heatmapRevenue}`);

const q2BookToBill = computeMetric("book_to_bill", world, undefined, q2).value;
const q2Backlog = computeMetric("backlog", world, undefined, q2).value;
const q1Backlog = computeMetric("backlog", world, undefined, q1).value;
if (q2BookToBill > 1) assert(q2Backlog > q1Backlog, `book-to-bill ${q2BookToBill} should grow backlog (${q1Backlog} -> ${q2Backlog})`);

const rows = bookingsBacklogData as Array<{ month: string; bookings: number; shipments: number; backlog: number }>;
const q2Rows = rows.filter((r) => r.month >= q2.from && r.month <= q2.to);
const rollForward = q1Backlog + q2Rows.reduce((sum, r) => sum + r.bookings - r.shipments, 0);
assert(Math.abs(rollForward - q2Backlog) <= 2, `backlog roll-forward mismatch: expected ${rollForward}, got ${q2Backlog}`);

const winRate = computeMetric("win_rate", world, undefined, q2).value;
assert(winRate >= 25 && winRate <= 40, `Q2 win rate ${winRate}% outside 25-40% range`);

const concentration = computeMetric("customer_concentration", world, undefined, q2).value;
assert(concentration >= 20 && concentration <= 35, `Q2 customer concentration ${concentration}% outside 20-35% range`);

const fitScores = world.prospects.map((p) => scoreFit(p.company.needs, PROFILE.capabilities).score);
const perfectFits = fitScores.filter((score) => score > 90).length;
assert(perfectFits <= 2, `too many >90 fit scores: ${perfectFits}`);
assert(Math.min(...fitScores) <= 50 && Math.max(...fitScores) >= 75, "fit score distribution is too narrow");

// --- Round 7 reconciliation tests ---

function sumRawCell(accountId: string, months: string[]): number {
  return revenueRows.filter((r) => r.account_id === accountId && months.includes(r.month)).reduce((sum, r) => sum + r.revenue, 0);
}

// 1a: heatmap cell spot-check (3 cells)
const cellChecks: Array<{ accountId: string; quarter: string; months: string[] }> = [
  { accountId: "lonestar-aero-systems", quarter: "Q2 2026", months: ["2026-04", "2026-05", "2026-06"] },
  { accountId: "trinity-defense-components", quarter: "Q1 2026", months: ["2026-01", "2026-02", "2026-03"] },
  { accountId: "gulf-coast-propulsion", quarter: "Q3 2025", months: ["2025-07", "2025-08", "2025-09"] },
];
for (const check of cellChecks) {
  const expected = sumRawCell(check.accountId, check.months);
  const window = quarterWindow(check.quarter);
  const chart = computeChart({ viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter", timeRange: window }, world);
  const grid = chart.grid;
  assert(grid, `heatmap grid missing for ${check.quarter}`);
  const accountName = world.companies.find((c) => c.id === check.accountId)?.name ?? check.accountId;
  const rowIndex = grid!.rows.indexOf(accountName);
  assert(rowIndex >= 0, `account ${accountName} not found in heatmap rows for ${check.quarter}`);
  const rowValues = grid!.values[rowIndex].filter((v): v is number => v !== null);
  const cellValue = rowValues.reduce((a, b) => a + b, 0);
  assert(Math.abs(cellValue - expected) <= 1, `heatmap cell ${check.accountId}/${check.quarter}: expected ${expected}, got ${cellValue}`);
}

// 1b: Deck KPI == catalog == heatmap column total (Q2 2026)
const q2WindowRecon = quarterWindow("Q2 2026");
const catalogRevenue = computeMetric("revenue", world, undefined, q2WindowRecon).value;
const heatmapQ2 = computeChart({ viz: "heatmap", metric: "revenue", rows: "account", cols: "quarter", timeRange: q2WindowRecon }, world);
const heatmapColTotal = (heatmapQ2.grid?.values ?? []).flat().filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
assert(Math.abs(catalogRevenue - heatmapColTotal) <= 1, `catalog revenue ${catalogRevenue} != heatmap column total ${heatmapColTotal}`);

// 1c: same metric+window renders identically across surfaces
const deckContext = boardDeckAgent.contextRecipe({ quarter: "Q2 2026", audience: "board" }, world);
const deckRevenue = Number(deckContext.facts.revenue);
assert(Math.abs(deckRevenue - catalogRevenue) <= 1, `deck revenue ${deckRevenue} != catalog ${catalogRevenue}`);
assert(Math.abs(deckRevenue - heatmapColTotal) <= 1, `deck revenue ${deckRevenue} != heatmap total ${heatmapColTotal}`);

// 1d: revenue YoY change spot-check against raw JSON (mirrors catalog trailing-12 slicing)
const sortedRevenueRows = revenueRows.slice().sort((a, b) => a.month.localeCompare(b.month));
const currentTrailing = sortedRevenueRows.slice(-12);
const priorTrailing = sortedRevenueRows.slice(-24, -12);
const sumRows = (rows: typeof revenueRows) => rows.reduce((sum, r) => sum + r.revenue, 0);
const currentYear = sumRows(currentTrailing);
const priorYear = sumRows(priorTrailing);
const expectedYoY = ((currentYear - priorYear) / Math.max(1, priorYear)) * 100;
const catalogYoY = computeMetric("revenue_yoy_change", world).value;
assert(Number.isFinite(catalogYoY), `revenue YoY must be finite, got ${catalogYoY}`);
assert(catalogYoY !== 0, `revenue YoY should be non-zero`);
assert(Math.abs(catalogYoY - expectedYoY) <= 0.5, `revenue YoY: expected ${expectedYoY.toFixed(2)}, got ${catalogYoY}`);

// 1e: per-metric range + provenance checks across all 14 metrics
const METRIC_IDS_ALL = Object.keys(METRICS) as MetricId[];
assert(METRIC_IDS_ALL.length === 14, `expected 14 metrics, got ${METRIC_IDS_ALL.length}`);
const q1WindowRecon = priorQuarter(q2WindowRecon);
for (const id of METRIC_IDS_ALL) {
  const r = computeMetric(id, world, undefined, q1WindowRecon);
  assert(Number.isFinite(r.value), `${id} produced non-finite value`);
  assert(typeof r.value === "number", `${id} value is not a number`);
  assert(r.provenance.length > 0, `${id} missing provenance`);
  if (id === "revenue_yoy_change") {
    assert(Number.isFinite(r.value), `${id} must be finite`);
  } else if (r.unit === "%") {
    assert(r.value >= 0 && r.value <= 100, `${id} percent ${r.value} outside 0-100`);
  } else if (r.unit === "$") {
    assert(r.value > 0, `${id} dollar value ${r.value} not > 0`);
  } else if (r.unit === "ratio") {
    assert(r.value > 0, `${id} ratio ${r.value} not > 0`);
  }
}

console.log(`metrics ok: ${Object.keys(METRICS).length} metrics, ${specs.length} chart specs`);
console.log(`reconciliation ok: 3 heatmap cells, deck==catalog==heatmap, YoY spot-check, 14 metric range checks`);
