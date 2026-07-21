import type { TabId } from "./surfaces.ts";
import type { BrainResponse } from "../brain/types.ts";

export const AREA_MARKET_SCOPING: Record<TabId, boolean> = {
  brief: false,
  work_queue: false,
  accounts: false,
  ask: false,
  prospecting: true,
  trip_planner: true,
  map: true,
  analysis: false,
  deliverables: false,
  hubspot: false,
  capacity: false,
  programs: true,
  settings: false,
};

export function isMarketScopedView(input: {
  activeTab: TabId;
  brainResponse: BrainResponse | null;
  activeDeliverable: unknown;
  activeAnalysisSpec: unknown;
}): boolean {
  if (input.activeDeliverable || input.activeAnalysisSpec) return false;
  if (input.brainResponse) return input.brainResponse.focusView === "map" || input.brainResponse.activatedTabs.includes("map");
  return AREA_MARKET_SCOPING[input.activeTab];
}
