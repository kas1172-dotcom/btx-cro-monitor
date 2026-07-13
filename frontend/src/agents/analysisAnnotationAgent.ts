import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { computeMetric } from "../metrics/catalog.ts";
import { priorQuarter, quarterWindow } from "../metrics/time.ts";
import type { MetricId } from "../metrics/types.ts";
import type { AgentContext, DeliverableAgent } from "./contract.ts";
import { validateRequiredSections } from "./contract.ts";
import { AGENT_RUBRICS } from "./rubrics.ts";

const Inputs = z.object({
  metric: z.string().default("revenue"),
  quarter: z.string().default("Q2 2026"),
  instructions: z.string().optional(),
});

type Inputs = z.infer<typeof Inputs>;

const sectionSpec = [
  { id: "annotation", heading: "Analysis Annotation", required: true },
];

export const analysisAnnotationAgent: DeliverableAgent<Inputs> = {
  id: "analysis_annotation",
  audience: "internal",
  form: "view",
  inputs: Inputs,
  outputSchema: sectionSpec,
  rubric: AGENT_RUBRICS.analysis_annotation,
  contextRecipe(inputs: Inputs, world: World): AgentContext {
    const metric = inputs.metric as MetricId;
    const window = quarterWindow(inputs.quarter);
    const prior = priorQuarter(window);
    const result = computeMetric(metric, world, undefined, window);
    const priorResult = computeMetric(metric, world, undefined, prior);

    let topAccountName = "";
    let topAccountValue = 0;
    let activeAccountCount = 0;

    if (metric === "revenue" || metric === "margin_trend" || metric === "customer_concentration") {
      const accountValues = world.companies
        .filter((c) => c.relationship === "customer")
        .map((c) => ({
          name: c.name,
          value: computeMetric(metric, world, { accountId: c.id }, window).value,
        }))
        .filter((av) => av.value > 0)
        .sort((a, b) => b.value - a.value);
      activeAccountCount = accountValues.length;
      topAccountName = accountValues[0]?.name ?? "";
      topAccountValue = accountValues[0]?.value ?? 0;
    }

    const qoqChange = priorResult.value > 0
      ? ((result.value - priorResult.value) / priorResult.value) * 100
      : 0;

    return {
      facts: {
        metric,
        quarter: inputs.quarter,
        priorQuarter: prior.label,
        value: result.value,
        priorValue: priorResult.value,
        qoqChange,
        unit: result.unit,
        label: result.label,
        topAccountName,
        topAccountValue,
        activeAccountCount,
        topSharePct: result.value > 0 ? Math.round((topAccountValue / result.value) * 100) : 0,
      },
      entityIds: world.companies.filter((c) => c.relationship === "customer").map((c) => c.id).slice(0, 6),
      sources: [...result.provenance, ...priorResult.provenance],
    };
  },
  async compose(ctx): Promise<Deliverable> {
    const f = ctx.facts;
    const fmt = (v: number) => {
      if (String(f.unit) === "$") return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`;
      if (String(f.unit) === "%") return `${Math.round(v)}%`;
      return v.toFixed(2);
    };
    const value = Number(f.value);
    const prior = Number(f.priorValue);
    const qoq = Number(f.qoqChange);
    const trendWord = qoq > 5 ? "up" : qoq < -5 ? "down" : "roughly flat";
    const trendSentence = prior > 0
      ? `This is ${trendWord} ${Math.abs(Math.round(qoq))}% versus ${f.priorQuarter} (${fmt(prior)}).`
      : `No prior-quarter data available for comparison.`;
    const topShare = Number(f.topSharePct);
    const concentrationNote = topShare > 30
      ? `${f.topAccountName} holds ${topShare}% of the quarter \u2014 concentration warrants monitoring.`
      : topShare > 0 ? `Top account is ${f.topAccountName} at ${topShare}% \u2014 no single-account concentration risk.` : "";

    const annotation = [
      `${f.label} for ${f.quarter}: ${fmt(value)}${Number(f.activeAccountCount) > 0 ? ` across ${f.activeAccountCount} active accounts` : ""}.`,
      f.topAccountName ? `${f.topAccountName} leads with ${fmt(Number(f.topAccountValue))} (${topShare}% of total).` : "",
      trendSentence,
      concentrationNote,
    ].filter(Boolean).join(" ");

    return {
      id: `deliv-${Date.now()}-analysis-annotation`,
      type: "analysis_view",
      title: `${f.label} Annotation \u2014 ${f.quarter}`,
      createdAt: new Date().toISOString(),
      brainArea: "analysis",
      entityIds: ctx.entityIds,
      confidence: prior > 0 ? "high" : "medium",
      confidenceReason: prior > 0 ? "Current and prior quarter data both available." : "No prior quarter for comparison.",
      sections: [
        {
          id: "annotation",
          heading: "Analysis Annotation",
          blocks: [
            { kind: "text", text: annotation },
          ],
        },
      ],
      sources: ctx.sources,
      actions: [{ id: "copy", label: "Copy", kind: "copy" }],
    };
  },
  validate(deliverable, ctx) {
    return validateRequiredSections(deliverable, sectionSpec.map((s) => ({ id: s.id, heading: s.heading, blocks: [] })), ctx);
  },
};
