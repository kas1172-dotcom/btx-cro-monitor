import { formatDateTime } from "./format.ts";
import type { SourceHealth, WorldSnapshot } from "./revenueDataClient.ts";

export type ConnectionMode =
  | "not_configured"
  | "configured_unverified"
  | "snapshot_loaded"
  | "read_connected"
  | "write_connected"
  | "authentication_failed"
  | "permission_failed";

export type SourceEnvironment = "sandbox" | "developer" | "production" | "none";

export type DataMode =
  | "live_external"
  | "stored_snapshot"
  | "recently_ingested"
  | "seeded_sample"
  | "simulated_internal"
  | "derived"
  | "user_entered"
  | "missing"
  | "unavailable";

export interface SourceCapability {
  id: string;
  name: string;
  connectionMode: ConnectionMode;
  environment: SourceEnvironment;
  dataMode: DataMode;
  retrievedAt: string | null;
  recordCount: number | null;
  canRead: boolean;
  canWrite: boolean;
  writeBlockReason: string | null;
  verification: "verified" | "unverified" | "failed";
  detail: string;
}

function connectionMode(source: SourceHealth): ConnectionMode {
  if (source.connectionMode) return source.connectionMode;
  if (source.errorCode === "authentication_failed") return "authentication_failed";
  if (source.errorCode === "permission_failed") return "permission_failed";
  if (source.availability === "not_configured") return "not_configured";
  if (source.availability === "simulated" || source.availability === "stale") return "snapshot_loaded";
  if (source.availability === "available") return "read_connected";
  return "configured_unverified";
}

function dataMode(source: SourceHealth): DataMode {
  if (source.dataMode) return source.dataMode;
  if (source.availability === "simulated") return "simulated_internal";
  if (source.availability === "stale") return "stored_snapshot";
  if (source.availability === "available") {
    return source.sourceKey.includes("monitor") ? "recently_ingested" : "live_external";
  }
  if (source.availability === "not_configured") return "missing";
  return "unavailable";
}

export function sourceRegistry(snapshot: WorldSnapshot): SourceCapability[] {
  return snapshot.sourceHealth.map((source) => {
    const mode = connectionMode(source);
    const canRead = source.canRead ?? ["snapshot_loaded", "read_connected", "write_connected"].includes(mode);
    const canWrite = source.canWrite ?? mode === "write_connected";
    return {
      id: source.sourceKey,
      name: source.displayName,
      connectionMode: mode,
      environment: source.environment ?? "none",
      dataMode: dataMode(source),
      retrievedAt: source.lastSuccessfulSyncAt ?? source.lastAttemptAt,
      recordCount: source.recordCount,
      canRead,
      canWrite,
      writeBlockReason: source.writeBlockReason ?? null,
      verification: ["authentication_failed", "permission_failed"].includes(mode)
        ? "failed"
        : canRead
          ? "verified"
          : "unverified",
      detail: source.errorMessage ?? "No additional source detail is available.",
    };
  });
}

export function sourceModeLabel(source: SourceCapability): string {
  const labels: Record<DataMode, string> = {
    live_external: "Live external",
    stored_snapshot: "Stored snapshot",
    recently_ingested: "Recently ingested",
    seeded_sample: "Seeded sample",
    simulated_internal: "Simulated internal",
    derived: "Derived",
    user_entered: "User entered",
    missing: "Missing",
    unavailable: "Unavailable",
  };
  return labels[source.dataMode];
}

export function sourcePermissionLabel(source: SourceCapability): string {
  if (source.canRead && source.canWrite) return "Read and write";
  if (source.canRead) return "Read only";
  return "No access";
}

export function sourceFreshness(source: SourceCapability): { relative: string; exact: string } {
  if (!source.retrievedAt) return { relative: "Retrieval time unavailable", exact: "Unavailable" };
  const date = new Date(source.retrievedAt);
  if (Number.isNaN(date.getTime())) return { relative: "Retrieval time unavailable", exact: "Unavailable" };
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  const relative = minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
    : minutes < 1_440
      ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} ago`
      : `${Math.round(minutes / 1_440)} day${Math.round(minutes / 1_440) === 1 ? "" : "s"} ago`;
  return { relative, exact: formatDateTime(source.retrievedAt) };
}
