// The decision engine. Deterministic, reproducible, explainable. NO AI here.
// Same signals + same weights config => byte-identical output, every time.
//
// Diminishing returns: repeated signals of the SAME event_type for a subject
// decay — the 1st (most recent) is worth full weight, the 2nd weight×decay, the
// 3rd weight×decay², ... This keeps the trace additive (every contribution is
// still an explicit number that sums to the score) while stopping a single
// repeated headline from saturating a dimension. The decay factor is config.
//
// Every point added is recorded as a Contribution, so the score is its own audit
// trail.

import { SCORE_DIMENSIONS } from "../signals/contract.ts";
import type { ScoreDimension, Signal } from "../signals/contract.ts";
import type { WeightsConfig } from "./weights.ts";

export interface Contribution {
  signal_id: string;
  event_type: string;
  /** 1 = first (full weight) occurrence of this event_type, 2 = decayed, ... */
  occurrence: number;
  /** weight × repeat_decay^(occurrence-1), rounded. */
  delta: number;
}

export interface DimensionScore {
  dimension: ScoreDimension;
  /** Final value after clamping to [0, dimension_cap]. */
  score: number;
  /** Pre-clamp sum — distinguishes "barely 100" from "pinned far past the cap". */
  raw: number;
  /** Every signal that moved this dimension, and by how much. */
  contributions: Contribution[];
}

export interface CompanyScore {
  subject_id: string;
  weights_version: string;
  signal_count: number;
  dimensions: Record<ScoreDimension, DimensionScore>;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

function scoresSubject(signal: Signal, subjectId: string): boolean {
  if (signal.scope === undefined) return signal.subject_id === subjectId;
  if (signal.scope !== "specific_account") return false;
  return signal.relationships?.some((record) => record.canonical_account_id === subjectId) === true;
}

/**
 * Score one subject from its (already validated) signals. Signals not belonging
 * to `subjectId` are ignored, so callers may pass a mixed list safely.
 */
export function scoreSubject(
  subjectId: string,
  signals: Signal[],
  config: WeightsConfig,
): CompanyScore {
  const dims = {} as Record<ScoreDimension, DimensionScore>;
  for (const dimension of SCORE_DIMENSIONS) {
    dims[dimension] = { dimension, score: 0, raw: 0, contributions: [] };
  }

  const mine = signals.filter((s) => scoresSubject(s, subjectId));

  // Group by event_type so repeats of the same kind decay together.
  const byType = new Map<string, Signal[]>();
  for (const s of mine) {
    const arr = byType.get(s.event_type) ?? [];
    arr.push(s);
    byType.set(s.event_type, arr);
  }

  for (const [eventType, group] of byType) {
    const row = config.weights[eventType];
    if (!row) continue; // unknown event types contribute nothing

    // Most recent first gets full weight; older repeats decay. Tie-break on id
    // keeps it deterministic when timestamps collide.
    const ordered = [...group].sort(
      (a, b) => b.detected_at.localeCompare(a.detected_at) || a.id.localeCompare(b.id),
    );

    ordered.forEach((signal, idx) => {
      const factor = Math.pow(config.repeat_decay, idx);
      for (const dimension of SCORE_DIMENSIONS) {
        const weight = row[dimension];
        if (weight === undefined || weight === 0) continue;
        const delta = Math.round(weight * factor);
        if (delta === 0) continue;
        const bucket = dims[dimension];
        bucket.raw += delta;
        bucket.contributions.push({
          signal_id: signal.id,
          event_type: eventType,
          occurrence: idx + 1,
          delta,
        });
      }
    });
  }

  for (const dimension of SCORE_DIMENSIONS) {
    const d = dims[dimension];
    d.contributions.sort((a, b) => b.delta - a.delta || a.signal_id.localeCompare(b.signal_id));
    d.score = clamp(d.raw, config.dimension_cap);
  }

  return {
    subject_id: subjectId,
    weights_version: config.version,
    signal_count: mine.length,
    dimensions: dims,
  };
}

/** Deterministic, template-based English from the trace. No LLM. */
export function explainDimension(d: DimensionScore): string {
  if (d.contributions.length === 0) return `${d.dimension}: 0 (no contributing signals)`;
  const parts = d.contributions.map((c) => `${c.event_type} (+${c.delta})`).join(", ");
  const note = d.raw > d.score ? ` [capped from ${d.raw}]` : "";
  return `${d.dimension}: ${d.score}${note} — ${parts}`;
}
