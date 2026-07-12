import { useEffect, useState } from "react";
import { BACKEND_ENDPOINT, backendJson } from "../../app/backendApi.ts";

interface IntegrationHealth {
  name: string;
  configured: boolean;
  status: "ok" | "not_configured";
  detail: string;
}

interface MonitorHealth {
  status: "ok" | "stale" | "missing" | "invalid";
  stale: boolean;
  detail: string;
  run_at?: string;
  age_hours?: number;
}

interface PlatformHealth {
  status: "ok" | "degraded";
  db: boolean;
  auth: boolean;
  monitor: MonitorHealth;
  integrations: Record<string, IntegrationHealth>;
  generated_at: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; health: PlatformHealth };

const STATUS_LABEL: Record<string, string> = {
  ok: "Healthy",
  degraded: "Degraded",
  stale: "Stale",
  missing: "Missing",
  invalid: "Invalid",
  not_configured: "Not configured",
};

function dotClass(status: string): string {
  if (status === "ok") return "status-demo_connected";
  if (status === "not_configured" || status === "missing") return "status-not_connected";
  return "status-available"; // stale/invalid/degraded — attention, not failure
}

export function PlatformHealthWidget() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!BACKEND_ENDPOINT) {
      setState({ kind: "unavailable" });
      return;
    }
    let cancelled = false;
    backendJson<PlatformHealth>("/health")
      .then((health) => {
        if (!cancelled) setState({ kind: "ready", health });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "unavailable") {
    return (
      <div className="platform-health-widget">
        <p className="eyebrow">Platform health</p>
        <p className="muted">No backend configured (VITE_BACKEND_ENDPOINT unset) — running on static demo data only.</p>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="platform-health-widget">
        <p className="eyebrow">Platform health</p>
        <p className="muted">Checking backend, monitor freshness, and integrations…</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="platform-health-widget">
        <p className="eyebrow">Platform health</p>
        <p className="muted">Could not reach the backend health check: {state.message}</p>
      </div>
    );
  }

  const { health } = state;
  return (
    <div className="platform-health-widget">
      <div className="detail-head">
        <p className="eyebrow">Platform health</p>
        <span className={`integration-status status-${health.status === "ok" ? "demo_connected" : "not_connected"}`}>
          {STATUS_LABEL[health.status]}
        </span>
      </div>
      <ul className="platform-health-list">
        <li>
          <span className={`status-dot ${dotClass(health.monitor.status)}`} />
          <span>
            <strong>Monitor freshness</strong>
            <em>{health.monitor.detail}</em>
          </span>
        </li>
        {Object.values(health.integrations).map((integration) => (
          <li key={integration.name}>
            <span className={`status-dot ${dotClass(integration.status)}`} />
            <span>
              <strong>{integration.name}</strong>
              <em>{integration.detail}</em>
            </span>
          </li>
        ))}
        <li>
          <span className={`status-dot ${health.db ? "status-demo_connected" : "status-not_connected"}`} />
          <span>
            <strong>Database</strong>
            <em>{health.db ? "Reachable" : "Unreachable"}</em>
          </span>
        </li>
      </ul>
    </div>
  );
}
