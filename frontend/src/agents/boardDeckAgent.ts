import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import { latestCompletedQuarter, sixMonthTrendRangeForQuarter } from "../app/dateDefaults.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { computeMetric } from "../metrics/catalog.ts";
import { priorQuarter, quarterWindow } from "../metrics/time.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  quarter: z.string().default(() => latestCompletedQuarter()),
  audience: z.enum(["board", "ceo", "internal"]).default("board"),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sectionSpec = [
  { id: "quarter-verdict", heading: "Quarter in One Slide", required: true },
  { id: "executive-summary", heading: "Executive Summary", required: true },
  { id: "kpi-strip", heading: "KPI Strip", required: true },
  { id: "growth", heading: "Growth", required: true },
  { id: "predictability", heading: "Predictability", required: true },
  { id: "efficiency", heading: "Efficiency", required: true },
  { id: "concentration-risks", heading: "Concentration & Risks", required: true },
  { id: "risk-register", heading: "Risk Register", required: true },
  { id: "priorities", heading: "Priorities and Asks", required: true },
];

function money(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1_000)}k`;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export const boardDeckAgent: DeliverableAgent<Inputs> = {
  id: "board_deck",
  audience: "board",
  form: "deck",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.board_deck,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const window = quarterWindow(inputs.quarter);
    const prior = priorQuarter(window);
    const trendRange = sixMonthTrendRangeForQuarter(inputs.quarter);
    const metrics = {
      revenue: computeMetric("revenue", world, undefined, window),
      bookings: computeMetric("bookings", world, undefined, window),
      backlog: computeMetric("backlog", world, undefined, window),
      bookToBill: computeMetric("book_to_bill", world, undefined, window),
      winRate: computeMetric("win_rate", world, undefined, window),
      capacity: computeMetric("capacity_utilization", world, undefined, window),
      concentration: computeMetric("customer_concentration", world, undefined, window),
      margin: computeMetric("margin_trend", world, undefined, window),
      aov: computeMetric("avg_order_value", world, undefined, window),
      pipelineCoverage: computeMetric("pipeline_coverage", world, undefined, window),
      priorBacklog: computeMetric("backlog", world, undefined, prior),
    };
    const topRisk = [...world.analysis.scores].sort((a, b) => b.dimensions.risk.score - a.dimensions.risk.score).slice(0, 5);
    const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
    return {
      facts: {
        quarter: inputs.quarter,
        windowFrom: window.from,
        windowTo: window.to,
        audience: inputs.audience,
        revenue: metrics.revenue.value,
        bookings: metrics.bookings.value,
        backlog: metrics.backlog.value,
        priorBacklog: metrics.priorBacklog.value,
        bookToBill: metrics.bookToBill.value,
        winRate: metrics.winRate.value,
        capacity: metrics.capacity.value,
        concentration: metrics.concentration.value,
        margin: metrics.margin.value,
        aov: metrics.aov.value,
        pipelineCoverage: metrics.pipelineCoverage.value,
        topRiskName: nameOf(topRisk[0]?.subject_id ?? ""),
        topRiskScore: topRisk[0]?.dimensions.risk.score ?? 0,
        riskRows: JSON.stringify(topRisk.map((risk) => {
          const score = risk.dimensions.risk;
          return {
            name: nameOf(risk.subject_id),
            score: score.score,
            driver: score.contributions[0]?.event_type?.replace(/_/g, " ") ?? "validated signal",
          };
        })),
      },
      entityIds: topRisk.map((r) => r.subject_id),
      sources: mergeSources([
        ...metrics.revenue.provenance,
        ...metrics.bookings.provenance,
        ...metrics.backlog.provenance,
        ...metrics.winRate.provenance,
        { source: "scoring trace", records: topRisk.map((r) => r.subject_id), reason: "Top account risks for board risk register." },
      ]),
    };
  },
  async compose(ctx): Promise<Deliverable> {
    const f = ctx.facts;
    const trendRange = sixMonthTrendRangeForQuarter(String(f.quarter));
    return {
      id: `deliv-${Date.now()}-board-deck`,
      type: "board_deck",
      title: `${f.quarter} Revenue Review`,
      createdAt: new Date().toISOString(),
      brainArea: "analysis",
      entityIds: ctx.entityIds,
      confidence: "high",
      sections: [
        {
          id: "quarter-verdict",
          heading: "Quarter in One Slide",
          blocks: [
            { kind: "text", text: `Demand is steady but capacity discipline matters: ${Number(f.bookToBill).toFixed(2)} book-to-bill on ${money(Number(f.revenue))} ${f.quarter} revenue.` },
            { kind: "text", text: `Backlog ended at ${money(Number(f.backlog))}, ${Number(f.backlog) >= Number(f.priorBacklog) ? "up" : "down"} from the prior quarter, while win rate was ${pct(Number(f.winRate))}.` },
            { kind: "text", text: `Priority: protect the riskiest accounts while using capacity selectively on high-fit growth.` },
          ],
        },
        {
          id: "executive-summary",
          heading: "Executive Summary",
          blocks: [
            { kind: "text", text: `Verdict: ${f.quarter} is a healthy but capacity-sensitive quarter, with demand slightly ahead of shipments and account risk requiring follow-up.` },
            { kind: "text", text: `Evidence: revenue was ${money(Number(f.revenue))}, bookings were ${money(Number(f.bookings))}, book-to-bill was ${Number(f.bookToBill).toFixed(2)}, and backlog ended at ${money(Number(f.backlog))}.` },
            { kind: "text", text: `Implication: leadership should protect ${f.topRiskName}, prioritize high-fit work, and avoid filling constrained capacity with low-fit demand.` },
          ],
        },
        {
          id: "kpi-strip",
          heading: "KPI Strip",
          blocks: [{
            kind: "table",
            columns: ["Metric", "Value", "So what"],
            rows: [
              ["Revenue", money(Number(f.revenue)), "Recognized current-business revenue"],
              ["Bookings", money(Number(f.bookings)), "New order intake"],
              ["Backlog", money(Number(f.backlog)), "End-of-quarter backlog"],
              ["Book-to-bill", Number(f.bookToBill).toFixed(2), "Demand vs shipments"],
              ["Win rate", pct(Number(f.winRate)), "Commercial conversion"],
            ],
          }],
        },
        {
          id: "growth",
          heading: `Growth: demand ${Number(f.bookToBill) >= 1 ? "outruns" : "trails"} shipments at ${Number(f.bookToBill).toFixed(2)} book-to-bill`,
          blocks: [
            { kind: "chart-spec", title: "Bookings trend", spec: { viz: "trend", metric: "bookings", timeRange: trendRange } },
            { kind: "chart-spec", title: "Backlog trend", spec: { viz: "trend", metric: "backlog", timeRange: trendRange } },
            { kind: "chart-spec", title: "Book-to-bill trend", spec: { viz: "trend", metric: "book_to_bill", timeRange: trendRange } },
          ],
        },
        {
          id: "predictability",
          heading: `Predictability: pipeline coverage is ${Number(f.pipelineCoverage).toFixed(1)}x versus a 3.0x planning target`,
          blocks: [
            { kind: "chart-spec", title: "Pipeline coverage trend", spec: { viz: "trend", metric: "pipeline_coverage", timeRange: trendRange } },
            { kind: "text", text: `Coverage is calculated as weighted pipeline divided by average monthly revenue in the quarter.` },
          ],
        },
        {
          id: "efficiency",
          heading: `Efficiency: capacity averages ${pct(Number(f.capacity))}, margin ${pct(Number(f.margin))}`,
          blocks: [
            { kind: "chart-spec", title: "Capacity utilization trend", spec: { viz: "trend", metric: "capacity_utilization", timeRange: trendRange } },
            { kind: "chart-spec", title: "Average order value trend", spec: { viz: "trend", metric: "avg_order_value", timeRange: trendRange } },
          ],
        },
        {
          id: "concentration-risks",
          heading: `Concentration is ${pct(Number(f.concentration))}; top risks need account action`,
          blocks: [
            { kind: "chart-spec", title: "Revenue concentration by account", spec: { viz: "ranked_bar", metric: "revenue", rows: "account", timeRange: { from: String(f.windowFrom), to: String(f.windowTo) } } },
          ],
        },
        {
          id: "risk-register",
          heading: "Risk Register",
          blocks: [{
            kind: "table",
            columns: ["Account", "Risk score", "Top driver", "Action"],
            rows: JSON.parse(String(f.riskRows)).map((row: { name: string; score: number; driver: string }) => [row.name, String(row.score), row.driver, "Create account follow-up"]),
          }],
        },
        {
          id: "priorities",
          heading: "Priorities and Asks",
          blocks: [
            { kind: "text", text: `Protect accounts with elevated risk before they become delivery or revenue slippage.` },
            { kind: "text", text: `Use ${pct(Number(f.capacity))} average capacity utilization to keep sales focus aligned with production reality.` },
            { kind: "text", text: `Watch customer concentration at ${pct(Number(f.concentration))} and keep prospecting active in priority markets.` },
          ],
        },
      ],
      sources: ctx.sources,
      actions: [
        { id: "download-pptx", label: "Download PPTX", kind: "download_markdown" },
        { id: "copy", label: "Copy", kind: "copy" },
      ],
    };
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sectionSpec.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
  },
};

function mergeSources(sources: AgentContext["sources"]): AgentContext["sources"] {
  const bySource = new Map<string, { records: Set<string>; reasons: Set<string> }>();
  for (const source of sources) {
    const existing = bySource.get(source.source) ?? { records: new Set<string>(), reasons: new Set<string>() };
    source.records.forEach((record) => existing.records.add(record));
    existing.reasons.add(source.reason);
    bySource.set(source.source, existing);
  }
  return [...bySource.entries()].map(([source, value]) => ({
    source,
    records: [...value.records],
    reason: [...value.reasons].join(" "),
  }));
}
