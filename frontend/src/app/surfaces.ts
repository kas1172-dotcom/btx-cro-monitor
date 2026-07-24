import type { World } from "./useWorld.ts";
import type { MemoryState } from "../memory/types.ts";

export type CoreTab = "brief" | "work_queue" | "accounts" | "ask";
export type AnalyticalTab = "prospecting" | "trip_planner" | "map" | "analysis" | "capacity" | "programs";
export type UtilityTab = "deliverables" | "hubspot" | "settings";
export type TabId = CoreTab | AnalyticalTab | UtilityTab;

export interface SurfaceSpec {
  id: TabId;
  label: string;
  group: "core" | "analytical" | "utility";
  componentId: string;
  title: string;
}

export const CORE_SURFACES: SurfaceSpec[] = [
  { id: "brief", label: "Brief", group: "core", componentId: "surface-todays-brief", title: "What changed and what needs you today." },
  { id: "work_queue", label: "Work Queue", group: "core", componentId: "surface-work-queue", title: "Your open tasks, who owns them, and what is due." },
  { id: "accounts", label: "Accounts", group: "core", componentId: "surface-account-360", title: "Everything on a customer: health, signals, contacts, deals, and next steps." },
  { id: "ask", label: "Ask", group: "core", componentId: "surface-ask", title: "Primary conversational assistant." },
];

export const ANALYTICAL_SURFACES: SurfaceSpec[] = [
  { id: "prospecting", label: "Prospects", group: "analytical", componentId: "surface-prospecting", title: "New companies worth pursuing and why." },
  { id: "trip_planner", label: "Trip Planner", group: "analytical", componentId: "surface-trip-planner", title: "Field itinerary planning with map context, account fit, and calendar-ready deliverables." },
  { id: "map", label: "Map", group: "analytical", componentId: "surface-map", title: "Geographic account and prospect map." },
  { id: "analysis", label: "Analysis", group: "analytical", componentId: "surface-analysis-dashboard", title: "Pipeline, bookings, backlog, win/loss, and production-load analysis." },
  { id: "capacity", label: "Capacity", group: "analytical", componentId: "surface-capacity-assessment", title: "Machining capacity against backlog and demand." },
  { id: "programs", label: "Signals", group: "analytical", componentId: "surface-program-contract-tracker", title: "Contract and program news relevant to BTX." },
];

export const UTILITY_SURFACES: SurfaceSpec[] = [
  { id: "deliverables", label: "Deliverables", group: "utility", componentId: "surface-deliverable-library", title: "Draft, edit, and send client-ready documents." },
  { id: "hubspot", label: "HubSpot", group: "utility", componentId: "surface-hubspot-viewer", title: "Curated HubSpot activity, pipeline, lookup, and client list creation." },
  { id: "settings", label: "Settings", group: "utility", componentId: "surface-settings", title: "Sources, connections, and how the engine scores." },
];

export const ALL_SURFACES = [...CORE_SURFACES, ...ANALYTICAL_SURFACES, ...UTILITY_SURFACES];

export const TAB_IDS: TabId[] = ["brief", "work_queue", "accounts", "ask", "prospecting", "trip_planner", "map", "analysis", "capacity", "programs", "deliverables", "hubspot", "settings"];
export const PRIMARY_TAB_IDS: TabId[] = ["brief", "work_queue", "accounts", "prospecting", "programs", "deliverables", "settings"];

export const TAB_LABELS: Record<TabId, string> = {
  brief: "Brief",
  work_queue: "Work Queue",
  accounts: "Accounts",
  ask: "Ask",
  prospecting: "Prospects",
  trip_planner: "Trip Planner",
  map: "Map",
  analysis: "Analysis",
  capacity: "Capacity",
  programs: "Signals",
  deliverables: "Deliverables",
  hubspot: "HubSpot",
  settings: "Settings",
};

export function countForSurface(surface: TabId, world: World | null, memory: MemoryState | null): number | undefined {
  if (!world) return undefined;
  switch (surface) {
    case "brief":
      return world.analysis.valid.length;
    case "work_queue":
      return world.analysis.recommendations.length;
    case "accounts":
      return world.companies.filter((company) => company.relationship === "customer" || company.relationship === "target").length;
    case "ask":
      return undefined;
    case "prospecting":
      return world.companies.filter((company) => company.business_motion === "prospect_new_business" || company.account_status === "target_prospect" || company.account_status === "new_logo").length;
    case "trip_planner":
      return memory?.deliverables.filter((deliverable) => deliverable.type === "itinerary").length ?? world.prospects.length;
    case "map":
      return world.prospects.length;
    case "analysis":
      return world.opportunities.filter((opportunity) => opportunity.stage !== "won" && opportunity.stage !== "lost").length;
    case "capacity":
      return world.facilities.length || world.snapshot?.capacity.length;
    case "programs":
      return world.analysis.valid.filter((signal) =>
        signal.event_type.includes("contract") || signal.event_type.includes("award") || signal.scope === "program"
      ).length;
    case "deliverables":
      return memory?.deliverables.length;
    case "hubspot":
      return world.contacts.length + world.opportunities.length;
    case "settings":
      return memory ? memory.activity.length + memory.notes.length : undefined;
  }
}
