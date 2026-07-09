import { useEffect, useMemo, useState } from "react";
import defaultWeights from "../../../data/config/scoring-weights.v1.json";
import clientConfig from "../../../../clients/btx/config.json";
import { SETTINGS_SECTIONS } from "../../app/settingsSections.ts";
import { BACKEND_ENDPOINT, backendJson } from "../../app/backendApi.ts";
import { CONFIG } from "../../app/config.ts";
import { clearMemory } from "../../memory/localMemory.ts";
import { resetUiState, setState, useStore, type SettingsSection } from "../../store/store.ts";
import type { WeightsConfig } from "../../engine/decision/weights.ts";

type Dimension = "risk" | "opportunity" | "capacityRisk" | "competitivePressure";
type SourceType = "rss" | "json_api" | "html_list";

interface EngineConfigResponse<T> {
  name: string;
  version: number;
  document: T;
  change_note?: string | null;
  updated_at: string;
}

interface SourceRegistryItem {
  id: string;
  type: SourceType;
  name: string;
  url: string;
  enabled: boolean;
  notes: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SourceRegistryDocument {
  sources: SourceRegistryItem[];
}

interface PipelineRun {
  id: string;
  triggered_at: string;
  mechanism: string;
  status: string;
  completed_at?: string | null;
  detail?: string | null;
}

const WEIGHTS_KEY = "btx.settings.scoring_weights";
const SOURCES_KEY = "btx.settings.source_registry";
const SOURCE_REQUESTS_KEY = "btx.settings.source_requests";
const DIMENSIONS: Dimension[] = ["risk", "opportunity", "capacityRisk", "competitivePressure"];
const LIVE_MODE = Boolean(BACKEND_ENDPOINT);

const DEFAULT_SOURCE_REGISTRY: SourceRegistryDocument = {
  sources: ((clientConfig as { sources: Array<Record<string, unknown>> }).sources ?? []).map((source) => ({
    ...(source as Record<string, unknown>),
    id: String(source.id),
    type: source.type as SourceType,
    name: String(source.name),
    url: String(source.url),
    enabled: true,
    notes: "",
    config: source,
  })),
};

function clearCurrentThread(area: string): void {
  window.localStorage.removeItem(`btx.chatpil.thread.${area}`);
  window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
}

function clearAllThreads(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("btx.chatpil.thread.")) window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
}

function resetDemo(): void {
  if (!window.confirm("Reset demo and clear all local state?")) return;
  clearAllThreads();
  clearMemory();
  resetUiState();
  window.location.reload();
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function applyWeights(document: WeightsConfig): void {
  Object.assign(CONFIG, document);
}

function updatedLabel(response?: EngineConfigResponse<unknown> | null): string {
  if (!response) return LIVE_MODE ? "Not loaded from backend yet" : "Local demo draft";
  return `v${response.version} saved ${new Date(response.updated_at).toLocaleString()}`;
}

function sectionCopy(section: SettingsSection): { title: string; body: string } {
  switch (section) {
    case "engine":
      return {
        title: "Engine tuning",
        body: "Tune deterministic scoring weights. Changes apply immediately in this browser; save to persist them.",
      };
    case "prompts":
      return {
        title: "Prompts & rubrics",
        body: "Agent prompt, rubric, gold example, and banned-vocabulary editors land here after engine settings are wired.",
      };
    case "connections":
      return {
        title: "Sources",
        body: "Enable, add, or remove monitor-engine sources. Free-text suggestions stay in the request queue.",
      };
    case "general":
      return {
        title: "General & history",
        body: "Manage local demo history and reset controls.",
      };
  }
}

function EngineTuningPanel() {
  const [weights, setWeights] = useState<WeightsConfig>(() => readLocal(WEIGHTS_KEY, defaultWeights as WeightsConfig));
  const [saved, setSaved] = useState<EngineConfigResponse<WeightsConfig> | null>(null);
  const [status, setStatus] = useState(LIVE_MODE ? "Loading backend scoring weights..." : "Demo mode: changes save to this browser.");

  useEffect(() => {
    let alive = true;
    if (!LIVE_MODE) {
      applyWeights(weights);
      return;
    }
    backendJson<EngineConfigResponse<WeightsConfig>>("/engine-config/scoring_weights")
      .then((response) => {
        if (!alive) return;
        setWeights(response.document);
        applyWeights(response.document);
        setSaved(response);
        setStatus("Loaded from backend.");
      })
      .catch((error) => {
        if (alive) setStatus(error instanceof Error ? error.message : "Could not load backend scoring weights.");
      });
    return () => {
      alive = false;
    };
  }, []);

  function updateWeight(eventType: string, dimension: Dimension, value: string): void {
    const next = {
      ...weights,
      weights: {
        ...weights.weights,
        [eventType]: {
          ...weights.weights[eventType],
          [dimension]: value === "" ? undefined : Number(value),
        },
      },
    };
    setWeights(next);
    applyWeights(next);
  }

  async function save(): Promise<void> {
    setStatus("Saving...");
    if (!LIVE_MODE) {
      window.localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
      setStatus("Saved to local demo settings.");
      return;
    }
    try {
      const response = await backendJson<EngineConfigResponse<WeightsConfig>>("/engine-config/scoring_weights", {
        method: "PUT",
        body: JSON.stringify({ document: weights, change_note: "Updated from Settings Engine tuning." }),
      });
      setSaved(response);
      setStatus("Saved to backend.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  }

  const eventTypes = Object.keys(weights.weights).sort();
  return (
    <div className="settings-live-panel">
      <div className="settings-status">
        <strong>{LIVE_MODE ? "Backend scoring_weights" : "Local scoring_weights"}</strong>
        <span>{updatedLabel(saved)}</span>
        <em>{status}</em>
      </div>
      <div className="settings-weight-table">
        <div className="settings-weight-head">
          <span>Event type</span>
          {DIMENSIONS.map((dimension) => <span key={dimension}>{dimension}</span>)}
        </div>
        {eventTypes.map((eventType) => (
          <div key={eventType} className="settings-weight-row">
            <strong>{eventType}</strong>
            {DIMENSIONS.map((dimension) => (
              <input
                key={dimension}
                type="number"
                value={weights.weights[eventType]?.[dimension] ?? ""}
                onChange={(event) => updateWeight(eventType, dimension, event.target.value)}
              />
            ))}
          </div>
        ))}
      </div>
      <button className="settings-primary" onClick={() => void save()}>Save scoring weights</button>
    </div>
  );
}

function SourcesPanel() {
  const [registry, setRegistry] = useState<SourceRegistryDocument>(() => readLocal(SOURCES_KEY, DEFAULT_SOURCE_REGISTRY));
  const [saved, setSaved] = useState<EngineConfigResponse<SourceRegistryDocument> | null>(null);
  const [status, setStatus] = useState(LIVE_MODE ? "Loading backend source registry..." : "Demo mode: changes save to this browser.");
  const [requestText, setRequestText] = useState(() => readLocal(SOURCE_REQUESTS_KEY, ""));
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const enabledCount = useMemo(() => registry.sources.filter((source) => source.enabled).length, [registry]);

  function loadRuns(): void {
    if (!LIVE_MODE) return;
    void backendJson<{ records: PipelineRun[] }>("/pipeline/runs")
      .then((response) => setRuns(response.records))
      .catch(() => undefined);
  }

  useEffect(() => {
    let alive = true;
    if (!LIVE_MODE) return;
    backendJson<EngineConfigResponse<SourceRegistryDocument>>("/engine-config/source_registry")
      .then((response) => {
        if (!alive) return;
        setRegistry(response.document);
        setSaved(response);
        setStatus("Loaded from backend.");
        loadRuns();
      })
      .catch((error) => {
        if (alive) setStatus(error instanceof Error ? error.message : "Could not load backend sources.");
      });
    const timer = window.setInterval(loadRuns, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  function updateSource(id: string, patch: Partial<SourceRegistryItem>): void {
    setRegistry((current) => ({
      sources: current.sources.map((source) => source.id === id ? { ...source, ...patch, config: { ...(source.config ?? source), ...patch } } : source),
    }));
  }

  function addSource(): void {
    const id = `source-${Date.now()}`;
    setRegistry((current) => ({
      sources: [
        ...current.sources,
        { id, type: "rss", name: "New source", url: "https://example.com/feed.xml", enabled: true, notes: "", config: { id, type: "rss", name: "New source", url: "https://example.com/feed.xml" } },
      ],
    }));
  }

  async function save(): Promise<void> {
    setStatus("Saving...");
    if (!LIVE_MODE) {
      window.localStorage.setItem(SOURCES_KEY, JSON.stringify(registry));
      window.localStorage.setItem(SOURCE_REQUESTS_KEY, JSON.stringify(requestText));
      setStatus("Saved to local demo settings.");
      return;
    }
    try {
      const response = await backendJson<EngineConfigResponse<SourceRegistryDocument>>("/engine-config/source_registry", {
        method: "PUT",
        body: JSON.stringify({ document: registry, change_note: "Updated from Settings Sources." }),
      });
      setSaved(response);
      setStatus("Saved to backend.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  }

  async function runNow(): Promise<void> {
    if (!LIVE_MODE) {
      setStatus("Run collection is available only when VITE_BACKEND_ENDPOINT is configured.");
      return;
    }
    setStatus("Triggering collection...");
    try {
      const run = await backendJson<PipelineRun>("/pipeline/run", { method: "POST" });
      setStatus(`Pipeline ${run.status}: ${run.id}`);
      loadRuns();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pipeline trigger failed.");
    }
  }

  return (
    <div className="settings-live-panel">
      <div className="settings-status">
        <strong>{LIVE_MODE ? "Backend source_registry" : "Local source_registry"}</strong>
        <span>{enabledCount} enabled of {registry.sources.length} sources · {updatedLabel(saved)}</span>
        <em>{status}</em>
      </div>
      <div className="settings-source-list">
        {registry.sources.map((source) => (
          <div key={source.id} className="settings-source-row">
            <label>
              <input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} />
              <span>Enabled</span>
            </label>
            <select value={source.type} onChange={(event) => updateSource(source.id, { type: event.target.value as SourceType })}>
              <option value="rss">RSS</option>
              <option value="json_api">JSON API</option>
              <option value="html_list">HTML list</option>
            </select>
            <input value={source.name} onChange={(event) => updateSource(source.id, { name: event.target.value })} />
            <input value={source.url} onChange={(event) => updateSource(source.id, { url: event.target.value })} />
            <input value={source.notes} placeholder="Notes" onChange={(event) => updateSource(source.id, { notes: event.target.value })} />
            <button onClick={() => setRegistry((current) => ({ sources: current.sources.filter((item) => item.id !== source.id) }))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="settings-inline-actions">
        <button onClick={addSource}>Add source</button>
        <button className="settings-primary" onClick={() => void save()}>Save sources</button>
        <button onClick={() => void runNow()}>Run collection now</button>
      </div>
      <label className="settings-request">
        <span>Free-text source suggestions</span>
        <textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="Request another source or API here." />
      </label>
      {runs.length > 0 && (
        <div className="settings-runs">
          {runs.slice(0, 5).map((run) => (
            <div key={run.id}>
              <strong>{run.status}</strong>
              <span>{run.mechanism} · {new Date(run.triggered_at).toLocaleString()}</span>
              <em>{run.detail ?? run.id}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsWorkspace() {
  const { activeSettingsSection, activeBrainArea } = useStore();
  const active = SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection) ?? SETTINGS_SECTIONS[0];
  const copy = sectionCopy(active.id);

  return (
    <section className="settings-workspace">
      <div className="settings-head">
        <p className="eyebrow">Settings</p>
        <h1>{active.label}</h1>
        <p>{active.summary}</p>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              className={section.id === active.id ? "active" : ""}
              onClick={() => setState({ activeSettingsSection: section.id })}
            >
              <strong>{section.label}</strong>
              <span>{section.summary}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          <div className="panel-head">
            <h2>{copy.title}</h2>
          </div>
          {active.id === "general" ? (
            <div className="settings-actions">
              <button onClick={() => clearCurrentThread(activeBrainArea)}>
                <strong>Clear this chat</strong>
                <span>Remove the Chatpil thread stored for the current rail area.</span>
              </button>
              <button onClick={clearAllThreads}>
                <strong>Clear all chats</strong>
                <span>Remove every local Chatpil thread from this browser.</span>
              </button>
              <button onClick={clearMemory}>
                <strong>Clear notes + activity</strong>
                <span>Remove saved notes, generated deliverable records, and activity history.</span>
              </button>
              <button onClick={resetDemo}>
                <strong>Reset demo</strong>
                <span>Clear local demo state and reload from the seeded snapshot.</span>
              </button>
            </div>
          ) : active.id === "engine" ? (
            <EngineTuningPanel />
          ) : active.id === "connections" ? (
            <SourcesPanel />
          ) : (
            <div className="settings-placeholder">
              <p>{copy.body}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
