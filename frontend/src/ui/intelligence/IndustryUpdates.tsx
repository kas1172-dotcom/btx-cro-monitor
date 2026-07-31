import { useEffect, useMemo, useState } from "react";
import {
  BACKEND_ENDPOINT,
  createIndustryWorkItem,
  getIndustryMonitor,
  reviewIndustryUpdate,
  type IndustryMonitorResponse,
  type IndustryUpdateRecord,
} from "../../app/backendApi.ts";
import type { World } from "../../app/useWorld.ts";
import { navigateTo } from "../../app/router.ts";
import { signalHeadline, signalSourceName } from "../../app/signalProvenance.ts";
import { displayLabel } from "../../app/displayLabels.ts";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { EmptyState, SurfaceHeader } from "../primitives.tsx";

type Filter = "new_high" | "new" | "needs_review" | "customers" | "prospects" | "programs" | "all";

function dateTime(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ageLabel(value: string | null | undefined): string {
  if (!value) return "never";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "unknown";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function explicitDateLabel(label: string, value: string | null | undefined): string {
  return `${label}: ${dateTime(value)}`;
}

function wordBoundary(text: string, max = 220): string {
  if (text.length <= max) return text;
  const trimmed = text.slice(0, max + 1);
  const boundary = trimmed.lastIndexOf(" ");
  return `${trimmed.slice(0, boundary > 80 ? boundary : max).trim()}…`;
}

function uniqueReasons(summary: string, reasons: string[]): string[] {
  const normalizedSummary = summary.trim().toLowerCase();
  return reasons.filter((reason, index, list) => {
    const normalized = reason.trim().toLowerCase();
    return normalized && normalized !== normalizedSummary && list.findIndex((item) => item.trim().toLowerCase() === normalized) === index;
  });
}

function storedFallback(world: World): IndustryMonitorResponse {
  const updates: IndustryUpdateRecord[] = world.analysis.valid
    .filter((signal) => signal.artifact)
    .map((signal) => ({
      id: signal.id,
      canonicalUrl: signal.source_url ?? signal.document_url ?? "",
      sourceId: signalSourceName(signal),
      publisher: signalSourceName(signal),
      headline: signalHeadline(signal),
      normalizedSummary: signal.source_quote,
      eventDate: signal.detected_at,
      publicationDate: signal.artifact?.source_date ?? signal.detected_at,
      retrievedAt: signal.artifact?.run_at ?? signal.detected_at,
      contentFingerprint: signal.id,
      entities: (signal.entities ?? []).map((name) => ({ name, type: "named_entity" })),
      programs: [],
      markets: [signal.event_type.replace(/_/g, " ")],
      capabilityTags: [],
      relationshipState: signal.scope === "specific_account" ? "confirmed_account_development" : signal.scope === "unlinked" ? "candidate_account_match" : "market_only",
      evidenceClass: "public_source",
      relevanceScore: signal.artifact?.relevance_score ?? Math.round(signal.confidence * 100),
      relevanceReasons: [signal.artifact?.analysis_text ?? "Stored monitor analysis matched the configured BTX relevance rubric."],
      reviewStatus: "new",
      runId: signal.artifact?.run_at ?? "stored-snapshot",
      sourceVariants: [],
    }));
  const retrieved = updates.map((update) => update.retrievedAt).sort().at(-1) ?? null;
  return {
    state: updates.length ? "stale" : "never_run",
    ingestionMode: updates.length ? "stored_snapshot" : "failed",
    status: updates.length ? "Backend unavailable; showing a stored snapshot" : "Monitor has not run",
    run: updates.length ? {
      id: updates[0]?.runId ?? "stored-snapshot",
      startedAt: retrieved,
      completedAt: retrieved,
      durationMs: null,
      version: "artifact snapshot",
      lastAttemptAt: retrieved,
      lastSuccessfulAt: retrieved,
      expectedNextRun: null,
      latestRetrievedAt: retrieved,
      counts: {
        sourcesChecked: new Set(updates.map((update) => update.sourceId)).size,
        newRecords: 0,
        unchangedRecords: updates.length,
        duplicatesRejected: 0,
        irrelevantRecordsRejected: 0,
        failedSources: 0,
      },
    } : null,
    sources: [],
    updates,
  };
}

function matchesFilter(update: IndustryUpdateRecord, filter: Filter): boolean {
  if (filter === "all") return update.reviewStatus !== "dismissed";
  if (filter === "new") return update.reviewStatus === "new";
  if (filter === "needs_review") return update.reviewStatus === "needs_account_match" || update.relationshipState === "candidate_account_match";
  if (filter === "customers") return update.relationshipState === "confirmed_account_development";
  if (filter === "prospects") return update.relationshipState === "candidate_account_match";
  if (filter === "programs") return update.programs.length > 0 || update.markets.some((market) => market.toLowerCase().includes("program"));
  const retrieved = new Date(update.retrievedAt).getTime();
  return update.reviewStatus === "new" && update.relevanceScore >= 60 && retrieved >= Date.now() - 7 * 86_400_000;
}

export function IndustryUpdates({ world }: { world: World }) {
  const [monitor, setMonitor] = useState<IndustryMonitorResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("new_high");
  const [runOpen, setRunOpen] = useState(false);
  const [status, setStatus] = useState("Preparing collection evidence.");
  const [undoReview, setUndoReview] = useState<{ id: string; previous: IndustryUpdateRecord["reviewStatus"]; label: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!BACKEND_ENDPOINT) {
      const fallback = storedFallback(world);
      setMonitor(fallback);
      setStatus(fallback.updates.length ? "Stored snapshot mode. No backend collection request was made." : "No backend run or stored monitor records are available.");
      return () => { active = false; };
    }
    void getIndustryMonitor()
      .then((response) => {
        if (!active) return;
        setMonitor(response);
        setStatus(response.status);
      })
      .catch(() => {
        if (!active) return;
        const fallback = storedFallback(world);
        setMonitor(fallback);
        setStatus(fallback.updates.length ? "The live monitor status could not be loaded. Showing stored records only." : "The live monitor status could not be loaded, and no stored records are available.");
      });
    return () => { active = false; };
  }, [world]);

  const visible = useMemo(
    () => (monitor?.updates ?? []).filter((update) => matchesFilter(update, filter)).slice(0, 50),
    [filter, monitor],
  );

  async function review(update: IndustryUpdateRecord, action: "mark_reviewed" | "dismiss" | "needs_account_match") {
    const busyKey = `${update.id}:${action}`;
    if (busyAction) return;
    if (!BACKEND_ENDPOINT) {
      setStatus("Review changes require the backend; the stored snapshot was not modified.");
      return;
    }
    const reason = action === "dismiss" ? window.prompt("Why is this update not relevant?")?.trim() : undefined;
    if (action === "dismiss" && !reason) return;
    setBusyAction(busyKey);
    setStatus("Saving review…");
    try {
      const result = await reviewIndustryUpdate(update.id, action, reason);
      const previous = update.reviewStatus;
      setMonitor((current) => current ? {
        ...current,
        updates: current.updates.map((item) => item.id === update.id ? { ...item, reviewStatus: result.reviewStatus } : item),
      } : current);
      setUndoReview({ id: update.id, previous, label: `Undo ${action === "dismiss" ? "dismiss" : action === "mark_reviewed" ? "review" : "queue change"}` });
      setStatus(action === "needs_account_match" ? "Queued for account-evidence assessment. Undo will restore the prior backend review status." : "Review saved. Undo will restore the prior backend review status.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setBusyAction(null);
    }
  }

  async function undoLastReview() {
    if (!undoReview) return;
    if (busyAction) return;
    if (!BACKEND_ENDPOINT) {
      setMonitor((current) => current ? {
        ...current,
        updates: current.updates.map((item) => item.id === undoReview.id ? { ...item, reviewStatus: undoReview.previous } : item),
      } : current);
      setStatus("Review change undone in the stored snapshot view. No backend record was modified.");
      setUndoReview(null);
      return;
    }
    setBusyAction("undo-review");
    setStatus("Restoring previous review status…");
    try {
      const result = await reviewIndustryUpdate(undoReview.id, "restore_previous");
      setMonitor((current) => current ? {
        ...current,
        updates: current.updates.map((item) => item.id === undoReview.id ? { ...item, reviewStatus: result.reviewStatus } : item),
      } : current);
      setStatus("Previous review status restored.");
      setUndoReview(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The review change could not be restored.");
    } finally {
      setBusyAction(null);
    }
  }

  async function draftWork(update: IndustryUpdateRecord) {
    const busyKey = `${update.id}:draft`;
    if (busyAction) return;
    if (!BACKEND_ENDPOINT) {
      setStatus("Work-item drafting requires the backend; no external action occurred.");
      return;
    }
    setBusyAction(busyKey);
    setStatus("Creating an internal work-item draft…");
    try {
      const item = await createIndustryWorkItem(update.id);
      setStatus("Internal draft created. No CRM action occurred.");
      navigateTo(`/work/${encodeURIComponent(item.id)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The work-item draft could not be created.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="surface-page industry-updates-page" data-surface-component="surface-industry-updates">
      <SurfaceHeader
        eyebrow="Intelligence · Industry updates"
        headline="External developments worth Jamie’s attention"
        subline="Public-source context ranked by visible BTX relevance factors. Market updates do not alter account scores or create opportunities."
      />

      <div className={`monitor-proof monitor-proof-${monitor?.state ?? "running"}`} role="status" aria-live="polite">
        <div>
          <span>Industry monitor</span>
          <strong>{monitor?.status ?? "Preparing monitor status"}</strong>
          <em>{monitor?.run ? `${explicitDateLabel("Last successful run", monitor.run.lastSuccessfulAt)} · ${ageLabel(monitor.run.lastSuccessfulAt)}` : "No successful run is available"}</em>
        </div>
        {monitor?.run && (
          <>
            <dl>
              <div><dt>Sources checked</dt><dd>{monitor.run.counts.sourcesChecked}</dd></div>
              <div><dt>New</dt><dd>{monitor.run.counts.newRecords}</dd></div>
              <div><dt>Unchanged</dt><dd>{monitor.run.counts.unchangedRecords}</dd></div>
              <div><dt>Duplicates rejected</dt><dd>{monitor.run.counts.duplicatesRejected}</dd></div>
              <div><dt>Irrelevant rejected</dt><dd>{monitor.run.counts.irrelevantRecordsRejected}</dd></div>
              <div><dt>Failed sources</dt><dd>{monitor.run.counts.failedSources}</dd></div>
            </dl>
            <button type="button" onClick={() => setRunOpen((value) => !value)} aria-expanded={runOpen}>
              {runOpen ? "Hide run" : "View run"}
            </button>
          </>
        )}
      </div>
      <p className="industry-mode-label">
        <strong>{monitor?.ingestionMode.replace(/_/g, " ").toUpperCase() ?? "CHECKING MODE"}</strong>
        {" "}{status}
        {undoReview && <button type="button" disabled={Boolean(busyAction)} onClick={undoLastReview}>{busyAction === "undo-review" ? "Restoring..." : undoReview.label}</button>}
      </p>

      {runOpen && monitor?.run && (
        <section className="monitor-run-detail" aria-labelledby="monitor-run-title">
          <div>
            <p className="eyebrow">Collection diagnostics</p>
            <h2 id="monitor-run-title">Run {monitor.run.id}</h2>
            <p>Started {dateTime(monitor.run.startedAt)} · Completed {dateTime(monitor.run.completedAt)} · Version {monitor.run.version}</p>
            <p>Latest retrieved record: {dateTime(monitor.run.latestRetrievedAt)}</p>
          </div>
          <div className="monitor-source-list">
            {monitor.sources.map((source) => (
              <article key={source.id}>
                <strong>{source.name}</strong>
                <span>{source.domain || "Domain unavailable"} · {source.sourceType.replace(/_/g, " ")}</span>
                <em>{source.health} · {source.recordsDiscovered} discovered · {source.parsingFailures} parsing failures</em>
                {source.sanitizedError && <p>{source.sanitizedError}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="industry-filter-bar" aria-label="Industry update filters">
        {([
          ["new_high", "New & high relevance · 7 days"],
          ["new", `New since ${monitor?.run ? dateTime(monitor.run.lastSuccessfulAt) : "last run"}`],
          ["needs_review", "Needs review"],
          ["customers", "Customers"],
          ["prospects", "Prospects"],
          ["programs", "Programs"],
          ["all", "All"],
        ] as Array<[Filter, string]>).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div className="industry-feed" role="feed" aria-busy={!monitor}>
        {visible.map((update) => (
          <article key={update.id} className="industry-update-card" aria-labelledby={`industry-${update.id}`}>
            <header>
              <div>
                <p className="eyebrow">{update.publisher}</p>
                <h2 id={`industry-${update.id}`}>{update.headline}</h2>
                <p>{explicitDateLabel("Record retrieved", update.retrievedAt)} · {explicitDateLabel("Published", update.publicationDate)} · {explicitDateLabel("Event date", update.eventDate)}</p>
              </div>
              <div className="industry-classifications">
                <span>{displayLabel(update.relationshipState)}</span>
                <span>Public source</span>
                <span>{displayLabel(update.reviewStatus)}</span>
              </div>
            </header>
            <p>{wordBoundary(update.normalizedSummary)}</p>
            <dl className="industry-context">
              <div><dt>Market / program / company</dt><dd>{[...update.entities.map((entity) => entity.name), ...update.markets].slice(0, 4).join(" · ") || "Market context"}</dd></div>
              <div><dt>BTX capability relevance</dt><dd>{update.capabilityTags.join(" · ") || "Capability match requires review"}</dd></div>
            </dl>
            <div className="industry-hypothesis">
              <strong>Why this appears</strong>
              {uniqueReasons(update.normalizedSummary, update.relevanceReasons).map((reason) => <p key={reason}>{wordBoundary(reason, 180)}</p>)}
              {uniqueReasons(update.normalizedSummary, update.relevanceReasons).length === 0 && <p>Matched configured monitor relevance rules; no additional non-duplicate summary was provided.</p>}
              {update.relationshipState !== "confirmed_account_development" && <em>Relevance is a hypothesis. No BTX opportunity or account impact has been confirmed.</em>}
            </div>
            {update.sourceVariants.length > 0 && <p className="muted">{update.sourceVariants.length} syndicated source variant{update.sourceVariants.length === 1 ? "" : "s"} grouped with this story.</p>}
            <div className="industry-actions">
              <ExternalLink href={update.canonicalUrl} label={`Review evidence at the original source for ${update.headline}`} />
              <button type="button" disabled={Boolean(busyAction)} onClick={() => void review(update, "mark_reviewed")}>{busyAction === `${update.id}:mark_reviewed` ? "Saving..." : "Mark reviewed"}</button>
              <button type="button" disabled={Boolean(busyAction)} onClick={() => void review(update, "needs_account_match")}>{busyAction === `${update.id}:needs_account_match` ? "Queueing..." : "Assess account relevance"}</button>
              <button type="button" disabled={Boolean(busyAction)} onClick={() => void draftWork(update)}>{busyAction === `${update.id}:draft` ? "Creating..." : "Create work-item draft"}</button>
              <button type="button" disabled={Boolean(busyAction)} onClick={() => void review(update, "dismiss")}>{busyAction === `${update.id}:dismiss` ? "Dismissing..." : "Dismiss"}</button>
            </div>
          </article>
        ))}
        {monitor && visible.length === 0 && (
          <EmptyState
            headline={monitor.state === "never_run" ? "Monitor has not run" : "No relevant updates found"}
            body={filter === "new_high" ? "No new high-relevance public updates were retrieved in the last seven days. Try All to inspect the stored feed." : "Try another filter or inspect the collection run."}
            icon="signal"
          />
        )}
      </div>
    </section>
  );
}
