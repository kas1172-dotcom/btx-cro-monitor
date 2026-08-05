import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type QueryStatus = "idle" | "loading" | "refreshing" | "success" | "error";
export type QueryErrorKind = "offline" | "auth" | "timeout" | "api" | "cancelled" | "unknown";

export interface QueryState<T> {
  key: string;
  status: QueryStatus;
  data: T | null;
  error: string | null;
  errorKind: QueryErrorKind | null;
  updatedAt: number | null;
  startedAt: number | null;
  timedOutAt: number | null;
  promise: Promise<T> | null;
  abortController: AbortController | null;
}

export interface QueryResult<T> {
  data: T | null;
  status: QueryStatus;
  error: string | null;
  errorKind: QueryErrorKind | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  isTimedOut: boolean;
  isOffline: boolean;
  elapsedMs: number;
  updatedAt: number | null;
  startedAt: number | null;
  refresh: () => void;
}

export const STALE_AFTER_MS = 300_000;
const SLOW_AFTER_MS = 4_000;
export const ROUTE_DATA_TIMEOUT_MS = 12_000;
const queryStates = new Map<string, QueryState<unknown>>();
const emptyQueryStates = new Map<string, QueryState<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function emptyState<T>(key: string): QueryState<T> {
  let state = emptyQueryStates.get(key);
  if (!state) {
    state = { key, status: "idle", data: null, error: null, errorKind: null, updatedAt: null, startedAt: null, timedOutAt: null, promise: null, abortController: null };
    emptyQueryStates.set(key, state);
  }
  return state as QueryState<T>;
}

function getState<T>(key: string): QueryState<T> {
  return (queryStates.get(key) as QueryState<T> | undefined) ?? emptyState<T>(key);
}

function setQueryState<T>(key: string, state: QueryState<T>): void {
  queryStates.set(key, state as QueryState<unknown>);
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

export function queryKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => part === null || part === undefined ? "_" : encodeURIComponent(String(part))).join(":");
}

export function invalidateQueries(prefix: string): void {
  for (const key of queryStates.keys()) {
    if (key.startsWith(prefix)) {
      const state = getState(key);
      setQueryState(key, { ...state, updatedAt: null });
    }
  }
}

function classifyError(error: unknown): QueryErrorKind {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  const message = error instanceof Error ? error.message : String(error);
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (message.includes("(401)") || message.includes("(403)") || /auth|token|session|clerk/i.test(message)) return "auth";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/Backend .* failed|fetch|network/i.test(message)) return "api";
  return "unknown";
}

export function fetchQuery<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
  const current = getState<T>(key);
  if (!options.force && current.promise) return current.promise;
  if (!options.force && current.data !== null && current.updatedAt && Date.now() - current.updatedAt < STALE_AFTER_MS) {
    return Promise.resolve(current.data);
  }
  current.abortController?.abort();
  const abortController = new AbortController();
  const startedAt = Date.now();
  const timeout = globalThis.setTimeout(() => {
    const state = getState<T>(key);
    if (state.promise) setQueryState<T>(key, { ...state, timedOutAt: Date.now(), errorKind: "timeout" });
  }, ROUTE_DATA_TIMEOUT_MS);
  const promise = loader(abortController.signal)
    .then((data) => {
      globalThis.clearTimeout(timeout);
      setQueryState<T>(key, { key, status: "success", data, error: null, errorKind: null, updatedAt: Date.now(), startedAt, timedOutAt: null, promise: null, abortController: null });
      return data;
    })
    .catch((error) => {
      globalThis.clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      const errorKind = classifyError(error);
      if (errorKind === "cancelled") {
        setQueryState<T>(key, { ...getState<T>(key), status: current.data ? "success" : "idle", error: null, errorKind: null, promise: null, abortController: null });
      } else {
        setQueryState<T>(key, { ...getState<T>(key), status: "error", error: message, errorKind, promise: null, abortController: null });
      }
      throw error;
    });
  setQueryState<T>(key, {
    ...current,
    status: current.data ? "refreshing" : "loading",
    error: null,
    errorKind: null,
    startedAt,
    timedOutAt: null,
    promise,
    abortController,
  });
  return promise;
}

export function useQuery<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, dependencies: unknown[] = []): QueryResult<T> {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  const state = useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => getState<T>(key),
    () => emptyState<T>(key),
  );

  useEffect(() => {
    let alive = true;
    void fetchQuery(key, loader, { force: refreshNonce > 0 }).catch(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [key, refreshNonce, ...dependencies]);

  useEffect(() => {
    if (!state.promise && !state.timedOutAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state.promise, state.timedOutAt]);

  const isStale = state.updatedAt === null || Date.now() - state.updatedAt >= STALE_AFTER_MS;
  const elapsedMs = state.startedAt ? now - state.startedAt : 0;
  return useMemo(() => ({
    data: state.data,
    status: state.status,
    error: state.error,
    errorKind: state.errorKind,
    isLoading: state.status === "idle" || state.status === "loading",
    isRefreshing: state.status === "refreshing",
    isStale,
    isTimedOut: Boolean(state.timedOutAt) || elapsedMs >= SLOW_AFTER_MS,
    isOffline: typeof navigator !== "undefined" && !navigator.onLine,
    elapsedMs,
    updatedAt: state.updatedAt,
    startedAt: state.startedAt,
    refresh: () => setRefreshNonce((value) => value + 1),
  }), [elapsedMs, isStale, state.data, state.error, state.errorKind, state.startedAt, state.status, state.timedOutAt, state.updatedAt]);
}
