import { CockpitDataAdapter } from "./CockpitDataAdapter.ts";
import type { DataAdapter } from "../engine/brain/ports.ts";

export function createDataAdapter(): DataAdapter {
  return new CockpitDataAdapter();
}
