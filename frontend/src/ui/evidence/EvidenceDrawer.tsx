import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { navigateTo } from "../../app/router.ts";
import type { EvidencePackage } from "../../app/evidence.ts";

function dateText(value: string | null): string {
  return value ?? "Not provided";
}

function conclusionLabel(value: EvidencePackage["conclusion"]): string {
  if (value === "confirmed") return "Confirmed";
  if (value === "supported") return "Supported by internal records";
  if (value === "derived") return "Derived from current scoring model";
  if (value === "inferred") return "Inference";
  return "More evidence needed";
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea, input, select, details, [tabindex]:not([tabindex='-1'])"));
}

export function EvidenceDrawer({
  evidence,
  onClose,
  triggerRef,
}: {
  evidence: EvidencePackage | null;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const records = evidence?.records ?? [];
  const positive = evidence?.scoreContribution?.positiveFactors ?? [];
  const negative = evidence?.scoreContribution?.negativeFactors ?? [];
  const missing = evidence?.scoreContribution?.missingInputs ?? [];
  const classification = useMemo(() => {
    if (!evidence) return "Internal records";
    if (records.some((record) => /demo|simulated/i.test(record.classification))) return "Demonstration data";
    if (records.some((record) => /public/i.test(record.classification))) return "Public and internal records";
    return "Internal records";
  }, [evidence, records]);

  useEffect(() => {
    if (!evidence) return;
    lastActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const first = panelRef.current ? focusableElements(panelRef.current)[0] : null;
      first?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [evidence]);

  useEffect(() => {
    if (!evidence) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        const target = triggerRef?.current ?? lastActiveRef.current;
        window.setTimeout(() => target?.focus(), 0);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = focusableElements(panelRef.current);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [evidence, onClose, triggerRef]);

  if (!evidence) return null;

  function closeAndRestore() {
    onClose();
    const target = triggerRef?.current ?? lastActiveRef.current;
    window.setTimeout(() => target?.focus(), 0);
  }

  return (
    <div className="evidence-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAndRestore(); }}>
      <aside
        ref={panelRef}
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
      >
        <header className="evidence-drawer-head">
          <div>
            <span>{classification}</span>
            <h2 id="evidence-drawer-title">{evidence.title}</h2>
            <p>{conclusionLabel(evidence.conclusion)}</p>
          </div>
          <button type="button" className="evidence-close" onClick={closeAndRestore} aria-label="Close evidence drawer">Close</button>
        </header>

        <section className="evidence-section">
          <h3>Summary</h3>
          <p>{evidence.summary}</p>
          <div className="evidence-status-grid">
            <span><strong>Conclusion</strong>{conclusionLabel(evidence.conclusion)}</span>
            <span><strong>Limitation</strong>{evidence.limitation}</span>
            {evidence.relationshipStatus && <span><strong>Relationship</strong>{evidence.relationshipStatus}</span>}
          </div>
        </section>

        <section className="evidence-section">
          <h3>Supporting records</h3>
          {records.length ? records.map((record) => (
            <article key={record.id} className="evidence-record">
              <div>
                <strong>{record.title}</strong>
                <span>{record.publisher} · {record.classification}</span>
              </div>
              <dl>
                <div><dt>Published</dt><dd>{dateText(record.publicationDate)}</dd></div>
                <div><dt>Event date</dt><dd>{dateText(record.eventDate)}</dd></div>
                <div><dt>Updated</dt><dd>{dateText(record.updatedAt)}</dd></div>
              </dl>
              <p>{record.summary}</p>
              <div className="evidence-record-actions">
                {record.route && <button type="button" onClick={() => navigateTo(String(record.route))}>Open record</button>}
                {record.externalUrl && <a href={record.externalUrl} target="_blank" rel="noreferrer">Full source</a>}
              </div>
            </article>
          )) : <p className="rail-quiet-empty">No accessible supporting records are attached.</p>}
        </section>

        {evidence.scoreContribution && (
          <section className="evidence-section">
            <h3>Score contribution</h3>
            <div className="evidence-status-grid">
              <span><strong>Family</strong>{evidence.scoreContribution.family}</span>
              <span><strong>Value</strong>{evidence.scoreContribution.value}</span>
              <span><strong>Status</strong>{evidence.scoreContribution.status}</span>
              <span><strong>Calculated</strong>{dateText(evidence.scoreContribution.calculatedAt)}</span>
            </div>
            {positive.length > 0 && <p><strong>Positive factors:</strong> {positive.join(" ")}</p>}
            {negative.length > 0 && <p><strong>Negative factors:</strong> {negative.join(" ")}</p>}
            {missing.length > 0 && <p><strong>Missing inputs:</strong> {missing.join("; ")}</p>}
            <p className="muted">{evidence.scoreContribution.limitation}</p>
          </section>
        )}

        <section className="evidence-section">
          <h3>Contradictions and uncertainty</h3>
          {evidence.contradictions.length
            ? <ul>{evidence.contradictions.map((item) => <li key={item}>{item}</li>)}</ul>
            : <p>No conflicting evidence is attached to this record.</p>}
        </section>

        <details className="evidence-advanced">
          <summary>Advanced details</summary>
          {evidence.advanced.map((item) => (
            <p key={`${item.label}-${item.value}`}><strong>{item.label}</strong> {item.value}</p>
          ))}
        </details>

        <footer className="evidence-drawer-actions">
          <button type="button" onClick={() => navigateTo(`/ask?prompt=${encodeURIComponent(evidence.askPrompt)}`)}>Ask about this evidence</button>
          <button type="button" onClick={closeAndRestore}>Done</button>
        </footer>
      </aside>
    </div>
  );
}
