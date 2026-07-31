import { useEffect, useSyncExternalStore } from "react";
import type { TabId } from "./surfaces.ts";
import type { ChartSpec, MetricId } from "../metrics/types.ts";

export type RouteId =
  | "today"
  | "work"
  | "accounts"
  | "programs"
  | "industry_updates"
  | "prospecting"
  | "capacity"
  | "analysis"
  | "map"
  | "ask"
  | "deliverables"
  | "integrations"
  | "settings"
  | "not_found";

export interface AppRoute {
  id: RouteId;
  tab: TabId;
  path: string;
  accountId: string | null;
  workItemId: string | null;
  programId: string | null;
  conversationId: string | null;
  deliverableId: string | null;
  deliverableView?: "library" | "document" | "insert_figure";
  query: URLSearchParams;
}

/**
 * The cockpit is served from a subpath on GitHub Pages ("/btx-cro-monitor/cockpit/")
 * and from the root in local dev. Routes are written root-relative everywhere in the
 * app; these two helpers translate between an app path and a browser path so the
 * same route table works under either base.
 */
// import.meta.env only exists under Vite. The tools/test-*.ts scripts run this
// module directly through tsx, where it is undefined, so read it defensively.
const BASE_PATH = (import.meta.env?.BASE_URL || "/").replace(/\/+$/, "");

export function toBrowserPath(appPath: string): string {
  if (!BASE_PATH) return appPath;
  return `${BASE_PATH}${appPath.startsWith("/") ? appPath : `/${appPath}`}`;
}

export function stripBasePath(pathname: string): string {
  if (BASE_PATH && (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}

const routeListeners = new Set<() => void>();
let routeSnapshot: AppRoute | null = null;
const SERVER_ROUTE_SNAPSHOT = parseAppRoute("/today");

const ROUTE_TO_TAB: Record<Exclude<RouteId, "not_found">, TabId> = {
  today: "brief",
  work: "work_queue",
  accounts: "accounts",
  programs: "programs",
  industry_updates: "industry_updates",
  prospecting: "prospecting",
  capacity: "capacity",
  analysis: "analysis",
  map: "map",
  ask: "ask",
  deliverables: "deliverables",
  integrations: "hubspot",
  settings: "settings",
};

export const TAB_TO_ROUTE: Record<TabId, string> = {
  brief: "/today",
  work_queue: "/work",
  accounts: "/accounts",
  ask: "/ask",
  prospecting: "/prospecting",
  trip_planner: "/prospecting",
  map: "/map",
  analysis: "/analysis",
  capacity: "/capacity",
  programs: "/programs",
  industry_updates: "/intelligence/industry-updates",
  deliverables: "/deliverables",
  hubspot: "/integrations",
  settings: "/settings",
};

function decodeSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseAppRoute(pathname: string, search = ""): AppRoute {
  const clean = stripBasePath(pathname).replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(search);
  const parts = clean.split("/").filter(Boolean);
  const [root, child] = parts;

  if (clean === "/") {
    return { id: "today", tab: "brief", path: "/today", accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  }
  if (root === "today" || root === "briefing") return { id: "today", tab: "brief", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "work") return { id: "work", tab: "work_queue", path: clean, accountId: null, workItemId: decodeSegment(child), programId: null, conversationId: null, deliverableId: null, query };
  if (root === "accounts") return { id: "accounts", tab: "accounts", path: clean, accountId: decodeSegment(child), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "programs") return { id: "programs", tab: "programs", path: clean, accountId: null, workItemId: null, programId: decodeSegment(child), conversationId: null, deliverableId: null, query };
  if (root === "intelligence" && child === "industry-updates") return { id: "industry_updates", tab: "industry_updates", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "prospecting") return { id: "prospecting", tab: "prospecting", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "capacity") return { id: "capacity", tab: "capacity", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "analysis") return { id: "analysis", tab: "analysis", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "map") return { id: "map", tab: "map", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "ask") return { id: "ask", tab: "ask", path: clean, accountId: null, workItemId: null, programId: null, conversationId: decodeSegment(child), deliverableId: null, query };
  if (root === "deliverables") {
    const insertFigure = child === "figures" && parts[2] === "new";
    return {
      id: "deliverables",
      tab: "deliverables",
      path: clean,
      accountId: query.get("account"),
      workItemId: null,
      programId: null,
      conversationId: null,
      deliverableId: insertFigure ? null : decodeSegment(child),
      deliverableView: insertFigure ? "insert_figure" : child ? "document" : "library",
      query,
    };
  }
  if (root === "integrations") return { id: "integrations", tab: "hubspot", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "settings") return { id: "settings", tab: "settings", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  return { id: "not_found", tab: "brief", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
}

export function currentRoute(): AppRoute {
  if (!routeSnapshot) routeSnapshot = parseAppRoute(window.location.pathname, window.location.search);
  return routeSnapshot;
}

function subscribeRoute(listener: () => void): () => void {
  routeListeners.add(listener);
  return () => routeListeners.delete(listener);
}

function emitRoute(): void {
  routeSnapshot = parseAppRoute(window.location.pathname, window.location.search);
  routeListeners.forEach((listener) => listener());
}

export function useAppRoute(): AppRoute {
  useEffect(() => {
    const onPopState = () => emitRoute();
    window.addEventListener("popstate", onPopState);
    if (stripBasePath(window.location.pathname).replace(/\/+$/, "") === "") navigateTo("/today", { replace: true });
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return useSyncExternalStore(subscribeRoute, currentRoute, () => SERVER_ROUTE_SNAPSHOT);
}

export function pathForTab(tab: TabId): string {
  return TAB_TO_ROUTE[tab] ?? "/today";
}

export function accountPath(accountId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}`;
}

export function workItemPath(workItemId: string): string {
  return `/work/${encodeURIComponent(workItemId)}`;
}

export function deliverablePath(deliverableId: string): string {
  return `/deliverables/${encodeURIComponent(deliverableId)}`;
}

const FIGURE_DEFAULTS: ChartSpec = { metric: "revenue", viz: "heatmap", rows: "account", cols: "quarter" };

export function figureInsertPath(spec: ChartSpec = FIGURE_DEFAULTS): string {
  const query = new URLSearchParams({
    metric: spec.metric,
    viz: spec.viz,
    rows: spec.rows ?? "account",
    cols: spec.cols ?? "quarter",
  });
  return `/deliverables/figures/new?${query.toString()}`;
}

export function figureSpecFromRoute(route: AppRoute): ChartSpec {
  const metrics: MetricId[] = ["revenue", "bookings", "backlog", "book_to_bill", "pipeline_coverage", "win_rate", "avg_order_value", "margin_trend", "customer_concentration", "capacity_utilization", "on_time_delivery", "repeat_revenue_rate", "pipeline_by_stage", "revenue_yoy_change"];
  const visualizations: ChartSpec["viz"][] = ["heatmap", "trend", "ranked_bar", "retention_grid"];
  const rows: NonNullable<ChartSpec["rows"]>[] = ["account", "segment", "region"];
  const cols: NonNullable<ChartSpec["cols"]>[] = ["month", "quarter", "program"];
  const metric = route.query.get("metric") as MetricId | null;
  const viz = route.query.get("viz") as ChartSpec["viz"] | null;
  const row = route.query.get("rows") as ChartSpec["rows"] | null;
  const col = route.query.get("cols") as ChartSpec["cols"] | null;
  return {
    metric: metric && metrics.includes(metric) ? metric : FIGURE_DEFAULTS.metric,
    viz: viz && visualizations.includes(viz) ? viz : FIGURE_DEFAULTS.viz,
    rows: row && rows.includes(row) ? row : FIGURE_DEFAULTS.rows,
    cols: col && cols.includes(col) ? col : FIGURE_DEFAULTS.cols,
  };
}

export function tabForRoute(route: RouteId): TabId {
  return route === "not_found" ? "brief" : ROUTE_TO_TAB[route];
}

export function navigateTo(path: string, options: { replace?: boolean } = {}): void {
  const next = new URL(toBrowserPath(path), window.location.origin);
  const current = `${window.location.pathname}${window.location.search}`;
  const target = `${next.pathname}${next.search}`;
  if (current === target) return;
  if (options.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  emitRoute();
}
