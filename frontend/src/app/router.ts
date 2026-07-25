import { useEffect, useSyncExternalStore } from "react";
import type { TabId } from "./surfaces.ts";

export type RouteId =
  | "today"
  | "work"
  | "accounts"
  | "programs"
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
  query: URLSearchParams;
}

const routeListeners = new Set<() => void>();
let routeSnapshot: AppRoute | null = null;

const ROUTE_TO_TAB: Record<Exclude<RouteId, "not_found">, TabId> = {
  today: "brief",
  work: "work_queue",
  accounts: "accounts",
  programs: "programs",
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
  const clean = pathname.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(search);
  const parts = clean.split("/").filter(Boolean);
  const [root, child] = parts;

  if (clean === "/") {
    return { id: "today", tab: "brief", path: "/today", accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  }
  if (root === "today") return { id: "today", tab: "brief", path: clean, accountId: null, workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "work") return { id: "work", tab: "work_queue", path: clean, accountId: null, workItemId: decodeSegment(child), programId: null, conversationId: null, deliverableId: null, query };
  if (root === "accounts") return { id: "accounts", tab: "accounts", path: clean, accountId: decodeSegment(child), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "programs") return { id: "programs", tab: "programs", path: clean, accountId: null, workItemId: null, programId: decodeSegment(child), conversationId: null, deliverableId: null, query };
  if (root === "prospecting") return { id: "prospecting", tab: "prospecting", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "capacity") return { id: "capacity", tab: "capacity", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "analysis") return { id: "analysis", tab: "analysis", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "map") return { id: "map", tab: "map", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: null, query };
  if (root === "ask") return { id: "ask", tab: "ask", path: clean, accountId: null, workItemId: null, programId: null, conversationId: decodeSegment(child), deliverableId: null, query };
  if (root === "deliverables") return { id: "deliverables", tab: "deliverables", path: clean, accountId: query.get("account"), workItemId: null, programId: null, conversationId: null, deliverableId: decodeSegment(child), query };
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
    if (window.location.pathname === "/") navigateTo("/today", { replace: true });
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return useSyncExternalStore(subscribeRoute, currentRoute, () => parseAppRoute("/today"));
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

export function tabForRoute(route: RouteId): TabId {
  return route === "not_found" ? "brief" : ROUTE_TO_TAB[route];
}

export function navigateTo(path: string, options: { replace?: boolean } = {}): void {
  const next = new URL(path, window.location.origin);
  const current = `${window.location.pathname}${window.location.search}`;
  const target = `${next.pathname}${next.search}`;
  if (current === target) return;
  if (options.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  emitRoute();
}
