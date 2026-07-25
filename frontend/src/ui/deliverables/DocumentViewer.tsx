import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Tooltip, ZoomControl } from "react-leaflet";
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
import { deliverableMetaLabel, visibleSources } from "../../app/sourceLabels.ts";
import { evidenceFromDeliverableSource, type EvidencePackage } from "../../app/evidence.ts";
import { navigateTo, useAppRoute } from "../../app/router.ts";
import { AnalysisFigure } from "../analysis/ChartFigure.tsx";
import { DarkMapTiles } from "../map/DarkMapTiles.tsx";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer.tsx";
import { DeliverableBriefingMode } from "../modes/BriefingMode.tsx";
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

interface Suggestion {
  id: string;
  sectionId: string;
  originalText: string;
  text: string;
  warning?: string;
}

interface VersionEntry {
  id: string;
  label: string;
  sections: DeliverableSection[];
}

function isChartSpec(value: unknown): value is ChartSpec {
  return Boolean(value) && typeof value === "object" && typeof (value as { metric?: unknown }).metric === "string" && typeof (value as { viz?: unknown }).viz === "string";
}

function editableSections(sections: DeliverableSection[]): DeliverableSection[] {
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => ({ ...block })),
  }));
}

function textFromSections(sections: DeliverableSection[]): string {
  return sections.flatMap((section) => section.blocks).filter((block) => block.kind === "text").map((block) => block.text).join(" ");
}

function factTokens(text: string): string[] {
  const numbers = [...text.matchAll(/\$?\b\d+(?:[.,]\d+)*(?:%|\s?(?:days?|weeks?|months?|years?|hours?|hrs?|units?|parts?|quotes?|opportunities?|deals?))?\b/gi)]
    .map((match) => match[0].replace(/[,$%]/g, "").replace(/\s+/g, " ").trim().toLowerCase());
  const dates = [...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s+\d{4})?|\b\d{4}-\d{2}-\d{2}\b/gi)].map((match) => match[0]);
  return [...new Set([...numbers, ...dates])];
}

function bannedHits(text: string): string[] {
  return EDITOR_BANNED_VOCABULARY.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function DocumentViewer({ deliverable, world, openedFrom = "generation" }: { deliverable: Deliverable; world?: World; openedFrom?: "generation" | "library" }) {
  const route = useAppRoute();
  const [sections, setSections] = useState(() => editableSections(deliverable.sections));
  const [title, setTitle] = useState(deliverable.title);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [versions, setVersions] = useState<VersionEntry[]>(() => [{ id: `${Date.now()}`, label: "v1 original", sections: editableSections(deliverable.sections) }]);
  const [taskDialog, setTaskDialog] = useState<TaskDialog | null>(null);
  const [evidence, setEvidence] = useState<EvidencePackage | null>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const current = useMemo(() => ({ ...deliverable, title, sections }), [deliverable, sections, title]);
  const markdown = useMemo(() => deliverableToMarkdown(current), [current]);
  const viewMode = route.query.get("view");
  const isFocus = viewMode === "focus";
  const isBriefing = viewMode === "briefing";

  useEffect(() => {
    setSections(editableSections(deliverable.sections));
    setTitle(deliverable.title);
    setDirty(false);
    setSaveStatus("");
    setSuggestions([]);
    setVersions([{ id: `${Date.now()}`, label: "v1 original", sections: editableSections(deliverable.sections) }]);
    setMenuOpen(false);
  }, [deliverable.id, deliverable.sections]);

  function rememberVersion(label: string, nextSections: DeliverableSection[]) {
    setVersions((items) => [...items, { id: `${Date.now()}-${items.length + 1}`, label: `v${items.length + 1} ${label}`, sections: editableSections(nextSections) }].slice(-20));
  }

  function updateText(sectionId: string, blockIndex: number, text: string) {
    setSections((items) => {
      const next = items.map((section) => section.id === sectionId
        ? {
            ...section,
            blocks: section.blocks.map((block, index) => index === blockIndex && block.kind === "text" ? { ...block, text } : block),
          }
        : section);
      rememberVersion("manual edit", next);
      return next;
    });
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

  function revisionWarning(text: string): string | undefined {
    const currentSourceText = [deliverable.title, textFromSections(deliverable.sections), deliverable.sources.map((source) => `${source.source} ${source.reason} ${source.records.join(" ")}`).join(" ")].join(" ");
    const allowed = new Set(factTokens(currentSourceText).map((token) => token.toLowerCase()));
    const unsupported = factTokens(text).filter((token) => !allowed.has(token.toLowerCase()));
    if (unsupported.length > 0) return `Unsupported claim: ${unsupported.slice(0, 4).join(", ")}`;
    const banned = bannedHits(text);
    if (banned.length > 0) return `Banned terms: ${banned.join(", ")}`;
    if (text.includes("\u2014")) return "No em dashes are allowed.";
    return undefined;
  }

  async function requestSuggestion(instructionOverride?: string) {
    const instruction = (instructionOverride ?? assistantInput).trim();
    if (!instruction) return;
    const target = sections.find((section) => instruction.toLowerCase().includes(section.heading.toLowerCase())) ?? sections.find((section) => section.blocks.some((block) => block.kind === "text"));
    if (!target) return;
    const firstText = target.blocks.find((block) => block.kind === "text");
    if (!firstText || firstText.kind !== "text") return;
    const endpoint = copilotEndpoint;
    if (!endpoint) {
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, originalText: firstText.text, text: firstText.text, warning: "Assistant needs the connection, manual editing still works." }]);
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
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, originalText: firstText.text, text, warning: revisionWarning(text) }]);
    } catch (error) {
      setSuggestions((items) => [...items, {
        id: `${Date.now()}`,
        sectionId: target.id,
        originalText: firstText.text,
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

  function pathWithView(nextView: string | null): string {
    const params = new URLSearchParams(route.query);
    if (nextView) params.set("view", nextView);
    else params.delete("view");
    const query = params.toString();
    return `${route.path}${query ? `?${query}` : ""}`;
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
    setSections((items) => {
      const next = items.map((section) => section.id === suggestion.sectionId
        ? { ...section, blocks: section.blocks.map((block, index) => index === 0 && block.kind === "text" ? { ...block, text: suggestion.text } : block) }
        : section);
      rememberVersion("AI edit accepted", next);
      return next;
    });
    setSuggestions((items) => items.filter((item) => item.id !== id));
    setDirty(true);
  }

  const formats = DELIVERABLE_DOWNLOAD_FORMATS[deliverable.type];
  const visibleBuiltFrom = visibleSources(deliverable.sources);
  const lockedTokens = factTokens([deliverable.title, textFromSections(deliverable.sections)].join(" "));
  const currentText = textFromSections(sections);
  const missingLockedTokens = lockedTokens.filter((token) => !currentText.includes(token));
  const checklist = [
    { label: "Sources attached", ok: deliverable.sources.length > 0 },
    { label: "No banned terms", ok: bannedHits(currentText).length === 0 },
    { label: "No em dashes", ok: !currentText.includes("\u2014") },
    { label: "Locked facts unchanged", ok: missingLockedTokens.length === 0 },
    { label: "Confidence matches evidence", ok: !(deliverable.confidence === "high" && /needs qualification|missing/i.test(deliverable.confidenceReason ?? "")) },
  ];
  const sendBlocked = checklist.some((item) => !item.ok) || suggestions.some((item) => Boolean(item.warning));

  if (isBriefing) {
    return (
      <div className="editor-overlay briefing-overlay" role="dialog" aria-modal="true">
        <DeliverableBriefingMode deliverable={current} onExit={() => navigateTo(pathWithView(null))} />
      </div>
    );
  }

  return (
    <div className={isFocus ? "editor-overlay record-focus-mode" : "editor-overlay"} role="dialog" aria-modal="true">
    <article className="document-viewer editor-window">
      <header className="document-head">
        <div>
          <p className="eyebrow">Deliverable</p>
          <input className="document-title-input" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
          <span title={deliverable.confidenceReason}>{deliverableMetaLabel(deliverable)}{dirty ? " - edited" : ""}</span>
          <span className={deliverable.compositionPath?.startsWith("Composed: LLM") ? "composition-status live" : "composition-status"}>
            {deliverable.compositionPath ?? "Template fallback (LLM unavailable: composition status unavailable)"}
          </span>
          {saveStatus && <span className="document-save-status">{saveStatus}</span>}
        </div>
        <div className="document-actions">
          <button onClick={closeEditor} aria-label={openedFrom === "library" ? "Back to library" : "Close editor"}>{openedFrom === "library" ? "Back" : "×"}</button>
          <button onClick={() => void saveCurrent()}>Save to Library</button>
          <button onClick={copyMarkdown}>Copy</button>
          <button onClick={() => navigateTo(pathWithView(isFocus ? null : "focus"))}>{isFocus ? "Exit focus" : "Focus mode"}</button>
          <button onClick={() => navigateTo(pathWithView("briefing"))}>Briefing mode</button>
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
          <button
            onClick={() => openDemoAction({ title: "Send via Outlook", action: "follow_up", evidence: "External writes require operator confirmation." })}
            disabled={sendBlocked}
            title={sendBlocked ? "Resolve the quality checklist before sending." : "Send requires confirmation."}
          >
            Send
          </button>
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
                    <DarkMapTiles />
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
        {visibleBuiltFrom.map((source, index) => (
          <div key={`${source.label}-${index}`}>
            <strong>{source.label}</strong>
            <span>{source.reason}</span>
            <em>{source.records}</em>
            <button
              ref={index === 0 ? evidenceTriggerRef : undefined}
              type="button"
              onClick={(event) => {
                evidenceTriggerRef.current = event.currentTarget;
                setEvidence(evidenceFromDeliverableSource(current, deliverable.sources[index]));
              }}
            >
              View evidence
            </button>
          </div>
        ))}
      </aside>
      <aside className="editor-assistant">
        <h2>Ask Editor</h2>
        <p>{copilotEndpoint ? "Ask for a focused rewrite of a section." : "Assistant needs the connection, manual editing still works."}</p>
        <div className="editor-quick-actions">
          {["Tighten", "More formal", "Shorten to 80 words", "Add evidence", "Soften claims", "Fix to sources"].map((action) => (
            <button key={action} type="button" onClick={() => void requestSuggestion(action)}>{action}</button>
          ))}
        </div>
        <textarea value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Tighten the subject line, make it more formal, cut it to 80 words..." />
        <button onClick={() => void requestSuggestion()}>Suggest Revision</button>
        <div className="quality-checklist">
          <strong>Quality checklist</strong>
          {checklist.map((item) => (
            <span key={item.label} className={item.ok ? "ok" : "blocked"}>{item.ok ? "Pass" : "Fix"}: {item.label}</span>
          ))}
          {missingLockedTokens.length > 0 && <em>Changed locked facts: {missingLockedTokens.slice(0, 5).join(", ")}</em>}
        </div>
        <div className="version-history">
          <strong>Version history</strong>
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => {
                setSections(editableSections(version.sections));
                setDirty(true);
              }}
            >
              {version.label}
            </button>
          ))}
        </div>
        <div className="suggestion-list">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="suggestion-card">
              <strong>{sections.find((section) => section.id === suggestion.sectionId)?.heading}</strong>
              <span>Current</span>
              <p>{suggestion.originalText}</p>
              <span>Proposed</span>
              <p>{suggestion.text}</p>
              {suggestion.warning ? <em>{suggestion.warning}</em> : <button onClick={() => applySuggestion(suggestion.id)}>Accept</button>}
              <button onClick={() => setSuggestions((items) => items.filter((item) => item.id !== suggestion.id))}>Discard</button>
            </div>
          ))}
        </div>
      </aside>
      <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} triggerRef={evidenceTriggerRef} />
    </article>
    </div>
  );
}
