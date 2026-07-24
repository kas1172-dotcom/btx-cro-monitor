// Loads the versioned decision config and the client profile (both data-layer
// JSON). The engine is industry-free; these imports are where BTX enters.

import weights from "../../data/config/scoring-weights.v1.json";
import profile from "../../data/config/client-profile.json";
import type { WeightsConfig } from "../engine/decision/weights.ts";

export const CONFIG = weights as unknown as WeightsConfig;
let scoringConfigVersion = 0;
const scoringConfigListeners = new Set<() => void>();

export function applyScoringConfig(document: WeightsConfig): void {
  Object.assign(CONFIG, document);
  scoringConfigVersion += 1;
  scoringConfigListeners.forEach((listener) => listener());
}

export function getScoringConfigVersion(): number {
  return scoringConfigVersion;
}

export function subscribeScoringConfig(listener: () => void): () => void {
  scoringConfigListeners.add(listener);
  return () => scoringConfigListeners.delete(listener);
}

export interface ClientProfile {
  client_id: string;
  name: string;
  home_city: string;
  sender_name: string;
  sender_title: string;
  capabilities: string[];
}
export const PROFILE = profile as unknown as ClientProfile;
