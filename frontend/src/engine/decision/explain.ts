// Category-grouped explanations. The raw trace is line-by-line (one entry per
// signal); this rolls it up so a person reads "3× supply chain (+65)" instead of
// three separate lines. Deterministic: grouping + ordering are pure functions of
// the trace and the category map in config.

import type { DimensionScore } from "./score.ts";
import type { WeightsConfig } from "./weights.ts";

export interface CategoryGroup {
  category: string;
  total: number;
  count: number;
}

export function groupTrace(d: DimensionScore, config: WeightsConfig): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const c of d.contributions) {
    const category = config.categories[c.event_type] ?? "other";
    const g = map.get(category) ?? { category, total: 0, count: 0 };
    g.total += c.delta;
    g.count += 1;
    map.set(category, g);
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || a.category.localeCompare(b.category),
  );
}

export function summarizeGroups(groups: CategoryGroup[]): string {
  if (groups.length === 0) return "no contributing signals";
  return groups.map((g) => `${g.count}× ${g.category} (+${g.total})`).join(", ");
}
