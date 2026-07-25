import { useEffect, useMemo, useState } from "react";
import type { EvidencePackage } from "../../app/evidence.ts";
import { buildAccountEvidence, buildSignalEvidence } from "../../app/evidence.ts";
import { SCORE_FAMILY_LABELS, scoreInterpretation } from "../../app/presentation.ts";
import type { ScoreSnapshot } from "../../app/revenueDataClient.ts";
import { buildAccountTimeline } from "../../app/timeline.ts";
import type { World } from "../../app/useWorld.ts";
import type { Deliverable } from "../../deliverables/types.ts";
import type { Company } from "../../engine/brain/entities.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import { EmptyState } from "../primitives.tsx";

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function latestScore(world: World, accountId: string, family: keyof NonNullable<World["scoreResults"]>): ScoreSnapshot | null {
  return world.scoreResults?.[family]
    .filter((score) => score.entityType === "account" && score.entityId === accountId)
    .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0] ?? null;
}

function scoreText(score: ScoreSnapshot | null): string {
  if (!score || score.score === null || score.result.status === "insufficient_data") return "Unavailable";
  if (score.result.status === "provisional") return `${Math.round(score.score)} provisional`;
  if (score.result.status === "disqualified") return "Disqualified";
  return String(Math.round(score.score));
}

function sourceClass(world: World): string {
  return world.worldSnapshot?.tenant.isDemonstration ? "Demonstration workspace: internal records are illustrative." : "Workspace records reflect connected backend sources.";
}

const SECTIONS = [
  "Executive headline",
  "What changed",
  "Why it matters",
  "Decision readiness",
  "What is missing",
  "Recommended actions",
  "Supporting evidence",
];

export function AccountBriefingMode({
  world,
  company,
  signals,
  workItems,
  onExit,
  onEvidence,
}: {
  world: World;
  company: Company;
  signals: Signal[];
  workItems: NonNullable<World["worldSnapshot"]>["workItems"];
  onExit: () => void;
  onEvidence: (evidence: EvidencePackage) => void;
}) {
  const [index, setIndex] = useState(0);
  const timeline = useMemo(() => buildAccountTimeline(world, company.id), [world, company.id]);
  const accountScore = latestScore(world, company.id, "accountAttractiveness");
  const evidenceScore = latestScore(world, company.id, "signalConfidence");
  const pwinScore = latestScore(world, company.id, "pursuitPwin");
  const deliveryScore = latestScore(world, company.id, "deliveryFeasibility");
  const relationshipScore = latestScore(world, company.id, "relationshipHealth");
  const missing = [
    ...(accountScore?.result.missingInputs ?? []),
    ...(deliveryScore?.result.missingInputs ?? []),
    ...(relationshipScore?.result.missingInputs ?? []),
  ];
  const topSignal = signals[0];
  const currentWork = workItems.find((item) => !["closed", "dismissed"].includes(item.status)) ?? workItems[0];
  const section = SECTIONS[index];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(SECTIONS.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "Escape") onExit();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onExit]);

  return (
    <section className="briefing-mode account-briefing" aria-labelledby="briefing-title">
      <header className="briefing-head">
        <div>
          <p className="eyebrow">Briefing mode</p>
          <h1 id="briefing-title">{company.name}</h1>
          <span>{section} · {index + 1} of {SECTIONS.length}</span>
        </div>
        <div className="briefing-actions">
          <button type="button" onClick={() => window.print()}>Print</button>
          <button type="button" onClick={onExit}>Exit briefing</button>
        </div>
      </header>

      <article className="briefing-card">
        {section === "Executive headline" && (
          <>
            <h2>Recommendation</h2>
            <p>{company.name} deserves executive review because current records combine account context, evidence strength, open work, and score snapshots.</p>
            <dl>
              <div><dt>Status</dt><dd>{company.account_status?.replace(/_/g, " ") ?? company.relationship}</dd></div>
              <div><dt>Decision</dt><dd>{currentWork?.recommended_action ?? "Review account context"}</dd></div>
              <div><dt>Data freshness</dt><dd>{dateLabel(world.worldSnapshot?.generatedAt)}</dd></div>
            </dl>
          </>
        )}
        {section === "What changed" && (
          <>
            <h2>What changed</h2>
            {timeline.slice(0, 5).map((event) => (
              <p key={event.id}><strong>{event.title}</strong> {event.summary} <span>{dateLabel(event.occurredAt)}</span></p>
            ))}
            {!timeline.length && <EmptyState headline="No recent changes" body="No meaningful account events are available yet." icon="signal" />}
          </>
        )}
        {section === "Why it matters" && (
          <>
            <h2>Why it matters</h2>
            <p>{topSignal ? `${topSignal.source_quote}` : "No confirmed recent account development is attached yet."}</p>
            <p>BTX should treat unsupported values as unavailable and use the meeting to validate timing, customer access, capacity, pricing, and certification needs.</p>
          </>
        )}
        {section === "Decision readiness" && (
          <>
            <h2>Decision readiness</h2>
            <div className="briefing-score-grid">
              {[
                [SCORE_FAMILY_LABELS.accountAttractiveness, accountScore],
                [SCORE_FAMILY_LABELS.signalConfidence, evidenceScore],
                [SCORE_FAMILY_LABELS.pursuitPwin, pwinScore],
                [SCORE_FAMILY_LABELS.deliveryFeasibility, deliveryScore],
                [SCORE_FAMILY_LABELS.relationshipHealth, relationshipScore],
              ].map(([label, score]) => (
                <div key={String(label)}>
                  <span>{String(label)}</span>
                  <strong>{scoreText(score as ScoreSnapshot | null)}</strong>
                  <em>{scoreInterpretation(score as ScoreSnapshot | null, String(label))}</em>
                </div>
              ))}
            </div>
          </>
        )}
        {section === "What is missing" && (
          <>
            <h2>What is missing</h2>
            {missing.length
              ? <ul>{[...new Set(missing)].map((item) => <li key={item}>{item}</li>)}</ul>
              : <p>No major missing input surfaced, but customer access and production timing should still be confirmed.</p>}
          </>
        )}
        {section === "Recommended actions" && (
          <>
            <h2>Recommended actions</h2>
            {workItems.slice(0, 4).map((item) => (
              <p key={item.id}><strong>{item.recommended_action}</strong> Owner: {item.owner ?? "Unassigned"}. Due: {item.due_date ?? "not set"}. Approval: {item.approval_state.replace(/_/g, " ")}.</p>
            ))}
            {!workItems.length && <p>No account-specific work items are open.</p>}
          </>
        )}
        {section === "Supporting evidence" && (
          <>
            <h2>Supporting evidence</h2>
            <p>{sourceClass(world)}</p>
            <button type="button" onClick={() => onEvidence(buildAccountEvidence(world, company, accountScore, signals))}>View account evidence</button>
            {signals.slice(0, 4).map((signal) => (
              <button key={signal.id} type="button" onClick={() => onEvidence(buildSignalEvidence(world, signal))}>{signal.source_quote.slice(0, 120)}</button>
            ))}
          </>
        )}
      </article>

      <nav className="briefing-nav" aria-label="Briefing sections">
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>Previous</button>
        <div>{SECTIONS.map((item, itemIndex) => <button key={item} type="button" className={itemIndex === index ? "active" : ""} onClick={() => setIndex(itemIndex)} aria-label={`Open ${item}`}>{itemIndex + 1}</button>)}</div>
        <button type="button" onClick={() => setIndex((value) => Math.min(SECTIONS.length - 1, value + 1))} disabled={index === SECTIONS.length - 1}>Next</button>
      </nav>
    </section>
  );
}

export function DeliverableBriefingMode({ deliverable, onExit }: { deliverable: Deliverable; onExit: () => void }) {
  const [index, setIndex] = useState(0);
  const sections = deliverable.sections.length ? deliverable.sections : [];
  const active = sections[index];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((value) => Math.min(sections.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "Escape") onExit();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onExit, sections.length]);

  return (
    <section className="briefing-mode deliverable-briefing" aria-labelledby="deliverable-briefing-title">
      <header className="briefing-head">
        <div>
          <p className="eyebrow">Briefing mode</p>
          <h1 id="deliverable-briefing-title">{deliverable.title}</h1>
          <span>{active?.heading ?? "No sections"} · {sections.length ? `${index + 1} of ${sections.length}` : "0 of 0"}</span>
        </div>
        <div className="briefing-actions">
          <button type="button" onClick={() => window.print()}>Print</button>
          <button type="button" onClick={onExit}>Exit briefing</button>
        </div>
      </header>
      {active ? (
        <article className="briefing-card">
          <h2>{active.heading}</h2>
          {active.blocks.map((block, blockIndex) => {
            if (block.kind === "text") return <p key={blockIndex}>{block.text}</p>;
            if (block.kind === "table") return (
              <table key={blockIndex}>
                <thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
              </table>
            );
            return <p key={blockIndex}>{block.title}</p>;
          })}
        </article>
      ) : <EmptyState headline="No briefing sections" body="This deliverable has no readable sections." icon="document" />}
      <nav className="briefing-nav" aria-label="Deliverable briefing sections">
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>Previous</button>
        <div>{sections.map((item, itemIndex) => <button key={item.id} type="button" className={itemIndex === index ? "active" : ""} onClick={() => setIndex(itemIndex)} aria-label={`Open ${item.heading}`}>{itemIndex + 1}</button>)}</div>
        <button type="button" onClick={() => setIndex((value) => Math.min(sections.length - 1, value + 1))} disabled={index >= sections.length - 1}>Next</button>
      </nav>
    </section>
  );
}
