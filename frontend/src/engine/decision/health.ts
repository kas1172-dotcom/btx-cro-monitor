// pipelineHealth — a composite 0..100 index. Healthy pipeline = strong
// opportunity, low competitive pressure. Derived from existing scores (not the
// additive scorer), so it can move both up and down around a 50 baseline without
// reworking the locked engine. Deterministic.

export function pipelineHealth(opportunity: number, competitivePressure: number): number {
  return Math.max(0, Math.min(100, Math.round(50 + (opportunity - competitivePressure) / 2)));
}

export function healthLabel(score: number): string {
  if (score >= 65) return "healthy";
  if (score >= 45) return "steady";
  return "at risk";
}
