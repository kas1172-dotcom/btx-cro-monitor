import type { AgentContext } from "../agents/contract.ts";
import type { Deliverable, DeliverableSection } from "./types.ts";

const DOMAIN_CLAIMS: Array<{ domain: string; pattern: RegExp; metrics: string[] }> = [
  { domain: "capacity", pattern: /\b(?:open|available|constrained|limited|binding)\s+(?:production\s+)?capacity\b|\bcapacity\s+(?:is|appears|remains)\b/i, metrics: ["capacity_utilization"] },
  { domain: "pipeline", pattern: /\bpipeline\s+(?:is|remains|totals|coverage|value)\b|\$\S*\s+pipeline\b/i, metrics: ["pipeline_by_stage", "pipeline_coverage"] },
  { domain: "margin", pattern: /\bmargin\s+(?:is|rose|fell|improved|declined|trend)\b/i, metrics: ["margin_trend"] },
  { domain: "demand", pattern: /\bdemand\s+(?:is|remains|accelerating|strong|weak|not the problem)\b/i, metrics: ["pipeline_by_stage"] },
  { domain: "risk", pattern: /\b(?:at risk|risk\s+(?:is|remains|score|increased|decreased))\b/i, metrics: ["risk"] },
  { domain: "health", pattern: /\b(?:healthy|unhealthy|relationship health is|pipeline health is)\b/i, metrics: ["health"] },
];

function sectionText(sections: DeliverableSection[]): string {
  return sections.flatMap((section) => section.blocks).map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return [block.columns, ...block.rows].flat().join(" ");
    return block.title;
  }).join(" ");
}

function numericTokens(text: string): string[] {
  return [...new Set([...text.matchAll(/\$\d+(?:,\d{3})*(?:\.\d+)?(?:[kKmM])?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s+(?:days?|weeks?|months?|years?|hours?|units?|deals?|opportunities?)/g)]
    .map((match) => match[0].replace(/[$,%]/g, "").replace(/[kKmM]$/, "").replace(/\s+(?:days?|weeks?|months?|years?|hours?|units?|deals?|opportunities?)$/, "")))];
}

export function assessDeliverableQuality(deliverable: Deliverable, ctx?: AgentContext): NonNullable<Deliverable["quality"]> {
  const errors: string[] = [];
  const text = sectionText(deliverable.sections);
  const grounding = ctx
    ? [...Object.values(ctx.facts).map(String), ...ctx.sources.flatMap((source) => [source.reason, ...source.records])].join(" ")
    : deliverable.sources.flatMap((source) => [source.reason, ...source.records]).join(" ");
  const groundedTokens = new Set(numericTokens(grounding));
  for (const value of Object.values(ctx?.facts ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    groundedTokens.add(String(value));
    if (Math.abs(value) >= 1_000) groundedTokens.add(String(Math.round((value / 1_000) * 10) / 10));
    if (Math.abs(value) >= 1_000_000) groundedTokens.add(String(Math.round((value / 1_000_000) * 10) / 10));
  }
  const ungroundedNumbers = numericTokens(text).filter((token) => !groundedTokens.has(token));
  if (ungroundedNumbers.length) errors.push(`Claims lack an exact source value: ${ungroundedNumbers.join(", ")}`);

  let dataAvailable = true;
  let freshnessKnown = true;
  for (const claim of DOMAIN_CLAIMS) {
    if (!claim.pattern.test(text)) continue;
    const states = claim.metrics.map((metric) => ctx?.metricStates?.[metric]).filter(Boolean);
    if (!states.length || states.every((state) => state?.state !== "available")) {
      dataAvailable = false;
      errors.push(`${claim.domain} conclusion has no available metric state`);
    }
    if (states.some((state) => state?.state === "available" && !state.asOf)) {
      freshnessKnown = false;
      errors.push(`${claim.domain} conclusion has no source freshness timestamp`);
    }
  }

  const sourceByRecord = new Map<string, string[]>();
  for (const source of ctx?.sources ?? deliverable.sources) {
    for (const record of source.records) sourceByRecord.set(record, [...(sourceByRecord.get(record) ?? []), source.reason.toLowerCase()]);
  }
  for (const [record, reasons] of sourceByRecord) {
    if (reasons.some((reason) => /unavailable|missing|not connected/.test(reason)) && reasons.some((reason) => /available|verified|connected/.test(reason))) {
      errors.push(`Contradictory source status for ${record}`);
    }
  }

  const lockedFactsValid = ungroundedNumbers.length === 0;
  return {
    valid: errors.length === 0,
    errors,
    checkedAt: new Date().toISOString(),
    claimSourceGrounded: ungroundedNumbers.length === 0,
    dataAvailable,
    freshnessKnown,
    lockedFactsValid,
  };
}

export function invalidateLegacyDeliverable(deliverable: Deliverable): Deliverable {
  if (deliverable.quality?.valid === false || deliverable.invalidatedAt) return deliverable;
  if (!/^Q2 2026 Revenue Review$/i.test(deliverable.title)) return deliverable;
  return {
    ...deliverable,
    invalidatedAt: new Date().toISOString(),
    invalidationReason: "Invalidated: legacy review predates typed metric availability and semantic claim grounding. Regenerate from current sources.",
    quality: {
      valid: false,
      errors: ["Legacy revenue review requires regeneration under the current metric-state contract."],
      checkedAt: new Date().toISOString(),
      claimSourceGrounded: false,
      dataAvailable: false,
      freshnessKnown: false,
      lockedFactsValid: false,
    },
  };
}
