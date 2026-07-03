// pipelineHealth — now derived from the actual Opportunity pipeline (deals),
// not from news-signal sentiment. Healthy = lots of weighted open value in late
// stages, few recent losses. Deterministic, no AI.

import type { Opportunity } from "../brain/entities.ts";

const STAGE_WEIGHT: Record<string, number> = { prospecting: 0.3, qualified: 0.6, proposal: 1.0 };

export function pipelineHealth(opps: Opportunity[]): number {
  const weightedOpen = opps
    .filter((o) => o.stage in STAGE_WEIGHT)
    .reduce((sum, o) => sum + o.value * STAGE_WEIGHT[o.stage], 0);
  const won = opps.filter((o) => o.stage === "won").length;
  const lost = opps.filter((o) => o.stage === "lost").length;
  // Baseline 40; up to +35 for a strong weighted open book; wins lift, losses drag.
  const raw = 40 + Math.min(35, weightedOpen / 700_000) + won * 3 - lost * 4;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function healthLabel(score: number): string {
  if (score >= 65) return "healthy";
  if (score >= 45) return "steady";
  return "at risk";
}
