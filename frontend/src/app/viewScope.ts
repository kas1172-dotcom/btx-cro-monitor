import type { BrainArea, BrainResponse } from "../brain/types.ts";

export const AREA_MARKET_SCOPING: Record<BrainArea, boolean> = {
  market: true,
  customer: false,
  capability: false,
  revenue: false,
  geographic: true,
  decision: false,
  workflow: false,
};

export function isMarketScopedView(input: {
  activeBrainArea: BrainArea;
  brainResponse: BrainResponse | null;
  activeDeliverable: unknown;
  activeAnalysisSpec: unknown;
}): boolean {
  if (input.activeDeliverable || input.activeAnalysisSpec) return false;
  if (input.brainResponse) return input.brainResponse.focusView === "map" || input.brainResponse.activatedBrainAreas.includes("geographic");
  return AREA_MARKET_SCOPING[input.activeBrainArea];
}
