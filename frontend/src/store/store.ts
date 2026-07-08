// Thin global UI store — selection/view state ONLY. Rankings, scores, prospects
// are NEVER stored here; they are derived from engine output on demand. Keeping a
// second copy of engine truth in the store is exactly what would let the UI drift
// out of sync with the brain. The engine is the source of truth; this is just
// "what is the user looking at."

import { useSyncExternalStore } from "react";
import type { BrainArea, BrainResponse } from "../brain/types.ts";
import type { Deliverable } from "../deliverables/types.ts";
import type { ChartSpec } from "../metrics/types.ts";

export type View = "home" | "current" | "prospecting" | "map" | "dashboard" | "graph" | "feed" | "operating" | "integrations";
export type SettingsSection = "general" | "engine" | "prompts" | "connections";

export interface UiState {
  city: string | null;
  view: View;
  activeCompanyId: string | null;
  copilotPrompt: string | null;
  copilotPromptId: number;
  demoAction: DemoActionNotice | null;
  activeHome: boolean;
  activeSettings: boolean;
  activeSettingsSection: SettingsSection;
  activeBrainArea: BrainArea;
  brainResponse: BrainResponse | null;
  activeDeliverable: Deliverable | null;
  activeAnalysisSpec: ChartSpec | null;
  askDraftPrompt: string;
  tourRequested: boolean;
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
  activeHome: true,
  activeSettings: false,
  activeSettingsSection: "general",
  activeBrainArea: "revenue",
  brainResponse: null,
  activeDeliverable: null,
  activeAnalysisSpec: null,
  askDraftPrompt: "",
  tourRequested: false,
};
const listeners = new Set<() => void>();

export function setState(patch: Partial<UiState>): void {
  const nextPatch = { ...patch };
  if (patch.activeBrainArea !== undefined && patch.activeHome === undefined) {
    nextPatch.activeHome = false;
  }
  if ((patch.activeBrainArea !== undefined || patch.activeHome) && patch.activeSettings === undefined) {
    nextPatch.activeSettings = false;
  }
  state = { ...state, ...nextPatch };
  listeners.forEach((l) => l());
}

export function getState(): UiState {
  return state;
}

export function waitForState(
  predicate: (current: UiState) => boolean,
  timeoutMs = 15000,
): Promise<UiState> {
  if (predicate(state)) return Promise.resolve(state);
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for UI state`));
    }, timeoutMs);
    unsubscribe = subscribe(() => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
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

export function goHome(): void {
  setState({
    activeHome: true,
    activeSettings: false,
    brainResponse: null,
    activeDeliverable: null,
    activeAnalysisSpec: null,
    activeCompanyId: null,
  });
}

export function closeDeliverable(): void {
  setState({ activeDeliverable: null });
}

export function resetUiState(): void {
  state = {
    city: "Austin",
    view: "home",
    activeCompanyId: null,
    copilotPrompt: null,
    copilotPromptId: 0,
    demoAction: null,
    activeHome: true,
    activeSettings: false,
    activeSettingsSection: "general",
    activeBrainArea: "revenue",
    brainResponse: null,
    activeDeliverable: null,
    activeAnalysisSpec: null,
    askDraftPrompt: "",
    tourRequested: false,
  };
  listeners.forEach((l) => l());
}

export function requestTour(): void {
  setState({ tourRequested: true });
}

export function clearTourRequest(): void {
  setState({ tourRequested: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore(): UiState {
  return useSyncExternalStore(subscribe, () => state);
}
