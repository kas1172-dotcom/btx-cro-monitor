// Thin global UI store — selection/view state ONLY. Rankings, scores, prospects
// are NEVER stored here; they are derived from engine output on demand. Keeping a
// second copy of engine truth in the store is exactly what would let the UI drift
// out of sync with the brain. The engine is the source of truth; this is just
// "what is the user looking at."

import { useSyncExternalStore } from "react";

export type View = "home" | "current" | "prospecting" | "map" | "dashboard" | "graph" | "feed" | "operating" | "integrations";

export interface UiState {
  city: string | null;
  view: View;
  activeCompanyId: string | null;
  copilotPrompt: string | null;
  copilotPromptId: number;
  demoAction: DemoActionNotice | null;
}

export interface DemoActionNotice {
  title: string;
  accountName?: string;
  action: "crm_task" | "follow_up" | "crm_lead";
  evidence?: string;
}

let state: UiState = {
  city: "Austin",
  view: "home",
  activeCompanyId: null,
  copilotPrompt: null,
  copilotPromptId: 0,
  demoAction: null,
};
const listeners = new Set<() => void>();

export function setState(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function openCopilotWithPrompt(prompt: string): void {
  setState({ copilotPrompt: prompt, copilotPromptId: state.copilotPromptId + 1 });
}

export function openDemoAction(action: DemoActionNotice): void {
  setState({ demoAction: action });
}

export function closeDemoAction(): void {
  setState({ demoAction: null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): UiState {
  return useSyncExternalStore(subscribe, () => state);
}
