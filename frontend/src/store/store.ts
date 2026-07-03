// Thin global UI store — selection/view state ONLY. Rankings, scores, prospects
// are NEVER stored here; they are derived from engine output on demand. Keeping a
// second copy of engine truth in the store is exactly what would let the UI drift
// out of sync with the brain. The engine is the source of truth; this is just
// "what is the user looking at."

import { useSyncExternalStore } from "react";

export type View = "map" | "dashboard" | "graph" | "feed";

export interface UiState {
  city: string;
  view: View;
  activeCompanyId: string | null;
}

let state: UiState = { city: "Austin", view: "map", activeCompanyId: null };
const listeners = new Set<() => void>();

export function setState(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): UiState {
  return useSyncExternalStore(subscribe, () => state);
}
