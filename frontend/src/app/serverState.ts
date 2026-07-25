import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type QueryStatus = "idle" | "loading" | "refreshing" | "success" | "error";

export interface QueryState<T> {
  key: string;
  status: QueryStatus;
  data: T | null;
  error: string | null;
  updatedAt: number | null;
  promise: Promise<T> | null;
}

export interface QueryResult<T> {
  data: T | null;
  status: QueryStatus;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

const STALE_AFTER_MS = 60_000;
const queryStates = new Map<string, QueryState<unknown>>();
const emptyQueryStates = new Map<string, QueryState<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function emptyState<T>(key: string): QueryState<T> {
  let state = emptyQueryStates.get(key);
  if (!state) {
    state = { key, status: "idle", data: null, error: null, updatedAt: null, promise: null };
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

export function fetchQuery<T>(key: string, loader: () => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
  const current = getState<T>(key);
  if (!options.force && current.promise) return current.promise;
  if (!options.force && current.data !== null && current.updatedAt && Date.now() - current.updatedAt < STALE_AFTER_MS) {
    return Promise.resolve(current.data);
  }
  const promise = loader()
    .then((data) => {
      setQueryState<T>(key, { key, status: "success", data, error: null, updatedAt: Date.now(), promise: null });
      return data;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setQueryState<T>(key, { ...getState<T>(key), status: "error", error: message, promise: null });
      throw error;
    });
  setQueryState<T>(key, {
    ...current,
    status: current.data ? "refreshing" : "loading",
    error: null,
    promise,
  });
  return promise;
}

export function useQuery<T>(key: string, loader: () => Promise<T>, dependencies: unknown[] = []): QueryResult<T> {
  const [refreshNonce, setRefreshNonce] = useState(0);
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

  const isStale = state.updatedAt === null || Date.now() - state.updatedAt >= STALE_AFTER_MS;
  return useMemo(() => ({
    data: state.data,
    status: state.status,
    error: state.error,
    isLoading: state.status === "idle" || state.status === "loading",
    isRefreshing: state.status === "refreshing",
    isStale,
    updatedAt: state.updatedAt,
    refresh: () => setRefreshNonce((value) => value + 1),
  }), [isStale, state.data, state.error, state.status, state.updatedAt]);
}
