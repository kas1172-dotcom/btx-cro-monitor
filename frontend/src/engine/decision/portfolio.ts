// Portfolio-level decision logic: score many subjects, rank them, and derive
// alerts from deterministic thresholds. Still NO AI — same inputs, same output.
// Alert thresholds live in the same versioned config as the weights.

import { scoreSubject } from "./score.ts";
import type { Contribution, CompanyScore } from "./score.ts";
import { SCORE_DIMENSIONS } from "../signals/contract.ts";
import type { ScoreDimension, Signal } from "../signals/contract.ts";
import type { WeightsConfig } from "./weights.ts";

export function scorePortfolio(
  subjectIds: string[],
  signals: Signal[],
  config: WeightsConfig,
): CompanyScore[] {
  return subjectIds.map((id) => scoreSubject(id, signals, config));
}

/** Rank by one dimension, highest first; ties broken by id for full determinism. */
export function rankBy(scores: CompanyScore[], dimension: ScoreDimension): CompanyScore[] {
  return [...scores].sort(
    (a, b) =>
      b.dimensions[dimension].score - a.dimensions[dimension].score ||
      a.subject_id.localeCompare(b.subject_id),
  );
}

export interface Alert {
  subject_id: string;
  dimension: ScoreDimension;
  score: number;
  severity: "elevated" | "high";
  /** The single biggest signal behind this dimension — the headline of the trace. */
  reason: string;
}

function topReason(contributions: Contribution[]): string {
  if (contributions.length === 0) return "no contributing signals";
  const top = contributions.reduce((a, b) => (b.delta > a.delta ? b : a));
  return `${top.event_type} (+${top.delta})`;
}

export function deriveAlerts(scores: CompanyScore[], config: WeightsConfig): Alert[] {
  const alerts: Alert[] = [];
  for (const s of scores) {
    for (const dimension of SCORE_DIMENSIONS) {
      const threshold = config.alert_thresholds[dimension];
      if (threshold === undefined) continue;
      const d = s.dimensions[dimension];
      if (d.score < threshold) continue;
      alerts.push({
        subject_id: s.subject_id,
        dimension,
        score: d.score,
        severity: d.score >= threshold + 20 ? "high" : "elevated",
        reason: topReason(d.contributions),
      });
    }
  }
  return alerts.sort(
    (a, b) =>
      b.score - a.score ||
      a.subject_id.localeCompare(b.subject_id) ||
      a.dimension.localeCompare(b.dimension),
  );
}
