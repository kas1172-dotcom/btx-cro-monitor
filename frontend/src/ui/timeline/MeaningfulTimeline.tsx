import { useMemo, useState } from "react";
import type { EvidencePackage } from "../../app/evidence.ts";
import { navigateTo } from "../../app/router.ts";
import type { MeaningfulTimelineEvent } from "../../app/timeline.ts";

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function categoryLabel(value: MeaningfulTimelineEvent["category"]): string {
  return value.replace(/_/g, " ");
}

export function MeaningfulTimeline({
  events,
  title = "Meaningful change timeline",
  onEvidence,
  evidenceById,
}: {
  events: MeaningfulTimelineEvent[];
  title?: string;
  onEvidence?: (evidence: EvidencePackage) => void;
  evidenceById?: (event: MeaningfulTimelineEvent) => EvidencePackage | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const majorEvents = useMemo(() => events.filter((event) => event.importance !== "supporting"), [events]);
  const supporting = useMemo(() => events.filter((event) => event.importance === "supporting"), [events]);
  const visible = expanded ? events : majorEvents.slice(0, 8);

  return (
    <section className="surface-panel meaningful-timeline" aria-labelledby="meaningful-timeline-title">
      <div className="panel-head">
        <div>
          <h2 id="meaningful-timeline-title">{title}</h2>
          <span>{events.length} business event{events.length === 1 ? "" : "s"}</span>
        </div>
        {supporting.length > 0 && (
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide supporting events" : `Show ${supporting.length} supporting events`}
          </button>
        )}
      </div>
      <ol className="timeline-list">
        {visible.map((event) => {
          const evidence = evidenceById?.(event) ?? null;
          return (
            <li key={event.id} className={`timeline-event ${event.category} ${event.importance}`}>
              <div className="timeline-marker" aria-hidden="true" />
              <article tabIndex={0} title={new Date(event.occurredAt).toISOString()}>
                <div className="timeline-event-head">
                  <span>{categoryLabel(event.category)}</span>
                  <time dateTime={event.occurredAt}>{displayDate(event.occurredAt)}</time>
                </div>
                <strong>{event.title}</strong>
                {event.summary && <p>{event.summary}</p>}
                <div className="timeline-event-meta">
                  {event.actorLabel && <span>{event.actorLabel}</span>}
                  <span>{event.sourceRecordType}</span>
                  {event.dataClassification && <span>{event.dataClassification}</span>}
                </div>
                <div className="timeline-event-actions">
                  {event.route && <button type="button" onClick={() => navigateTo(String(event.route))}>Open record</button>}
                  {evidence && onEvidence && <button type="button" onClick={() => onEvidence(evidence)}>View evidence</button>}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
      {!visible.length && <p className="rail-quiet-empty">No meaningful changes are available for this record yet.</p>}
    </section>
  );
}
