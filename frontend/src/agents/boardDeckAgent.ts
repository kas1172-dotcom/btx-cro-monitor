import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import { latestCompletedQuarter, sixMonthTrendRangeForQuarter } from "../app/dateDefaults.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { computeMetric } from "../metrics/catalog.ts";
import { priorQuarter, quarterWindow } from "../metrics/time.ts";
import type { MetricResult } from "../metrics/types.ts";
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

function available(metric: MetricResult): metric is MetricResult & { value: number } {
  return (metric.state === "available" || metric.state === "stale") && typeof metric.value === "number";
}

function unavailableLine(metric: MetricResult): string {
  return `${metric.label}: ${metric.reason}`;
}

function metricNumber(facts: Record<string, unknown>, key: string): number | null {
  const value = facts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textSection(id: string, heading: string, text: string) {
  return { id, heading, blocks: [{ kind: "text" as const, text }] };
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
    const unavailableMetrics = Object.values(metrics).filter((metric) => !available(metric));
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
        topRiskScore: topRisk[0]?.dimensions.risk.score ?? null,
        riskRows: JSON.stringify(topRisk.map((risk) => {
          const score = risk.dimensions.risk;
          return {
            name: nameOf(risk.subject_id),
            score: score.score,
            driver: score.contributions[0]?.event_type?.replace(/_/g, " ") ?? "validated signal",
          };
        })),
        unavailableMetrics: JSON.stringify(unavailableMetrics.map(unavailableLine)),
        metricCoverage: Object.values(metrics).filter(available).length,
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
    const revenue = metricNumber(f, "revenue");
    const bookings = metricNumber(f, "bookings");
    const backlog = metricNumber(f, "backlog");
    const priorBacklog = metricNumber(f, "priorBacklog");
    const bookToBill = metricNumber(f, "bookToBill");
    const winRate = metricNumber(f, "winRate");
    const capacity = metricNumber(f, "capacity");
    const concentration = metricNumber(f, "concentration");
    const margin = metricNumber(f, "margin");
    const aov = metricNumber(f, "aov");
    const pipelineCoverage = metricNumber(f, "pipelineCoverage");
    const unavailableMetrics = JSON.parse(String(f.unavailableMetrics || "[]")) as string[];
    const availableCount = Number(f.metricCoverage ?? 0);
    const confidence: Deliverable["confidence"] = availableCount >= 7 && ctx.sources.some((source) => source.records.length > 0) ? "high" : availableCount >= 3 ? "medium" : "low";
    const confidenceReason = availableCount
      ? `${availableCount} approved metric inputs were available; unavailable sections are suppressed.`
      : "No approved operating metric inputs were available; the preview only lists missing inputs.";
    const sections: Deliverable["sections"] = [];
    sections.push(textSection(
      "quarter-verdict",
      "Quarter in One Slide",
      availableCount
        ? `This ${f.quarter} review includes only evidence-backed metrics. Sections without approved source data are omitted.`
        : `The ${f.quarter} revenue review cannot state revenue, bookings, backlog, margin, pipeline, concentration, or capacity findings because approved source datasets are unavailable.`,
    ));
    sections.push(textSection(
      "executive-summary",
      "Executive Summary",
      unavailableMetrics.length
        ? `Missing required inputs: ${unavailableMetrics.join("; ")}.`
        : `All required operating inputs were available for ${f.quarter}.`,
    ));
    if ([revenue, bookings, backlog, bookToBill, winRate].some((value) => value !== null)) {
      sections.push({
        id: "kpi-strip",
        heading: "KPI Strip",
        blocks: [{
          kind: "table",
          columns: ["Metric", "Value", "So what"],
          rows: [
            revenue !== null ? ["Revenue", money(revenue), "Recognized current-business revenue"] : null,
            bookings !== null ? ["Bookings", money(bookings), "New order intake"] : null,
            backlog !== null ? ["Backlog", money(backlog), "End-of-quarter backlog"] : null,
            bookToBill !== null ? ["Bookings vs shipped revenue", bookToBill.toFixed(2), "Demand vs shipments"] : null,
            winRate !== null ? ["Win rate", pct(winRate), "Commercial conversion"] : null,
          ].filter((row): row is string[] => Boolean(row)),
        }],
      });
    }
    if (bookings !== null || backlog !== null || bookToBill !== null) {
      sections.push({
        id: "growth",
        heading: "Growth",
        blocks: [
          ...(bookings !== null ? [{ kind: "chart-spec" as const, title: "Bookings trend", spec: { viz: "trend", metric: "bookings", timeRange: trendRange } }] : []),
          ...(backlog !== null ? [{ kind: "chart-spec" as const, title: "Backlog trend", spec: { viz: "trend", metric: "backlog", timeRange: trendRange } }] : []),
          ...(bookToBill !== null ? [{ kind: "chart-spec" as const, title: "Bookings versus shipped revenue trend", spec: { viz: "trend", metric: "book_to_bill", timeRange: trendRange } }] : []),
        ],
      });
    }
    if (pipelineCoverage !== null) {
      sections.push({
        id: "predictability",
        heading: `Predictability: pipeline coverage is ${pipelineCoverage.toFixed(1)}x versus a 3.0x planning target`,
        blocks: [
          { kind: "chart-spec", title: "Pipeline coverage trend", spec: { viz: "trend", metric: "pipeline_coverage", timeRange: trendRange } },
          { kind: "text", text: "Coverage is calculated as weighted pipeline divided by average monthly revenue in the quarter." },
        ],
      });
    }
    if (capacity !== null || margin !== null || aov !== null) {
      sections.push({
        id: "efficiency",
        heading: capacity !== null && margin !== null ? `Efficiency: work-center load averages ${pct(capacity)}, margin ${pct(margin)}` : "Efficiency",
        blocks: [
          ...(capacity !== null ? [{ kind: "chart-spec" as const, title: "Work-center load trend", spec: { viz: "trend", metric: "capacity_utilization", timeRange: trendRange } }] : []),
          ...(aov !== null ? [{ kind: "chart-spec" as const, title: "Average order value trend", spec: { viz: "trend", metric: "avg_order_value", timeRange: trendRange } }] : []),
          ...(margin !== null ? [{ kind: "text" as const, text: `Margin is ${pct(margin)} for the available approved records.` }] : []),
        ],
      });
    }
    if (concentration !== null && revenue !== null) {
      sections.push({
        id: "concentration-risks",
        heading: `Concentration is ${pct(concentration)}; top risks need account action`,
        blocks: [
          { kind: "chart-spec", title: "Revenue concentration by account", spec: { viz: "ranked_bar", metric: "revenue", rows: "account", timeRange: { from: String(f.windowFrom), to: String(f.windowTo) } } },
        ],
      });
    }
    const riskRows = JSON.parse(String(f.riskRows)) as Array<{ name: string; score: number; driver: string }>;
    if (riskRows.length) {
      sections.push({
        id: "risk-register",
        heading: "Risk Register",
        blocks: [{
          kind: "table",
          columns: ["Account", "Risk score", "Top driver", "Action"],
          rows: riskRows.map((row) => [row.name, String(row.score), row.driver, "Create account follow-up"]),
        }],
      });
    }
    sections.push(textSection(
      "priorities",
      "Priorities and Asks",
      capacity !== null
        ? `Use ${pct(capacity)} average work-center load to keep sales focus aligned with production reality.`
        : "Before setting revenue or capacity priorities, connect approved operating datasets for revenue, bookings, backlog, pipeline, margin, concentration, and work-center load.",
    ));
    return {
      id: `deliv-${Date.now()}-board-deck`,
      type: "board_deck",
      title: `${f.quarter} Revenue Review`,
      createdAt: new Date().toISOString(),
      brainArea: "analysis",
      entityIds: ctx.entityIds,
      confidence,
      confidenceReason,
      sections,
      sources: ctx.sources,
      actions: [
        { id: "download-pptx", label: "Download PPTX", kind: "download_markdown" },
        { id: "copy", label: "Copy", kind: "copy" },
      ],
    };
  },
  validate(deliverable, ctx) {
    const required = sectionSpec
      .filter((section) => deliverable.sections.some((actual) => actual.id === section.id))
      .map((s) => ({ id: s.id, heading: s.heading, blocks: [] }));
    const base = validateRequiredSections(deliverable, required, ctx);
    const unavailable = String(ctx.facts.unavailableMetrics ?? "[]");
    const mentionsMissingInputs = deliverable.sections.some((section) => section.blocks.some((block) => block.kind === "text" && /Missing required inputs/i.test(block.text)));
    if (unavailable !== "[]" && !mentionsMissingInputs) {
      return { valid: false, errors: [...base.errors, "Unavailable metrics must be stated as missing inputs."] };
    }
    return base;
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
