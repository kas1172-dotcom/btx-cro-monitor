import { useMemo } from "react";
import type { World } from "../../app/useWorld.ts";
import type { ScoreSnapshot } from "../../app/revenueDataClient.ts";
import { PROFILE } from "../../app/config.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import { actionLabel } from "../../app/actionLabels.ts";
import { formatAddress } from "../../app/format.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { isConfirmedAccountSignal, relationshipAccountId } from "../../engine/signals/contract.ts";
import { WorkItemList } from "./WorkItemList.tsx";
import { EmptyState, SignalCard, SurfaceHeader } from "../primitives.tsx";
import { AccountToken } from "../common/AccountToken.tsx";
import { CrmWriteActions } from "../actions/CrmWriteActions.tsx";
import { openDeliverableWizard } from "../../store/store.ts";
import { SCORE_FAMILY_LABELS, scoreAvailability, scoreInterpretation } from "../../app/presentation.ts";

function money(value: number | null): string {
  if (value === null) return "Value not provided";
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`;
}

function fitLabel(score: number): string {
  if (score >= 70) return "strong";
  if (score >= 45) return "partial";
  return "needs qualification";
}

const SCORE_LABELS: Array<[keyof NonNullable<World["scoreResults"]>, string]> = [
  ["accountAttractiveness", SCORE_FAMILY_LABELS.accountAttractiveness],
  ["signalConfidence", SCORE_FAMILY_LABELS.signalConfidence],
  ["pursuitPwin", SCORE_FAMILY_LABELS.pursuitPwin],
  ["deliveryFeasibility", SCORE_FAMILY_LABELS.deliveryFeasibility],
  ["relationshipHealth", SCORE_FAMILY_LABELS.relationshipHealth],
];

function latestAccountScore(world: World, accountId: string, family: keyof NonNullable<World["scoreResults"]>): ScoreSnapshot | null {
  return world.scoreResults?.[family]
    .filter((score) => score.entityType === "account" && score.entityId === accountId)
    .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0] ?? null;
}

function scoreDisplay(score: ScoreSnapshot | null): string {
  if (!score) return "More information needed";
  if (score.result.status === "insufficient_data") return "More information needed";
  if (score.result.status === "provisional") return score.score === null ? "Provisional" : `${Math.round(score.score)} provisional`;
  if (score.result.status === "disqualified") return "Disqualified";
  return score.score === null ? "More information needed" : String(Math.round(score.score));
}

function scoreStatus(score: ScoreSnapshot | null): string {
  return score?.result.status.replace(/_/g, " ") ?? "insufficient data";
}

function relationshipBackedSignals(world: World, accountId: string) {
  return world.analysis.valid
    .filter((signal) =>
      signal.scope === "specific_account" &&
      signal.subject_id === accountId &&
      (signal.relationships ?? []).some((relationship) => relationshipAccountId(relationship) === accountId && isConfirmedAccountSignal(signal, relationship))
    )
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
}

export function Account360({ world, accountId, onSelectAccount }: { world: World; accountId?: string | null; onSelectAccount?: (accountId: string) => void }) {
  const accountRows = useMemo(() => {
    return world.companies
      .filter((company) => company.relationship === "customer")
      .map((company) => ({
        company,
        score: world.analysis.byId.get(company.id),
        rec: world.analysis.recById.get(company.id),
        linkedSignals: relationshipBackedSignals(world, company.id),
        attractiveness: latestAccountScore(world, company.id, "accountAttractiveness"),
        openPipeline: world.opportunities.filter((opp) => opp.company_id === company.id && opp.stage !== "won" && opp.stage !== "lost").reduce((sum, opp) => sum + (opp.value ?? 0), 0),
      }))
      .sort((a, b) =>
        (b.attractiveness?.score ?? -1) - (a.attractiveness?.score ?? -1) ||
        b.linkedSignals.length - a.linkedSignals.length ||
        a.company.name.localeCompare(b.company.name)
      );
  }, [world]);
  const selected = accountId
    ? accountRows.find((row) => row.company.id === accountId || row.company.canonical_account_id === accountId) ?? null
    : accountRows[0] ?? null;
  const contacts = selected ? world.contacts.filter((contact) => contact.company_id === selected.company.id) : [];
  const deals = selected ? world.opportunities.filter((opp) => opp.company_id === selected.company.id) : [];
  const facilities = selected ? world.facilities.filter((facility) => facility.company_id === selected.company.id) : [];
  const workItems = selected ? (world.worldSnapshot?.workItems ?? []).filter((item) => item.canonical_account_id === selected.company.id).slice(0, 5) : [];

  if (!selected && accountId) {
    return (
      <section className="surface-page" data-surface-component="surface-account-360">
        <SurfaceHeader eyebrow="Accounts / Account 360" headline="Account not found" />
        <EmptyState headline="Account not found" body="The requested account ID is not in the current backend world snapshot." icon="accounts" />
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="surface-page" data-surface-component="surface-account-360">
        <SurfaceHeader eyebrow="Accounts" headline="No accounts are available." />
        <EmptyState headline="No accounts" body="Connect a CRM source to populate customer records." />
      </section>
    );
  }

  const company = selected.company;
  const rec = selected.rec;
  const fit = scoreFit(company.needs, PROFILE.capabilities);
  const strongestScore = latestAccountScore(world, company.id, "accountAttractiveness");
  const relationshipScore = latestAccountScore(world, company.id, "relationshipHealth");
  const deliveryScore = latestAccountScore(world, company.id, "deliveryFeasibility");
  const missingInputs = [
    ...(strongestScore?.result.missingInputs ?? []),
    ...(relationshipScore?.result.missingInputs ?? []),
    ...(deliveryScore?.result.missingInputs ?? []),
  ];
  const primaryMissing = missingInputs[0] ?? (contacts.length ? "No major missing input surfaced." : "No verified contact provided.");

  return (
    <section className="surface-page account360" data-surface-component="surface-account-360">
      <SurfaceHeader
        eyebrow="Accounts / Account 360"
        headline={company.name}
        subline={formatAddress(company.location) ?? company.location.city}
      />

      <div className="account360-layout">
        <aside className="account360-list">
          {accountRows.map((row) => (
            <button key={row.company.id} className={row.company.id === company.id ? "active account360-list-row" : "account360-list-row"} onClick={() => onSelectAccount?.(row.company.id)}>
              <AccountToken name={row.company.name} riskScore={row.score?.dimensions.risk.score} size="sm" />
              <span className="account360-list-row-main">
                <strong>{row.company.name}</strong>
                <span>{scoreDisplay(row.attractiveness)} attractiveness</span>
                <em>{row.linkedSignals.length} confirmed signal{row.linkedSignals.length === 1 ? "" : "s"} · {money(row.openPipeline)} open</em>
              </span>
            </button>
          ))}
        </aside>

        <div className="account360-detail">
          <section className="account-decision-strip" aria-labelledby="account-decision-title">
            <div>
              <span>Recommended</span>
              <h2 id="account-decision-title">{rec ? actionLabel(rec.action) : "Review account context"}</h2>
              <p>{rec?.reason ?? "The current records do not include a specific recommendation yet."}</p>
            </div>
            <div>
              <span>Why</span>
              <strong>{scoreInterpretation(strongestScore, SCORE_FAMILY_LABELS.accountAttractiveness)}</strong>
              <em>{selected.linkedSignals.length} confirmed account development{selected.linkedSignals.length === 1 ? "" : "s"}</em>
            </div>
            <div>
              <span>Missing</span>
              <strong>{primaryMissing}</strong>
              <em>{scoreAvailability(deliveryScore)}</em>
            </div>
            <button type="button" onClick={() => openDeliverableWizard({ accountId: company.id, startStep: "pick" })}>Create executive brief</button>
          </section>

          <div className="account360-kpis">
            {SCORE_LABELS.map(([family, label]) => {
              const scoreResult = latestAccountScore(world, company.id, family);
              return (
                <div key={family}>
                  <span>{label}</span>
                  <strong>{scoreDisplay(scoreResult)}</strong>
                  <em>{scoreInterpretation(scoreResult, label)}</em>
                </div>
              );
            })}
            <div><span>Capability fit</span><strong>{fitLabel(fit.score)}</strong><em>not capacity</em></div>
          </div>

          <section className="surface-panel">
            <div className="panel-head"><h2>Score explanations</h2></div>
            <div className="score-explain-list">
              {SCORE_LABELS.map(([family, label]) => {
                const scoreResult = latestAccountScore(world, company.id, family);
                const result = scoreResult?.result;
                return (
                  <details key={family}>
                    <summary>{label}: {scoreDisplay(scoreResult)}</summary>
                    {result ? (
                      <div>
                        <p>Status: {scoreStatus(scoreResult)}. Completeness: {Math.round(result.dataCompleteness * 100)}%. Config {result.configurationVersion}.</p>
                        {result.missingInputs.length > 0 && <p>Missing: {result.missingInputs.join("; ")}</p>}
                        {result.hardGateFailures.length > 0 && <p>Hard gates: {result.hardGateFailures.join("; ")}</p>}
                        {[...result.positiveFactors, ...result.negativeFactors, ...result.neutralFactors].map((factor) => (
                          <p key={factor.key}><strong>{factor.label}</strong>: {factor.contribution === null ? "not available" : factor.contribution.toFixed(1)} contribution. {factor.explanation}</p>
                        ))}
                      </div>
                    ) : (
                      <p>No backend score snapshot is available for this account.</p>
                    )}
                  </details>
                );
              })}
            </div>
          </section>

          <section className="surface-panel primary-action-panel">
            <div>
              <h2>Next actions</h2>
              <p>Create a deliverable or confirm a HubSpot task from this account context.</p>
            </div>
            <div className="primary-action-row">
              <button type="button" onClick={() => openDeliverableWizard({ accountId: company.id, startStep: "pick" })}>Create deliverable</button>
            </div>
            <CrmWriteActions
              company={company}
              contact={contacts[0]}
              variant="account"
              defaultTaskSubject={`Follow up with ${company.name}`}
              defaultTaskBody={rec?.reason ?? `Review next step for ${company.name}.`}
            />
          </section>

          {rec && (
            <section className="surface-panel">
              <div className="panel-head"><h2>Recommended action</h2></div>
              <p><strong>{actionLabel(rec.action)}</strong> - {rec.reason}</p>
            </section>
          )}

          <section className="surface-panel">
            <div className="panel-head"><h2>Linked signals</h2></div>
            <div className="signal-mini-list">
              {selected.linkedSignals.map((signal) => (
                <SignalCard
                  key={signal.id}
                  title={signalHeadline(signal)}
                  scope={signal.scope}
                  source={signalSourceName(signal)}
                  date={signalSourceDate(signal)}
                  body={signal.source_quote}
                  provenance={{
                    entity: signal.entities[0] ?? company.name,
                    method: signal.relationships?.[0]?.match_method,
                    confidence: signal.relationships?.[0]?.confidence ?? signal.confidence,
                  }}
                />
              ))}
              {selected.linkedSignals.length === 0 && (
                <EmptyState headline="No linked signals" body="Market signals stay in the Signals view until a verified account link is available." icon="signal" />
              )}
            </div>
          </section>

          <div className="brief-grid compact">
            <section className="surface-panel">
              <div className="panel-head"><h2>Contacts</h2></div>
              {contacts.map((contact) => <p key={contact.id}><strong>{contact.name}</strong> · {contact.title}</p>)}
              {contacts.length === 0 && <div className="rail-quiet-empty">No contacts available.</div>}
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Deals</h2></div>
              {deals.map((deal) => <p key={deal.id}><strong>{deal.name}</strong> · {deal.stage} · {money(deal.value)}</p>)}
              {deals.length === 0 && <div className="rail-quiet-empty">No deals available.</div>}
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Capability fit</h2></div>
              <p>{fit.matched.length ? fit.matched.join(", ") : "No direct capability overlap."}</p>
              <p className="muted">{facilities.length} facility record{facilities.length === 1 ? "" : "s"} in the current production view.</p>
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Work items</h2></div>
              <WorkItemList items={workItems} empty="No account-specific work items." world={world} />
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
