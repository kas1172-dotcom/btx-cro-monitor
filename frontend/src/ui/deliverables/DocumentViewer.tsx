import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl } from "react-leaflet";
import type { Deliverable, DeliverableSection } from "../../deliverables/types.ts";
import type { World } from "../../app/useWorld.ts";
import type { Company, Contact, Opportunity } from "../../engine/brain/entities.ts";
import { deliverableToMarkdown } from "../../deliverables/markdown.ts";
import { closeDeliverable, openDemoAction, setState } from "../../store/store.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { BACKEND_ENDPOINT, backendJson } from "../../app/backendApi.ts";
import { hasDeliverablesBackend, recordToDeliverable, saveStoredDeliverable } from "../../app/deliverablesApi.ts";
import { requestSectionRevision } from "../../deliverables/editorAssistant.ts";
import {
  DELIVERABLE_DOWNLOAD_FORMATS,
  downloadCsv,
  downloadDocx,
  downloadIcs,
  downloadMarkdown,
  downloadXlsx,
  printDeliverable,
  type DownloadFormat,
} from "../../deliverables/export.ts";
import { uiTokens } from "../../app/uiTokens.ts";
import { AnalysisFigure } from "../analysis/ChartFigure.tsx";
import type { ChartSpec } from "../../metrics/types.ts";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const copilotEndpoint = env?.VITE_COPILOT_ENDPOINT ?? processEnv?.VITE_COPILOT_ENDPOINT;
const EDITOR_BANNED_VOCABULARY = ["demo", "snapshot", "simulated", "deterministic", "Revenue Brain"];

interface TaskTarget {
  company?: Company;
  contact?: Contact;
  deal?: Opportunity;
}

type TaskDialog =
  | { status: "confirm"; subject: string; body: string; target: TaskTarget }
  | { status: "creating"; subject: string; body: string; target: TaskTarget }
  | { status: "created"; subject: string; body: string; target: TaskTarget; id: string; recordUrl: string }
  | { status: "error"; subject: string; body: string; target: TaskTarget; error: string };

function isChartSpec(value: unknown): value is ChartSpec {
  return Boolean(value) && typeof value === "object" && typeof (value as { metric?: unknown }).metric === "string" && typeof (value as { viz?: unknown }).viz === "string";
}

function editableSections(sections: DeliverableSection[]): DeliverableSection[] {
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => ({ ...block })),
  }));
}

export function DocumentViewer({ deliverable, world, openedFrom = "generation" }: { deliverable: Deliverable; world?: World; openedFrom?: "generation" | "library" }) {
  const [sections, setSections] = useState(() => editableSections(deliverable.sections));
  const [title, setTitle] = useState(deliverable.title);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ id: string; sectionId: string; text: string; warning?: string }>>([]);
  const [taskDialog, setTaskDialog] = useState<TaskDialog | null>(null);
  const current = useMemo(() => ({ ...deliverable, title, sections }), [deliverable, sections, title]);
  const markdown = useMemo(() => deliverableToMarkdown(current), [current]);

  useEffect(() => {
    setSections(editableSections(deliverable.sections));
    setTitle(deliverable.title);
    setDirty(false);
    setSaveStatus("");
    setSuggestions([]);
    setMenuOpen(false);
  }, [deliverable.id, deliverable.sections]);

  function updateText(sectionId: string, blockIndex: number, text: string) {
    setSections((items) => items.map((section) => section.id === sectionId
      ? {
          ...section,
          blocks: section.blocks.map((block, index) => index === blockIndex && block.kind === "text" ? { ...block, text } : block),
        }
      : section));
    setDirty(true);
  }

  function closeEditor() {
    if (dirty) {
      const choice = window.confirm("Save changes before closing?");
      if (choice) void saveCurrent();
    }
    closeDeliverable();
  }

  async function saveCurrent() {
    const saved: Deliverable = {
      ...current,
      sources: [
        ...current.sources.filter((source) => source.source !== "user edits"),
        { source: "user edits", records: [current.id], reason: `Edited by user, ${new Date().toISOString()}` },
      ],
    };
    const localSaved = saveDeliverable(saved);
    setState({ activeDeliverable: localSaved, activeDeliverableOrigin: openedFrom === "library" ? "library" : "generation" });
    setSaveStatus("Saved locally.");
    try {
      if (hasDeliverablesBackend()) {
        const record = await saveStoredDeliverable(localSaved);
        const persisted = recordToDeliverable(record);
        saveDeliverable(persisted);
        setState({ activeDeliverable: persisted, activeDeliverableOrigin: openedFrom === "library" ? "library" : "generation" });
        setSaveStatus("Saved to program memory.");
      }
      setDirty(false);
    } catch (error) {
      setSaveStatus(error instanceof Error ? `Saved locally; backend save failed: ${error.message}` : "Saved locally; backend save failed.");
    }
  }

  function copyMarkdown() {
    void navigator.clipboard?.writeText(markdown);
  }

  async function download(format: DownloadFormat) {
    setMenuOpen(false);
    if (format === "markdown") downloadMarkdown(current);
    if (format === "docx") await downloadDocx(current);
    if (format === "pdf") printDeliverable(current, world);
    if (format === "pptx" && world) {
      const { downloadBoardDeck, downloadSalesPitch } = await import("../../deliverables/deck/pptx.ts");
      if (current.type === "sales_pitch") await downloadSalesPitch(current, world);
      else await downloadBoardDeck(current, world);
    }
    if (format === "xlsx") await downloadXlsx(current);
    if (format === "csv") downloadCsv(current);
    if (format === "ics") downloadIcs(current);
  }

  async function requestSuggestion() {
    const instruction = assistantInput.trim();
    if (!instruction) return;
    const target = sections.find((section) => instruction.toLowerCase().includes(section.heading.toLowerCase())) ?? sections.find((section) => section.blocks.some((block) => block.kind === "text"));
    if (!target) return;
    const firstText = target.blocks.find((block) => block.kind === "text");
    if (!firstText || firstText.kind !== "text") return;
    const endpoint = copilotEndpoint;
    if (!endpoint) {
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, text: firstText.text, warning: "Assistant needs the connection — manual editing still works." }]);
      setAssistantInput("");
      return;
    }
    try {
      const text = await requestSectionRevision({
        endpoint,
        deliverable: current,
        section: target,
        instruction,
        bannedVocabulary: EDITOR_BANNED_VOCABULARY,
      });
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, text }]);
    } catch (error) {
      setSuggestions((items) => [...items, {
        id: `${Date.now()}`,
        sectionId: target.id,
        text: "No suggestion generated.",
        warning: error instanceof Error ? error.message : "Assistant revision failed.",
      }]);
    } finally {
      setAssistantInput("");
    }
  }

  function taskTarget(): TaskTarget {
    const entityId = current.entityIds[0];
    const company = world?.companies.find((item) => item.id === entityId)
      ?? world?.companies.find((item) => current.entityIds.includes(item.id));
    const contact = company ? world?.contacts.find((item) => item.company_id === company.id) : undefined;
    const deal = company ? world?.opportunities.find((item) => item.company_id === company.id && item.stage !== "won" && item.stage !== "lost") : undefined;
    return { company, contact, deal };
  }

  function createTaskDraft(): Omit<Extract<TaskDialog, { status: "confirm" }>, "status"> {
    const subject = `Follow up: ${current.title}`.slice(0, 250);
    const body = [
      `Created from BTX cockpit deliverable: ${current.title}`,
      "",
      markdown.slice(0, 3500),
    ].join("\n");
    return { subject, body, target: taskTarget() };
  }

  function openTaskFlow() {
    const draft = createTaskDraft();
    if (BACKEND_ENDPOINT) {
      setTaskDialog({ ...draft, status: "confirm" });
      return;
    }
    openDemoAction({ title: "Create CRM task", action: "crm_task", evidence: deliverable.title });
  }

  async function confirmTask() {
    if (!taskDialog || taskDialog.status === "created" || taskDialog.status === "creating") return;
    const draft = { subject: taskDialog.subject, body: taskDialog.body, target: taskDialog.target };
    setTaskDialog({ ...draft, status: "creating" });
    try {
      const result = await backendJson<{ id: string; record_url: string }>("/crm/task", {
        method: "POST",
        body: JSON.stringify({
          title: draft.subject,
          body: draft.body,
          deliverable_id: current.id,
          company_id: draft.target.company?.id,
          contact_id: draft.target.contact?.id,
          deal_id: draft.target.deal?.id,
        }),
      });
      setTaskDialog({ ...draft, status: "created", id: result.id, recordUrl: result.record_url });
    } catch (error) {
      setTaskDialog({ ...draft, status: "error", error: error instanceof Error ? error.message : "CRM task creation failed." });
    }
  }

  function applySuggestion(id: string) {
    const suggestion = suggestions.find((item) => item.id === id);
    if (!suggestion || suggestion.warning) return;
    setSections((items) => items.map((section) => section.id === suggestion.sectionId
      ? { ...section, blocks: section.blocks.map((block, index) => index === 0 && block.kind === "text" ? { ...block, text: suggestion.text } : block) }
      : section));
    setSuggestions((items) => items.filter((item) => item.id !== id));
    setDirty(true);
  }

  const formats = DELIVERABLE_DOWNLOAD_FORMATS[deliverable.type];
  const accountId = current.canonicalAccountId ?? current.entityIds[0] ?? null;
  const sourceAccount = accountId ? world?.companies.find((company) => company.id === accountId) : undefined;
  const sourceTrace = sourceAccount
    ? { label: `Generated from: ${sourceAccount.name}`, surface: "accounts" as const, companyId: sourceAccount.id }
    : current.tripId
      ? { label: `Generated from: ${current.tripId}`, surface: "map" as const, companyId: null }
      : null;

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true">
    <article className="document-viewer editor-window">
      <header className="document-head">
        <div>
          <p className="eyebrow">Deliverable</p>
          <input className="document-title-input" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
          <span title={deliverable.confidenceReason}>{deliverable.audience ?? "Internal"} · {(deliverable.form ?? deliverable.type).replace(/_/g, " ")} · {deliverable.confidence} confidence{dirty ? " · edited" : ""}</span>
          {sourceTrace && (
            <button
              className="document-source-trace"
              onClick={() => setState({
                activeDeliverable: null,
                activeTab: sourceTrace.surface,
                activeCompanyId: sourceTrace.companyId,
              })}
            >
              {sourceTrace.label}
            </button>
          )}
          {saveStatus && <span className="document-save-status">{saveStatus}</span>}
        </div>
        <div className="document-actions">
          <button onClick={closeEditor} aria-label={openedFrom === "library" ? "Back to library" : "Close editor"}>{openedFrom === "library" ? "Back" : "×"}</button>
          <button onClick={() => void saveCurrent()}>Save to Library</button>
          <button onClick={copyMarkdown}>Copy</button>
          <div className="download-menu">
            <button onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>Download</button>
            {menuOpen && (
              <div className="download-menu-list">
                {formats.map((format) => (
                  <button key={format} onClick={() => void download(format)} disabled={format === "pptx" && !world}>
                    {format === "pdf" ? "PDF (via Print)" : format === "pptx" ? "PowerPoint (.pptx)" : format === "docx" ? "Word (.docx)" : format === "xlsx" ? "Excel (.xlsx)" : format === "ics" ? "Calendar (.ics)" : format.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => openDemoAction({ title: "Send via Outlook", action: "follow_up", evidence: "Demo mode - no external writes." })}>Send</button>
          <button onClick={openTaskFlow}>Create task</button>
        </div>
      </header>

      {taskDialog && (
        <div className="task-confirmation" role="dialog" aria-modal="true" aria-labelledby="task-confirm-title">
          <div className="task-confirmation-panel">
            <p className="eyebrow">CRM task</p>
            <h2 id="task-confirm-title">{taskDialog.status === "created" ? "Task created" : "Create task?"}</h2>
            <div className="task-preview">
              <span>Subject</span>
              <strong>{taskDialog.subject}</strong>
            </div>
            <div className="task-preview">
              <span>Target</span>
              <strong>{taskDialog.target.company?.name ?? "No company association"}</strong>
              {taskDialog.target.contact && <em>Contact: {taskDialog.target.contact.name}</em>}
              {taskDialog.target.deal && <em>Deal: {taskDialog.target.deal.name}</em>}
            </div>
            <div className="task-preview">
              <span>Body preview</span>
              <p>{taskDialog.body.slice(0, 420)}{taskDialog.body.length > 420 ? "..." : ""}</p>
            </div>
            {taskDialog.status === "error" && <div className="task-error" role="status">{taskDialog.error}</div>}
            {taskDialog.status === "created" && (
              <a className="task-success-link" href={taskDialog.recordUrl} target="_blank" rel="noreferrer">
                Open CRM record
              </a>
            )}
            <div className="task-confirmation-actions">
              {taskDialog.status !== "created" && (
                <button onClick={() => void confirmTask()} disabled={taskDialog.status === "creating"}>
                  {taskDialog.status === "creating" ? "Creating..." : "Confirm"}
                </button>
              )}
              <button onClick={() => setTaskDialog(null)}>{taskDialog.status === "created" ? "Done" : "Cancel"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="editor-document">
        {sections.map((section) => (
          <section key={section.id} className="document-section">
            <h2>{section.heading}</h2>
            {section.blocks.map((block, index) => {
            if (block.kind === "text") {
              return (
                <textarea
                  key={`${section.id}-${index}`}
                  className="document-text-block document-text-editor"
                  value={block.text}
                  onChange={(event) => updateText(section.id, index, event.target.value)}
                  aria-label={`${section.heading} text`}
                />
              );
            }
            if (block.kind === "table") {
              return (
                <table key={`${section.id}-${index}`}>
                  <thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
                </table>
              );
            }
            if (block.kind === "chart-spec") {
              return (
                <div key={`${section.id}-${index}`} className="document-chart-figure">
                  <strong>{block.title}</strong>
                  {world && isChartSpec(block.spec)
                    ? <AnalysisFigure spec={block.spec} world={world} interactive={false} />
                    : <pre>{JSON.stringify(block.spec, null, 2)}</pre>}
                </div>
              );
            }
            if (block.kind === "map-ref" && block.stops?.length) {
              const center: [number, number] = [
                block.stops.reduce((sum, stop) => sum + stop.lat, 0) / block.stops.length,
                block.stops.reduce((sum, stop) => sum + stop.lon, 0) / block.stops.length,
              ];
              const byDay = new Map<number, Array<[number, number]>>();
              for (const stop of block.stops) {
                byDay.set(stop.day, [...(byDay.get(stop.day) ?? []), [stop.lat, stop.lon]]);
              }
              return (
                <div key={`${section.id}-${index}`} className="document-map">
                  <MapContainer center={center} zoom={8} className="document-map-canvas" scrollWheelZoom={false} zoomControl={false}>
                    <ZoomControl position="bottomright" />
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                      attribution='&copy; OpenStreetMap &copy; CARTO'
                    />
                    {[...byDay.entries()].map(([day, points]) => (
                      <Polyline
                        key={day}
                        positions={points}
                        pathOptions={{ color: day === 1 ? uiTokens.color.accent : day === 2 ? uiTokens.color.success : uiTokens.color.warning, weight: 3 }}
                      />
                    ))}
                    {block.stops.map((stop, stopIndex) => {
                      const icon = L.divIcon({
                        className: `itinerary-pin itinerary-pin-day-${stop.day}`,
                        html: `<span>${stopIndex + 1}</span>`,
                        iconSize: [26, 26],
                        iconAnchor: [13, 13],
                        tooltipAnchor: [0, -16],
                      });
                      return (
                        <Marker key={`${stop.entityId}-${stopIndex}`} position={[stop.lat, stop.lon]} icon={icon}>
                          <Tooltip direction="top" opacity={0.95} permanent={false} sticky={false}>{stopIndex + 1}. {stop.label}</Tooltip>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                </div>
              );
            }
            return <p key={`${section.id}-${index}`} className="muted">{block.title}: {block.entityIds.join(", ")}</p>;
            })}
          </section>
        ))}
      </div>

      <aside className="document-provenance">
        <h2>Built From</h2>
        {deliverable.sources.map((source) => (
          <div key={source.source}>
            <strong>{source.source}</strong>
            <span>{source.reason}</span>
            <em>{source.records.slice(0, 6).join(", ")}{source.records.length > 6 ? "..." : ""}</em>
          </div>
        ))}
      </aside>
      <aside className="editor-assistant">
        <h2>Chatpil Editor</h2>
        <p>{copilotEndpoint ? "Ask for a focused rewrite of a section." : "Assistant needs the connection — manual editing still works."}</p>
        <textarea value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Tighten the subject line, make it more formal, cut it to 80 words..." />
        <button onClick={() => void requestSuggestion()}>Suggest Revision</button>
        <div className="suggestion-list">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="suggestion-card">
              <strong>{sections.find((section) => section.id === suggestion.sectionId)?.heading}</strong>
              <p>{suggestion.text}</p>
              {suggestion.warning ? <em>{suggestion.warning}</em> : <button onClick={() => applySuggestion(suggestion.id)}>Apply</button>}
              <button onClick={() => setSuggestions((items) => items.filter((item) => item.id !== suggestion.id))}>Discard</button>
            </div>
          ))}
        </div>
      </aside>
    </article>
    </div>
  );
}
