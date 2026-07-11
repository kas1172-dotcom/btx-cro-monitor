import { useOperatingSnapshot } from "../../app/useOperatingSnapshot.ts";
import type { IntegrationRecord } from "../../engine/brain/operatingSnapshot.ts";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";

const STATUS_LABEL: Record<IntegrationRecord["status"], string> = {
  demo_connected: "Demo connected",
  available: "Available",
  not_connected: "Not connected",
  future: "Future",
};

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Not available";
  return value.includes("T") ? new Date(value).toLocaleDateString() : value;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function OperatingSnapshot() {
  const snapshot = useOperatingSnapshot();

  if (!snapshot) return <div className="loading">loading operating snapshot…</div>;

  const connected = snapshot.integrations.filter((i) => i.status === "demo_connected");
  const available = snapshot.integrations.filter((i) => i.status === "available");
  const usingArtifacts = snapshot.publicSignals.source_mode === "artifact";

  return (
    <div className="operating">
      <section className="operating-head">
        <p className="eyebrow">Operating snapshot</p>
        <h1>What data is the brain using right now?</h1>
        <p>
          {usingArtifacts
            ? "Market signals are real monitor-engine artifacts. CRM, capacity, pipeline, contacts, and accounts remain simulated demo snapshots until a client provides authenticated operating data."
            : "This page shows the simulated, API-shaped data currently feeding the demo brain. In production, authenticated adapters would replace these static snapshots while preserving the same operating contract."}
        </p>
      </section>

      <section className="operating-summary">
        <div>
          <span>CRM accounts</span>
          <strong>{snapshot.crm.length}</strong>
          <em>{snapshot.crm[0]?.source_name ?? "CRM snapshot"}</em>
          <ProvenanceBadge label={snapshot.crm[0]?.source_name === "Demo fallback" ? "Demo" : "HubSpot"} />
        </div>
        <div>
          <span>Capacity sources</span>
          <strong>{snapshot.capacity.length}</strong>
          <em>{snapshot.capacity[0]?.source_name ?? "ERP snapshot"}</em>
          <ProvenanceBadge label="Demo" />
        </div>
        <div>
          <span>Public signals</span>
          <strong>{snapshot.publicSignals.signal_count}</strong>
          <em>{usingArtifacts ? "real monitor-engine artifacts" : `${snapshot.publicSignals.news_count} public news events`}</em>
          <ProvenanceBadge label={usingArtifacts ? "Monitor" : "Demo"} />
        </div>
        <div>
          <span>Demo as of</span>
          <strong>{snapshot.assumptions.as_of}</strong>
          <em>Static demo disclosure</em>
        </div>
      </section>

      <section className="operating-grid">
        <div className="operating-panel">
          <div className="panel-head">
            <h2>CRM Snapshot</h2>
          </div>
          {snapshot.crm.map((row) => (
            <div key={row.account_id} className="operating-row">
              <strong>{row.crm_account_name}</strong>
              <span>{row.account_tier} · {titleCase(row.relationship_health)} · owner {row.owner}</span>
              <em>{money(row.open_pipeline_value)} open pipeline · last activity {dateLabel(row.last_activity_at)}</em>
              <small>{row.next_step}</small>
            </div>
          ))}
        </div>

        <div className="operating-panel">
          <div className="panel-head">
            <h2>Capacity / ERP Snapshot</h2>
          </div>
          {snapshot.capacity.map((row) => (
            <div key={row.facility_id} className="operating-row">
              <strong>{row.facility_name}</strong>
              <span>{row.city} · {titleCase(row.capacity_status)}</span>
              <em>{row.available_5_axis_hours_next_30d} 5-axis hrs · {row.available_turning_hours_next_30d} turning hrs · {row.quoted_lead_time_days} day lead time</em>
              <small>Constraint: {row.constraint}</small>
            </div>
          ))}
        </div>

        <div className="operating-panel">
          <div className="panel-head">
            <h2>Pipeline / Contracts Snapshot</h2>
          </div>
          <div className="operating-callout">
            <strong>{money(snapshot.pipeline.summary.open_pipeline_value)} open pipeline</strong>
            <span>{money(snapshot.pipeline.summary.weighted_pipeline_value)} weighted · as of {snapshot.pipeline.as_of}</span>
            <em>{snapshot.pipeline.summary.top_action}</em>
          </div>
          {snapshot.pipeline.records.map((row) => (
            <div key={row.company_id} className="operating-row">
              <strong>{row.recommended_action}</strong>
              <span>{row.company_id}</span>
              <em>{row.reason}</em>
            </div>
          ))}
        </div>

        <div className="operating-panel">
          <div className="panel-head">
            <h2>Public Signals Snapshot</h2>
          </div>
          <div className="operating-callout">
            <strong>{snapshot.publicSignals.signal_count} scored market signals</strong>
            <span>{usingArtifacts ? `Run ${dateLabel(snapshot.publicSignals.run_at ?? null)} · ${snapshot.publicSignals.archive_run_count ?? 0} archived runs` : `${snapshot.publicSignals.news_count} public events shaped for extraction`}</span>
            <em>Latest signal {dateLabel(snapshot.publicSignals.latest_signal_at)} · latest news {dateLabel(snapshot.publicSignals.latest_news_date)}</em>
          </div>
          <p className="operating-copy">
            {usingArtifacts
              ? `These real monitor-engine artifact signals are validated as market context. Until identity matching is canonical, weak account matches stay portfolio-level and do not affect account scores. Source artifact: ${snapshot.publicSignals.artifact_path}.`
              : "These static public market and contract signals are validated before they affect scores, alerts, recommendations, and Chatpil explanations."}
          </p>
        </div>

        <div className="operating-panel">
          <div className="panel-head">
            <h2>Integration Status</h2>
          </div>
          <div className="integration-mini-grid">
            {snapshot.integrations.map((item) => (
              <div key={item.id} className="integration-mini">
                <span className={`status-dot status-${item.status}`} />
                <strong>{item.name}</strong>
                <em>{item.category} · {STATUS_LABEL[item.status]}</em>
                <small>{item.demo_file}</small>
              </div>
            ))}
          </div>
          <p className="operating-copy">
            {connected.length} demo-connected sources are active in this static snapshot. {available.length} public source is listed as available for a future adapter.
          </p>
        </div>

        <div className="operating-panel">
          <div className="panel-head">
            <h2>Data Freshness / Demo Disclosure</h2>
          </div>
          {snapshot.publicSignals.source_mode === "artifact" && (
            <div className={snapshot.publicSignals.stale ? "operating-callout warn" : "operating-callout"}>
              <strong>Monitor-engine run: {dateLabel(snapshot.publicSignals.run_at ?? null)}</strong>
              <span>{snapshot.publicSignals.stale ? "Artifact data is older than 7 days." : "Artifact signal data is fresh."}</span>
            </div>
          )}
          {snapshot.publicSignals.source_mode === "artifact_fallback" && (
            <div className="operating-callout warn">
              <strong>Artifact fallback active</strong>
              <span>{snapshot.publicSignals.notice}</span>
            </div>
          )}
          <div className="operating-callout warn">
            <strong>{snapshot.assumptions.summary}</strong>
            <span>Source mode: {titleCase(snapshot.assumptions.source_mode)}</span>
          </div>
          <ul className="operating-list">
            {snapshot.assumptions.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
