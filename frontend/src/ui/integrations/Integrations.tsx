import { useMemo, useState } from "react";
import { useOperatingSnapshot } from "../../app/useOperatingSnapshot.ts";
import type { IntegrationRecord } from "../../engine/brain/operatingSnapshot.ts";
import { PlatformHealthWidget } from "./PlatformHealthWidget.tsx";

const STATUS_LABEL: Record<IntegrationRecord["status"], string> = {
  connected: "Connected",
  available: "Available",
  not_connected: "Not connected",
  future: "Future",
};

export function Integrations() {
  const snapshot = useOperatingSnapshot();
  const integrations = useMemo(() => snapshot?.integrations ?? [], [snapshot]);
  const [selectedId, setSelectedId] = useState("");
  const selected = integrations.find((item) => item.id === (selectedId || integrations[0]?.id)) ?? integrations[0];

  return (
    <div className="integrations">
      <div className="integrations-head">
        <p className="eyebrow">Data source contract</p>
        <h1>Data Sources</h1>
        <p>
          The cockpit uses one runtime path: backend CRM reads, monitor-engine market output, and a backend-served seeded operating baseline until ERP capacity is connected.
        </p>
      </div>

      <PlatformHealthWidget />

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
            <p>{selected.description}</p>

            <div className="flow-steps">
              <div>
                <span>1</span>
                <strong>Read</strong>
                <p>Backend endpoints return normalized CRM, monitor, and operating baseline records.</p>
              </div>
              <div>
                <span>2</span>
                <strong>Normalize</strong>
                <p>The single cockpit adapter maps those records into the shared brain contract.</p>
              </div>
              <div>
                <span>3</span>
                <strong>Score</strong>
                <p>Validation, scoring, recommendations, and deliverables run on the same data shape.</p>
              </div>
            </div>

            <dl className="integration-meta">
              <div><dt>Source reference</dt><dd>{selected.source_ref}</dd></div>
              <div><dt>Production method</dt><dd>{selected.production_method}</dd></div>
              <div><dt>Source kind</dt><dd>{selected.source_kind}</dd></div>
            </dl>

            <div className="assumption-box">
              <strong>{snapshot.assumptions.summary}</strong>
              <p>Capacity and ERP context is intentionally labeled as seeded baseline until the ERP integration is connected.</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
