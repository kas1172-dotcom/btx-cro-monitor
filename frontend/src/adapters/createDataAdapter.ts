import { ArtifactDataAdapter } from "./artifact/ArtifactDataAdapter.ts";
import { DemoDataAdapter } from "./demo/DemoDataAdapter.ts";
import { LiveDataAdapter } from "./live/LiveDataAdapter.ts";
import type { DataAdapter } from "../engine/brain/ports.ts";

export type DataMode = "demo" | "artifact" | "live";

export function getDataMode(): DataMode {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const mode = env?.VITE_DATA_MODE ?? processEnv?.VITE_DATA_MODE ?? "demo";
  if (mode === "artifact" || mode === "live" || mode === "demo") return mode;
  console.warn(`Unknown VITE_DATA_MODE "${mode}". Falling back to demo.`);
  return "demo";
}

export function createDataAdapter(mode: DataMode = getDataMode()): DataAdapter {
  if (mode === "artifact") return new ArtifactDataAdapter();
  if (mode === "live") return new LiveDataAdapter();
  return new DemoDataAdapter();
}
