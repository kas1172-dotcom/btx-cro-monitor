import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import defaultWeights from "../../../data/config/scoring-weights.v1.json";
import clientConfig from "../../../../clients/btx/config.json";
import { SETTINGS_SECTIONS } from "../../app/settingsSections.ts";
import { BACKEND_ENDPOINT, backendJson } from "../../app/backendApi.ts";
import { applyScoringConfig } from "../../app/config.ts";
import { clearMemory } from "../../memory/localMemory.ts";
import { resetUiState, setState, useStore, type SettingsSection } from "../../store/store.ts";
import type { WeightsConfig } from "../../engine/decision/weights.ts";
import { MemoryPanel } from "../brain/MemoryPanel.tsx";
import { Integrations } from "../integrations/Integrations.tsx";
import { SurfaceHeader } from "../primitives.tsx";

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
const DIMENSION_LABELS: Record<Dimension, string> = {
  risk: "Risk",
  opportunity: "Opportunity",
  capacityRisk: "Capacity risk",
  competitivePressure: "Competitive pressure",
};
const LIVE_MODE = Boolean(BACKEND_ENDPOINT);
const VISIBLE_SETTINGS_SECTIONS = SETTINGS_SECTIONS.filter((section) => section.id !== "prompts");

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

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function SettingHelp({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="settings-field-help">{children}</p>;
}

function ErrorSummary({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="settings-error-summary" role="alert" aria-labelledby="settings-error-summary-title">
      <strong id="settings-error-summary-title">Fix these settings before saving</strong>
      <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return (
    <div className="settings-dialog-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-confirm-title" aria-describedby="settings-confirm-body">
        <h2 id="settings-confirm-title">{title}</h2>
        <p id="settings-confirm-body">{body}</p>
        <div className="settings-inline-actions">
          <button type="button" className="settings-danger" onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" ref={cancelRef} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function applyWeights(document: WeightsConfig): void {
  applyScoringConfig(document);
}

function updatedLabel(response?: EngineConfigResponse<unknown> | null): string {
  if (!response) return LIVE_MODE ? "Not loaded from backend yet" : "Local draft";
  return `v${response.version} saved ${new Date(response.updated_at).toLocaleString()}`;
}

function sectionCopy(section: SettingsSection): { title: string; body: string } {
  switch (section) {
    case "engine":
      return {
        title: "Engine tuning",
        body: "Tune rules-based scoring weights. Changes apply immediately in this browser; save to persist them.",
      };
    case "memory":
      return {
        title: "Memory",
        body: "Review saved notes, generated deliverables, and activity history.",
      };
    case "prompts":
      return {
        title: "Prompts & rubrics",
        body: "Agent prompt, rubric, gold example, and banned-vocabulary editors land here after engine settings are wired.",
      };
    case "sources":
      return {
        title: "Source admin",
        body: "Enable, add, or remove monitor-engine sources. Free-text suggestions stay in the request queue.",
      };
    case "integrations":
      return {
        title: "Integrations",
        body: "Review CRM, ERP, work management, calendar, and market-data connection status.",
      };
    case "general":
      return {
        title: "General & history",
        body: "Manage local history and reset controls.",
      };
  }
}

function EngineTuningPanel() {
  const [weights, setWeights] = useState<WeightsConfig>(() => readLocal(WEIGHTS_KEY, defaultWeights as WeightsConfig));
  const [saved, setSaved] = useState<EngineConfigResponse<WeightsConfig> | null>(null);
  const [status, setStatus] = useState(LIVE_MODE ? "Loading backend scoring weights..." : "Local mode: changes save to this browser.");
  const errors = useMemo(() => {
    const next: string[] = [];
    for (const [eventType, row] of Object.entries(weights.weights)) {
      for (const dimension of DIMENSIONS) {
        const value = row?.[dimension];
        if (value !== undefined && (!Number.isFinite(value) || value < -100 || value > 100)) {
          next.push(`${eventType} ${DIMENSION_LABELS[dimension]} must be between -100 and 100 points.`);
        }
      }
    }
    return next;
  }, [weights]);

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
    if (errors.length > 0) {
      setStatus("Fix validation errors before saving.");
      return;
    }
    setStatus("Saving...");
    if (!LIVE_MODE) {
      window.localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
      setStatus("Saved to local settings.");
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
      <ErrorSummary errors={errors} />
      <section className="settings-field-section" aria-labelledby="settings-scoring-section">
        <h3 id="settings-scoring-section">Scoring event weights</h3>
        <p>Adjust how much each signal event contributes to each score dimension. Leave a field blank to use no contribution.</p>
      <div className="settings-weight-table">
        <div className="settings-weight-head">
          <span>Event type</span>
          {DIMENSIONS.map((dimension) => <span key={dimension}>{DIMENSION_LABELS[dimension]}</span>)}
        </div>
        {eventTypes.map((eventType) => (
          <div key={eventType} className="settings-weight-row">
            <strong id={`weight-${eventType}-label`}>{eventType}</strong>
            {DIMENSIONS.map((dimension) => (
              <label key={dimension}>
                <span>{DIMENSION_LABELS[dimension]}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={-100}
                  max={100}
                  step={1}
                  aria-describedby={`weight-${eventType}-${dimension}-help`}
                  aria-invalid={errors.some((error) => error.startsWith(`${eventType} ${DIMENSION_LABELS[dimension]}`))}
                  value={weights.weights[eventType]?.[dimension] ?? ""}
                  onChange={(event) => updateWeight(eventType, dimension, event.target.value)}
                />
                <SettingHelp id={`weight-${eventType}-${dimension}-help`}>Unit: points. Validation: blank or -100 to 100.</SettingHelp>
              </label>
            ))}
          </div>
        ))}
      </div>
      </section>
      <button className="settings-primary" disabled={errors.length > 0} onClick={() => void save()}>Save scoring weights</button>
    </div>
  );
}

function SourcesPanel() {
  const [registry, setRegistry] = useState<SourceRegistryDocument>(() => readLocal(SOURCES_KEY, DEFAULT_SOURCE_REGISTRY));
  const [saved, setSaved] = useState<EngineConfigResponse<SourceRegistryDocument> | null>(null);
  const [status, setStatus] = useState(LIVE_MODE ? "Loading backend source registry..." : "Local mode: changes save to this browser.");
  const [requestText, setRequestText] = useState(() => readLocal(SOURCE_REQUESTS_KEY, ""));
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [pendingRemove, setPendingRemove] = useState<SourceRegistryItem | null>(null);
  const enabledCount = useMemo(() => registry.sources.filter((source) => source.enabled).length, [registry]);
  const errors = useMemo(() => {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const [index, source] of registry.sources.entries()) {
      const row = source.name.trim() || `source ${index + 1}`;
      if (!source.id.trim()) next.push(`${row} needs a stable source ID.`);
      if (seen.has(source.id)) next.push(`${row} has a duplicate source ID.`);
      seen.add(source.id);
      if (!source.name.trim()) next.push(`${row} needs a display name.`);
      try {
        const url = new URL(source.url);
        if (url.protocol !== "https:") next.push(`${row} URL must use HTTPS.`);
      } catch {
        next.push(`${row} URL must be a valid absolute HTTPS URL.`);
      }
    }
    return next;
  }, [registry]);

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
    if (errors.length > 0) {
      setStatus("Fix validation errors before saving.");
      return;
    }
    setStatus("Saving...");
    if (!LIVE_MODE) {
      window.localStorage.setItem(SOURCES_KEY, JSON.stringify(registry));
      window.localStorage.setItem(SOURCE_REQUESTS_KEY, JSON.stringify(requestText));
      setStatus("Saved to local settings.");
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
      <ErrorSummary errors={errors} />
      <div className="settings-source-list">
        {registry.sources.map((source, index) => (
          <div key={source.id} className="settings-source-row">
            <h3 id={`source-${source.id}-heading`}>Source {index + 1}: {source.name || "Unnamed source"}</h3>
            <label>
              <span>Collection status</span>
              <input type="checkbox" checked={source.enabled} aria-describedby={`source-${source.id}-enabled-help`} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} />
              <SettingHelp id={`source-${source.id}-enabled-help`}>Default: enabled. Turn off to keep the source in the registry without collecting from it.</SettingHelp>
            </label>
            <label>
              <span>Source type</span>
              <select value={source.type} aria-describedby={`source-${source.id}-type-help`} onChange={(event) => updateSource(source.id, { type: event.target.value as SourceType })}>
                <option value="rss">RSS feed</option>
                <option value="json_api">JSON API</option>
                <option value="html_list">HTML list</option>
              </select>
              <SettingHelp id={`source-${source.id}-type-help`}>Validation: choose the parser that matches the upstream source format.</SettingHelp>
            </label>
            <label>
              <span>Display name</span>
              <input value={source.name} aria-describedby={`source-${source.id}-name-help`} aria-invalid={!source.name.trim()} onChange={(event) => updateSource(source.id, { name: event.target.value })} />
              <SettingHelp id={`source-${source.id}-name-help`}>Required. Used in user-facing source labels and diagnostics.</SettingHelp>
            </label>
            <label>
              <span>Collection URL</span>
              <input type="url" value={source.url} aria-describedby={`source-${source.id}-url-help`} onChange={(event) => updateSource(source.id, { url: event.target.value })} />
              <SettingHelp id={`source-${source.id}-url-help`}>Required. Unit: HTTPS URL. Validation: absolute URL beginning with https://.</SettingHelp>
            </label>
            <label>
              <span>Administration notes</span>
              <input value={source.notes} aria-describedby={`source-${source.id}-notes-help`} placeholder="Owner, scope, or collection caveats" onChange={(event) => updateSource(source.id, { notes: event.target.value })} />
              <SettingHelp id={`source-${source.id}-notes-help`}>Optional. Keep operational details here; users see source names elsewhere.</SettingHelp>
            </label>
            <button type="button" onClick={() => setPendingRemove(source)}>Remove source</button>
          </div>
        ))}
      </div>
      <div className="settings-inline-actions">
        <button type="button" onClick={addSource}>Add source</button>
        <button type="button" className="settings-primary" disabled={errors.length > 0} onClick={() => void save()}>Save sources</button>
        <button type="button" onClick={() => void runNow()}>Run collection now</button>
      </div>
      <label className="settings-request">
        <span>Free-text source suggestions</span>
        <textarea value={requestText} aria-describedby="source-request-help" onChange={(event) => setRequestText(event.target.value)} placeholder="Request another source or API here." />
        <SettingHelp id="source-request-help">Optional. These requests are saved as text for follow-up; they do not start collection automatically.</SettingHelp>
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
      {pendingRemove && (
        <ConfirmDialog
          title={`Remove ${pendingRemove.name}?`}
          body="This removes the source from this registry draft. Existing collected records are not deleted by this action. Save sources afterward to persist the removal."
          confirmLabel="Remove source"
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            setRegistry((current) => ({ sources: current.sources.filter((item) => item.id !== pendingRemove.id) }));
            setPendingRemove(null);
            setStatus("Source removed from draft. Save sources to persist.");
          }}
        />
      )}
    </div>
  );
}

export function SettingsWorkspace() {
  const { activeSettingsSection, activeTab } = useStore();
  const [confirmAction, setConfirmAction] = useState<null | "current_conversation" | "all_conversations" | "memory" | "workspace">(null);
  const active = VISIBLE_SETTINGS_SECTIONS.find((section) => section.id === activeSettingsSection) ?? VISIBLE_SETTINGS_SECTIONS[0];
  const copy = sectionCopy(active.id);
  const confirmCopy = {
    current_conversation: {
      title: "Clear current conversation?",
      body: `This removes the Ask conversation stored for ${activeTab}. It does not delete account records, saved deliverables, or source data.`,
      label: "Clear current conversation",
      action: () => clearCurrentThread(activeTab),
    },
    all_conversations: {
      title: "Clear all conversations?",
      body: "This removes every local Ask conversation stored in this browser. Account records, saved deliverables, and source data remain unchanged.",
      label: "Clear all conversations",
      action: clearAllThreads,
    },
    memory: {
      title: "Clear notes and activity?",
      body: "This removes saved notes, generated deliverable records, and local activity history from this browser. It does not change backend source records.",
      label: "Clear notes and activity",
      action: clearMemory,
    },
    workspace: {
      title: "Reset this workspace?",
      body: "This clears local conversations, notes, drafts, activity, and UI state, then reloads the workspace. Backend data and external systems are not changed.",
      label: "Reset workspace",
      action: () => {
        clearAllThreads();
        clearMemory();
        resetUiState();
        window.location.reload();
      },
    },
  } satisfies Record<NonNullable<typeof confirmAction>, { title: string; body: string; label: string; action: () => void }>;

  return (
    <section className="settings-workspace" data-surface-component="surface-settings">
      <SurfaceHeader eyebrow="Settings" headline={active.label} subline={active.summary} />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {VISIBLE_SETTINGS_SECTIONS.map((section) => (
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
              <button type="button" onClick={() => setConfirmAction("current_conversation")}>
                <strong>Clear current conversation</strong>
                <span>Remove the Ask conversation stored for the current route context.</span>
              </button>
              <button type="button" onClick={() => setConfirmAction("all_conversations")}>
                <strong>Clear all conversations</strong>
                <span>Remove every local Ask conversation from this browser.</span>
              </button>
              <button type="button" onClick={() => setConfirmAction("memory")}>
                <strong>Clear notes and activity</strong>
                <span>Remove saved notes, generated deliverable records, and activity history.</span>
              </button>
              <button type="button" onClick={() => setConfirmAction("workspace")}>
                <strong>Reset workspace</strong>
                <span>Remove local chats, notes, drafts, and activity, then reload this workspace.</span>
              </button>
            </div>
          ) : active.id === "memory" ? (
            <MemoryPanel />
          ) : active.id === "engine" ? (
            <EngineTuningPanel />
          ) : active.id === "sources" ? (
            <SourcesPanel />
          ) : active.id === "integrations" ? (
            <Integrations />
          ) : null}
        </div>
      </div>
      {confirmAction && (
        <ConfirmDialog
          title={confirmCopy[confirmAction].title}
          body={confirmCopy[confirmAction].body}
          confirmLabel={confirmCopy[confirmAction].label}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmCopy[confirmAction].action;
            setConfirmAction(null);
            action();
          }}
        />
      )}
    </section>
  );
}
