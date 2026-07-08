import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl } from "react-leaflet";
import type { Deliverable, DeliverableSection } from "../../deliverables/types.ts";
import type { World } from "../../app/useWorld.ts";
import { deliverableToMarkdown } from "../../deliverables/markdown.ts";
import { closeDeliverable, openDemoAction, setState } from "../../store/store.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { downloadBoardDeck } from "../../deliverables/deck/pptx.ts";
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

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const copilotEndpoint = env?.VITE_COPILOT_ENDPOINT ?? processEnv?.VITE_COPILOT_ENDPOINT;

function editableSections(sections: DeliverableSection[]): DeliverableSection[] {
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => ({ ...block })),
  }));
}

export function DocumentViewer({ deliverable, world }: { deliverable: Deliverable; world?: World }) {
  const [sections, setSections] = useState(() => editableSections(deliverable.sections));
  const [title, setTitle] = useState(deliverable.title);
  const [dirty, setDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ id: string; sectionId: string; text: string; warning?: string }>>([]);
  const current = useMemo(() => ({ ...deliverable, title, sections }), [deliverable, sections, title]);
  const markdown = useMemo(() => deliverableToMarkdown(current), [current]);

  useEffect(() => {
    setSections(editableSections(deliverable.sections));
    setTitle(deliverable.title);
    setDirty(false);
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
      if (choice) saveCurrent();
    }
    closeDeliverable();
  }

  function saveCurrent() {
    const saved: Deliverable = {
      ...current,
      sources: [
        ...current.sources.filter((source) => source.source !== "user edits"),
        { source: "user edits", records: [current.id], reason: `Edited by user, ${new Date().toISOString()}` },
      ],
    };
    saveDeliverable(saved);
    setState({ activeDeliverable: saved });
    setDirty(false);
  }

  function copyMarkdown() {
    void navigator.clipboard?.writeText(markdown);
  }

  async function download(format: DownloadFormat) {
    setMenuOpen(false);
    if (format === "markdown") downloadMarkdown(current);
    if (format === "docx") await downloadDocx(current);
    if (format === "pdf") printDeliverable(current);
    if (format === "pptx" && world) await downloadBoardDeck(current, world);
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
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          system: "Revise one deliverable section. Preserve facts and numbers. Respect audience/form rules and banned vocabulary. Return only revised prose.",
          messages: [{ role: "user", content: JSON.stringify({ title: current.title, audience: current.audience, form: current.form, section: target, instruction }) }],
        }),
      });
      const data = (await res.json()) as { text?: string };
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, text: data.text ?? firstText.text }]);
    } catch {
      setSuggestions((items) => [...items, { id: `${Date.now()}`, sectionId: target.id, text: firstText.text, warning: "Assistant needs the connection — manual editing still works." }]);
    } finally {
      setAssistantInput("");
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

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true">
    <article className="document-viewer editor-window">
      <header className="document-head">
        <div>
          <p className="eyebrow">Deliverable</p>
          <input className="document-title-input" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} />
          <span title={deliverable.confidenceReason}>{deliverable.audience ?? "Internal"} · {(deliverable.form ?? deliverable.type).replace(/_/g, " ")} · {deliverable.confidence} confidence{dirty ? " · edited" : ""}</span>
        </div>
        <div className="document-actions">
          <button onClick={closeEditor} aria-label="Close editor">×</button>
          <button onClick={saveCurrent}>Save to Library</button>
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
          <button onClick={() => openDemoAction({ title: "Create CRM task", action: "crm_task", evidence: deliverable.title })}>Create task</button>
        </div>
      </header>

      <div className="editor-document">
        {sections.map((section) => (
          <section key={section.id} className="document-section">
            <h2>{section.heading}</h2>
            {section.blocks.map((block, index) => {
            if (block.kind === "text") {
              return (
                <p key={`${section.id}-${index}`} className="document-text-block">{block.text}</p>
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
            if (block.kind === "chart-spec") return <pre key={`${section.id}-${index}`}>{JSON.stringify(block.spec, null, 2)}</pre>;
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
                    {[...byDay.entries()].map(([day, points]) => <Polyline key={day} positions={points} pathOptions={{ color: day === 1 ? "#b7c46a" : day === 2 ? "#7fc7a6" : "#d3a95f", weight: 3 }} />)}
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
