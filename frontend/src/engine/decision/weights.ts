// The shape of the decision config. The VALUES live in a versioned JSON file
// (data/config/scoring-weights.v1.json) that the engine receives as input —
// they are not hardcoded here. "Retraining" the model = shipping a new file.
// This keeps scoring deterministic at runtime while remaining tunable offline.

import type { ScoreDimension } from "../signals/contract.ts";
import type { Relationship } from "../brain/entities.ts";

/** Per-event-type deltas: how much each dimension moves when this event fires. */
export type WeightRow = Partial<Record<ScoreDimension, number>>;

/**
 * A self-lens rule: a related entity's score in `source` dimension, scaled by
 * `factor`, is folded into the client's `target` dimension. This is how a
 * competitor's opportunity becomes the client's competitivePressure, etc.
 */
export interface LensRule {
  relationship: Relationship;
  source: ScoreDimension;
  target: ScoreDimension;
  factor: number;
}

export interface WeightsConfig {
  /** Identifies which config set produced a score (stamped onto every result). */
  version: string;
  /** Validation gate: signals below this confidence are rejected. */
  min_confidence: number;
  /** Upper bound applied to each dimension after summing (e.g. 100). */
  dimension_cap: number;
  /** Diminishing returns: the Nth repeat of evidence is worth decay^(N-1). 0..1. */
  repeat_decay: number;
  /** event_type -> dimension deltas. Unknown event types contribute nothing. */
  weights: Record<string, WeightRow>;
  /** A dimension at/above its threshold raises an alert. Tunable like weights. */
  alert_thresholds: Partial<Record<ScoreDimension, number>>;
  /** event_type -> human category, for grouped explanations ("3 supply issues"). */
  categories: Record<string, string>;
  /** How related entities' scores fold into the client's perspective. */
  lens_rules: LensRule[];
}
