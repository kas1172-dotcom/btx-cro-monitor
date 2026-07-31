import { BACKEND_ENDPOINT } from "./backendApi.ts";

export interface EnvironmentContract {
  deploymentMode: "development" | "demo" | "production";
  isDemonstration: boolean;
  displayLabel: string;
  demoNotice: string | null;
  tenant: { id: string };
  auth: { provider: "clerk"; keyClass: "development" | "live" | "unconfigured" | "unknown"; configured: boolean };
  source: { type: string; dataProvenance: string };
  externalWrites: { capable: boolean };
  revision: { deployed: string; expected: string; seed?: string; matchesExpected: boolean };
}

const buildMode = import.meta.env.VITE_DEPLOYMENT_MODE;

export const BUILD_ENVIRONMENT: EnvironmentContract = {
  deploymentMode: buildMode === "demo" || buildMode === "production" ? buildMode : "development",
  isDemonstration: buildMode === "demo",
  displayLabel: buildMode === "demo" ? "Demonstration" : buildMode === "production" ? "Production" : "Development",
  demoNotice: buildMode === "demo" ? "Demonstration — internal records are illustrative" : null,
  tenant: { id: import.meta.env.VITE_TENANT_ID ?? "local" },
  auth: {
    provider: "clerk",
    keyClass: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") ? "live"
      : import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ? "development"
      : "unconfigured",
    configured: Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
  },
  source: {
    type: import.meta.env.VITE_SOURCE_TYPE ?? "repository_seed",
    dataProvenance: import.meta.env.VITE_DATA_PROVENANCE ?? "Repository-backed local data",
  },
  externalWrites: { capable: false },
  revision: {
    deployed: import.meta.env.VITE_DEPLOYED_REVISION ?? "unknown",
    expected: "779198f",
    seed: "779198f",
    matchesExpected: Boolean(import.meta.env.VITE_DEPLOYED_REVISION),
  },
};

export async function loadEnvironmentContract(): Promise<EnvironmentContract> {
  if (!BACKEND_ENDPOINT) return BUILD_ENVIRONMENT;
  const response = await fetch(`${BACKEND_ENDPOINT.replace(/\/$/, "")}/environment`);
  if (!response.ok) throw new Error(`Environment diagnostic failed (${response.status}).`);
  return response.json() as Promise<EnvironmentContract>;
}
