import { useMemo, useState } from "react";
import { useOperatingSnapshot } from "../../app/useOperatingSnapshot.ts";
import type { IntegrationRecord } from "../../engine/brain/operatingSnapshot.ts";
import { PlatformHealthWidget } from "./PlatformHealthWidget.tsx";
import { setState } from "../../store/store.ts";

const STATUS_LABEL: Record<IntegrationRecord["status"], string> = {
  connected: "Connected",
  available: "Available",
  not_connected: "Not connected",
  future: "Future",
};

function plainSourceText(value: string): string {
  return value
    .replace(/\bseeded baseline\b/gi, "production context")
    .replace(/\bbackend-served\b/gi, "backend loaded")
    .replace(/\bmonitor-engine\b/gi, "monitor engine")
    .replace(/\bartifacts?\b/gi, "documents")
    .replace(/\boperating baseline\b/gi, "production context");
}

export function Integrations() {
  const snapshot = useOperatingSnapshot();
  const integrations = useMemo(() => snapshot?.integrations ?? [], [snapshot]);
  const [selectedId, setSelectedId] = useState("");
  const selected = integrations.find((item) => item.id === (selectedId || integrations[0]?.id)) ?? integrations[0];

  return (
    <div className="integrations">
      <div className="integrations-head">
        <p className="eyebrow">Connections</p>
        <h1>Data Sources</h1>
        <p>
          The cockpit reads CRM data, market signals, and production context through the backend. ERP-dependent context is clearly labeled until each live source is connected.
        </p>
      </div>

      <PlatformHealthWidget />

      <div className="surface-view-toggle" role="group" aria-label="Raw source views">
        <button
          type="button"
          onClick={() => setState({
            activeTab: "hubspot",
            activeSettings: false,
            activeHome: false,
            activeCompanyId: null,
            activeDeliverable: null,
            activeAnalysisSpec: null,
            brainResponse: null,
          })}
        >
          Open CRM records
        </button>
      </div>

      {!snapshot || !selected ? <div className="loading">loading data sources...</div> : (
        <div className="integration-layout">
          <section className="integration-list">
            {integrations.map((item) => (
              <button
                key={item.id}
                className={item.id === selected.id ? "integration-card active" : "integration-card"}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={`status-dot status-${item.status}`} />
                <span>
                  <strong>{item.name}</strong>
                  <em>{item.category} · {STATUS_LABEL[item.status]}</em>
                </span>
              </button>
            ))}
          </section>

          <section className="integration-detail">
            <div className="detail-head">
              <div>
                <p className="eyebrow">{selected.category}</p>
                <h2>{selected.name}</h2>
              </div>
              <span className={`integration-status status-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
            </div>
            <p>{plainSourceText(selected.description)}</p>

            <div className="flow-steps">
              <div>
                <span>1</span>
                <strong>Read</strong>
                <p>Backend endpoints return CRM, market, and production records in one shape.</p>
              </div>
              <div>
                <span>2</span>
                <strong>Normalize</strong>
                <p>The cockpit maps those records into the shared scoring input.</p>
              </div>
              <div>
                <span>3</span>
                <strong>Score</strong>
                <p>Validation, scoring, recommendations, and deliverables run on the same data shape.</p>
              </div>
            </div>

            <dl className="integration-meta">
              <div><dt>Source reference</dt><dd>{plainSourceText(selected.source_ref)}</dd></div>
              <div><dt>How it is loaded</dt><dd>{plainSourceText(selected.production_method)}</dd></div>
              <div><dt>Source kind</dt><dd>{plainSourceText(selected.source_kind)}</dd></div>
            </dl>

            <div className="assumption-box">
              <strong>{snapshot.assumptions.summary}</strong>
              <p>Capacity and ERP context is labeled as pending until the ERP connection is live.</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
