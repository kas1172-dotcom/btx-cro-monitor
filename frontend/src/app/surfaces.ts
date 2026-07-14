import type { World } from "./useWorld.ts";
import type { MemoryState } from "../memory/types.ts";

export type CoreTab = "brief" | "work_queue" | "accounts" | "ask";
export type AnalyticalTab = "prospecting" | "map" | "analysis" | "capacity" | "programs";
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
  { id: "brief", label: "Today's Brief", group: "core", componentId: "surface-todays-brief", title: "What changed, needs attention, is prepared, needs approval, and has outcomes." },
  { id: "work_queue", label: "Work Queue", group: "core", componentId: "surface-work-queue", title: "Durable work items, owners, approvals, due dates, evidence, and outcomes." },
  { id: "accounts", label: "Accounts", group: "core", componentId: "surface-account-360", title: "Account 360: canonical account health, linked signals, contacts, deals, capacity fit, and recommended actions." },
  { id: "ask", label: "Ask", group: "core", componentId: "surface-ask", title: "Primary conversational assistant." },
];

export const ANALYTICAL_SURFACES: SurfaceSpec[] = [
  { id: "prospecting", label: "Prospecting", group: "analytical", componentId: "surface-prospecting", title: "New business targets, buying signals, outreach queues, and list imports." },
  { id: "map", label: "Map", group: "analytical", componentId: "surface-map", title: "Geographic account and prospect map." },
  { id: "analysis", label: "Analysis", group: "analytical", componentId: "surface-analysis-dashboard", title: "Pipeline, bookings, backlog, book-to-bill, win/loss, and utilization analysis." },
  { id: "capacity", label: "Capacity", group: "analytical", componentId: "surface-capacity-assessment", title: "Machining capacity against backlog and demand." },
  { id: "programs", label: "Programs", group: "analytical", componentId: "surface-program-contract-tracker", title: "Program, contract award, and recompete tracker." },
];

export const UTILITY_SURFACES: SurfaceSpec[] = [
  { id: "deliverables", label: "Deliverable Editor", group: "utility", componentId: "surface-deliverable-library", title: "Browse, preview, edit, download, and send saved deliverables." },
  { id: "hubspot", label: "HubSpot", group: "utility", componentId: "surface-hubspot-viewer", title: "Curated HubSpot activity, pipeline, lookup, and client list creation." },
  { id: "settings", label: "Settings", group: "utility", componentId: "surface-settings", title: "Memory, source admin, configuration, integrations, and engine tuning." },
];

export const ALL_SURFACES = [...CORE_SURFACES, ...ANALYTICAL_SURFACES, ...UTILITY_SURFACES];

export const TAB_IDS: TabId[] = ["brief", "work_queue", "accounts", "ask", "prospecting", "map", "analysis", "capacity", "programs", "deliverables", "hubspot", "settings"];

export const TAB_LABELS: Record<TabId, string> = {
  brief: "Today's Brief",
  work_queue: "Work Queue",
  accounts: "Accounts",
  ask: "Ask",
  prospecting: "Prospecting",
  map: "Map",
  analysis: "Analysis",
  capacity: "Capacity",
  programs: "Programs",
  deliverables: "Deliverable Editor",
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
