// Loads the versioned decision config and the client profile (both data-layer
// JSON). The engine is industry-free; these imports are where BTX enters.

import weights from "../../data/config/scoring-weights.v1.json";
import profile from "../../data/config/client-profile.json";
import companies from "../../data/mock/companies.json";
import type { WeightsConfig } from "../engine/decision/weights.ts";

export const CONFIG = weights as unknown as WeightsConfig;

export interface ClientProfile {
  client_id: string;
  name: string;
  home_city: string;
  capabilities: string[];
}
export const PROFILE = profile as unknown as ClientProfile;

/** Cities present in the demo world — drives the "where are you?" picker. */
export const CITIES: string[] = [
  ...new Set((companies as Array<{ location: { city: string } }>).map((c) => c.location.city)),
].sort();
