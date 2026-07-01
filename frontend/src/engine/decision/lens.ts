// The relationship-aware "self lens". Per-entity scores are objective facts
// about each company. This layer re-interprets the network FROM THE CLIENT'S
// SEAT: a competitor's opportunity becomes the client's competitivePressure, a
// supplier's risk becomes the client's capacityRisk, a customer's growth feeds
// the client's pipeline. Still deterministic, still fully traceable — every
// folded-in point records which entity and rule produced it.
//
// Diminishing returns apply here too (same principle as the scorer): when many
// entities of the same relationship push the same dimension, the largest counts
// full and the rest decay — the 4th competitor's marginal pressure is smaller
// than the 1st. The decay factor is the same config value.

import { SCORE_DIMENSIONS } from "../signals/contract.ts";
import type { ScoreDimension } from "../signals/contract.ts";
import type { Company } from "../brain/entities.ts";
import type { CompanyScore } from "./score.ts";
import type { WeightsConfig } from "./weights.ts";

export interface LensContribution {
  source_id: string;
  source_name: string;
  relationship: string;
  source_dimension: ScoreDimension;
  source_score: number;
  factor: number;
  /** Rank within its target dimension after decay: 1 = full, 2 = decayed, ... */
  occurrence: number;
  delta: number;
  target_dimension: ScoreDimension;
}

export interface PerspectiveScore {
  subject_id: string;
  /** The client's own score from its own signals (before the network folds in). */
  base: CompanyScore;
  /** Final client-perspective scores: base + network, clamped. */
  dimensions: Record<ScoreDimension, number>;
  /** Every related-entity contribution, the audit trail for the network effect. */
  lens: LensContribution[];
}

interface Candidate {
  source_id: string;
  source_name: string;
  relationship: string;
  source_dimension: ScoreDimension;
  source_score: number;
  factor: number;
  target_dimension: ScoreDimension;
  base: number; // source_score × factor, before repeat decay
}

/**
 * Build the client's perspective. The client is the company tagged
 * relationship === "self". Returns null if there is no self in the portfolio.
 */
export function applySelfLens(
  companies: Company[],
  scores: CompanyScore[],
  config: WeightsConfig,
): PerspectiveScore | null {
  const self = companies.find((c) => c.relationship === "self");
  if (!self) return null;

  const byId = new Map(scores.map((s) => [s.subject_id, s]));
  const base = byId.get(self.id);
  if (!base) return null;

  // 1. Gather every candidate network contribution.
  const candidates: Candidate[] = [];
  for (const other of companies) {
    if (other.id === self.id) continue;
    const otherScore = byId.get(other.id);
    if (!otherScore) continue;
    for (const rule of config.lens_rules) {
      if (rule.relationship !== other.relationship) continue;
      const sourceScore = otherScore.dimensions[rule.source].score;
      if (sourceScore <= 0) continue;
      candidates.push({
        source_id: other.id,
        source_name: other.name,
        relationship: other.relationship,
        source_dimension: rule.source,
        source_score: sourceScore,
        factor: rule.factor,
        target_dimension: rule.target,
        base: sourceScore * rule.factor,
      });
    }
  }

  // 2. Diminishing returns per target dimension: largest counts full, rest decay.
  const final = {} as Record<ScoreDimension, number>;
  for (const d of SCORE_DIMENSIONS) final[d] = base.dimensions[d].score;

  const lens: LensContribution[] = [];
  for (const dimension of SCORE_DIMENSIONS) {
    const group = candidates
      .filter((c) => c.target_dimension === dimension)
      .sort((a, b) => b.base - a.base || a.source_id.localeCompare(b.source_id));

    group.forEach((c, idx) => {
      const delta = Math.round(c.base * Math.pow(config.repeat_decay, idx));
      if (delta === 0) return;
      final[dimension] += delta;
      lens.push({
        source_id: c.source_id,
        source_name: c.source_name,
        relationship: c.relationship,
        source_dimension: c.source_dimension,
        source_score: c.source_score,
        factor: c.factor,
        occurrence: idx + 1,
        delta,
        target_dimension: dimension,
      });
    });
  }

  for (const d of SCORE_DIMENSIONS) final[d] = Math.min(final[d], config.dimension_cap);

  lens.sort(
    (a, b) =>
      b.delta - a.delta ||
      a.source_id.localeCompare(b.source_id) ||
      a.target_dimension.localeCompare(b.target_dimension),
  );

  return { subject_id: self.id, base, dimensions: final, lens };
}
