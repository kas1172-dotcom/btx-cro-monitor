import { useState } from "react";
import integrationsData from "../../../data/demo/btx/integrations.json";
import assumptionsData from "../../../data/demo/btx/assumptions.json";
import type { AssumptionsSnapshot, IntegrationRecord } from "../../adapters/demo/types.ts";

const INTEGRATIONS = integrationsData as IntegrationRecord[];
const ASSUMPTIONS = assumptionsData as AssumptionsSnapshot;

const STATUS_LABEL: Record<IntegrationRecord["status"], string> = {
  demo_connected: "Demo connected",
  available: "Available",
  not_connected: "Not connected",
  future: "Future",
};

export function Integrations() {
  const [selectedId, setSelectedId] = useState(INTEGRATIONS[0]?.id ?? "");
  const selected = INTEGRATIONS.find((item) => item.id === selectedId) ?? INTEGRATIONS[0];

  return (
    <div className="integrations">
      <div className="integrations-head">
        <p className="eyebrow">API integration preview</p>
        <h1>Data Sources</h1>
        <p>
          This static demo uses snapshots shaped like future API responses. In production, authenticated adapters populate the same contracts.
        </p>
      </div>

      <div className="integration-layout">
        <section className="integration-list">
          {INTEGRATIONS.map((item) => (
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
              <strong>Authorize</strong>
              <p>User grants scoped access through OAuth or a client-approved credential path.</p>
            </div>
            <div>
              <span>2</span>
              <strong>Normalize</strong>
              <p>FastAPI adapter maps source fields into the shared DataAdapter contract.</p>
            </div>
            <div>
              <span>3</span>
              <strong>Score</strong>
              <p>The same validation, scoring, recommendations, and Chatpil explanations run unchanged.</p>
            </div>
          </div>

          <dl className="integration-meta">
            <div><dt>Demo snapshot</dt><dd>{selected.demo_file}</dd></div>
            <div><dt>Production method</dt><dd>{selected.production_method}</dd></div>
            <div><dt>Current mode</dt><dd>{selected.is_demo ? "Static demo data" : "Configured source"}</dd></div>
          </dl>

          <div className="assumption-box">
            <strong>{ASSUMPTIONS.summary}</strong>
            <p>Hybrid mode uses the backend for live CRM data and monitor artifacts. Use `VITE_DATA_MODE=demo` only for local fixture runs.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
