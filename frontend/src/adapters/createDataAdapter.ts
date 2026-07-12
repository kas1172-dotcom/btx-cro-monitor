import { ArtifactDataAdapter } from "./artifact/ArtifactDataAdapter.ts";
import { DemoDataAdapter } from "./demo/DemoDataAdapter.ts";
import { HybridDataAdapter } from "./hybrid/HybridDataAdapter.ts";
import { LiveDataAdapter } from "./live/LiveDataAdapter.ts";
import type { DataAdapter } from "../engine/brain/ports.ts";

export type DataMode = "demo" | "artifact" | "live" | "hybrid";

function urlDataMode(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("dataMode")
    ?? new URLSearchParams(window.location.search).get("mode")
    ?? undefined;
}

export function getDataMode(): DataMode {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const mode = urlDataMode() ?? env?.VITE_DATA_MODE ?? processEnv?.VITE_DATA_MODE ?? "hybrid";
  if (mode === "artifact" || mode === "live" || mode === "demo" || mode === "hybrid") return mode;
  console.warn(`Unknown data mode "${mode}". Falling back to hybrid.`);
  return "hybrid";
}

export function createDataAdapter(mode: DataMode = getDataMode()): DataAdapter {
  if (mode === "artifact") return new ArtifactDataAdapter();
  if (mode === "live") return new LiveDataAdapter();
  if (mode === "hybrid") return new HybridDataAdapter();
  return new DemoDataAdapter();
}
