import { useMemo, useRef, useState } from "react";
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
import { plainWorkStatus, SCORE_FAMILY_LABELS, scoreAvailability, scoreInterpretation } from "../../app/presentation.ts";
import { navigateTo, useAppRoute } from "../../app/router.ts";
import { buildAccountEvidence, buildScoreEvidence, buildSignalEvidence, buildWorkItemEvidence, type EvidencePackage } from "../../app/evidence.ts";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer.tsx";
import { buildAccountTimeline } from "../../app/timeline.ts";
import { MeaningfulTimeline } from "../timeline/MeaningfulTimeline.tsx";
import { AccountBriefingMode } from "../modes/BriefingMode.tsx";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";
import { provenanceForRecord } from "../../app/provenance.ts";
import { canonicalMetrics, formatCanonicalMetric } from "../../app/canonicalMetrics.ts";

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

function accountListScoreLabel(score: ScoreSnapshot | null): string {
  const display = scoreDisplay(score);
  return display === "More information needed" ? "Attractiveness needs more information" : `Attractiveness ${display}`;
}

function scoreStatus(score: ScoreSnapshot | null): string {
  return score?.result.status.replace(/_/g, " ") ?? "insufficient data";
}

function relationshipBackedSignals(world: World, accountId: string) {
  return (world.worldSnapshot?.signals ?? world.analysis.valid)
    .filter((signal) =>
      signal.scope === "specific_account" &&
      signal.subject_id === accountId &&
      (signal.relationships ?? []).some((relationship) => relationshipAccountId(relationship) === accountId && isConfirmedAccountSignal(signal, relationship))
    )
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
}

export function Account360({ world, accountId, onSelectAccount }: { world: World; accountId?: string | null; onSelectAccount?: (accountId: string) => void }) {
  const route = useAppRoute();
  const [evidence, setEvidence] = useState<EvidencePackage | null>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Rows cover every account, not just customers. The list below stays
  // customer-first, but a prospect that is routed to directly must still
  // render, otherwise prospect journeys have nowhere to live now that the
  // separate Prospects surface is retired.
  const accountRows = useMemo(() => {
    return world.companies
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
    : accountRows.find((row) => row.company.relationship === "customer") ?? accountRows[0] ?? null;
  const listRows = useMemo(() => {
    return accountRows;
  }, [accountRows]);
  const contacts = selected ? world.contacts.filter((contact) => contact.company_id === selected.company.id) : [];
  const deals = selected ? world.opportunities.filter((opp) => opp.company_id === selected.company.id) : [];
  const facilities = selected ? world.facilities.filter((facility) => facility.company_id === selected.company.id) : [];
  const workItems = selected ? (world.worldSnapshot?.workItems ?? []).filter((item) => item.canonical_account_id === selected.company.id).slice(0, 5) : [];
  const primaryAccountWork = workItems[0] ?? null;

  if (!selected && accountId) {
    return (
      <section className="surface-page" data-surface-component="surface-account-360">
        <SurfaceHeader eyebrow="Accounts / Account 360" headline="Account not found" />
        <EmptyState headline="Account not found" body="The requested account ID is not in the current backend world snapshot." icon="accounts" />
      </section>
    );
  }

  if (!selected) {
    const failed = world.queryStatus === "error" || world.loadErrors.length > 0;
    return (
      <section className="surface-page" data-surface-component="surface-account-360">
        <SurfaceHeader eyebrow="Accounts" headline={failed ? "Account records could not be loaded." : "No accounts are available."} />
        <EmptyState
          headline={failed ? "Account data unavailable" : "No accounts"}
          body={failed ? `${world.loadErrors.join(" ")} Try again after the data service recovers.` : "The connected CRM returned no customer account records."}
        />
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
  const viewMode = route.query.get("view");
  const isFocus = viewMode === "focus";
  const isBriefing = viewMode === "briefing";
  const accountTimeline = buildAccountTimeline(world, company.id);
  const evidenceWhy = selected.linkedSignals.length
    ? `${selected.linkedSignals.length} confirmed account development`
    : scoreInterpretation(strongestScore, SCORE_FAMILY_LABELS.accountAttractiveness);
  const evidenceDetail = selected.linkedSignals[0]
    ? signalHeadline(selected.linkedSignals[0])
    : `${selected.linkedSignals.length} confirmed account development${selected.linkedSignals.length === 1 ? "" : "s"}`;
  const accountScores = SCORE_LABELS.map(([family, label]) => ({
    family,
    label,
    score: latestAccountScore(world, company.id, family),
  }));
  const availableScores = accountScores.filter(({ score }) => score && score.score !== null && score.result.status !== "insufficient_data");
  const qualificationGaps = accountScores.flatMap(({ family, label, score }) =>
    (score?.result.missingInputs ?? [`${label} has not been calculated.`]).map((gap) => ({ family, label, gap }))
  );
  const accountMetrics = canonicalMetrics(world);
  const totalAccountsMetric = formatCanonicalMetric(accountMetrics.total_accounts);
  const customerAccountsMetric = formatCanonicalMetric(accountMetrics.customer_accounts);
  const crmAccountsMetric = formatCanonicalMetric(accountMetrics.crm_synced_accounts);
  const opportunityMetric = formatCanonicalMetric(accountMetrics.opportunity);

  function pathWithView(nextView: string | null): string {
    const params = new URLSearchParams(route.query);
    if (nextView) params.set("view", nextView);
    else params.delete("view");
    const query = params.toString();
    return `${route.path}${query ? `?${query}` : ""}`;
  }

  function openEvidence(next: EvidencePackage, trigger?: HTMLButtonElement | null) {
    evidenceTriggerRef.current = trigger ?? null;
    setEvidence(next);
  }

  if (isBriefing) {
    return (
      <>
        <AccountBriefingMode
          world={world}
          company={company}
          signals={selected.linkedSignals}
          workItems={workItems}
          onExit={() => navigateTo(pathWithView(null))}
          onEvidence={(next) => openEvidence(next)}
        />
        <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} triggerRef={evidenceTriggerRef} />
      </>
    );
  }

  return (
    <section className={isFocus ? "surface-page account360 record-focus-mode" : "surface-page account360"} data-surface-component="surface-account-360">
      <SurfaceHeader
        eyebrow="Accounts / Account 360"
        headline={company.name}
        subline={`${formatAddress(company.location) ?? company.location.city} · ${totalAccountsMetric.displayValue} ${totalAccountsMetric.displayLabel.toLowerCase()} · ${customerAccountsMetric.displayValue} ${customerAccountsMetric.displayLabel.toLowerCase()} · ${crmAccountsMetric.displayValue} ${crmAccountsMetric.displayLabel.toLowerCase()} · ${opportunityMetric.displayValue} ${opportunityMetric.displayLabel.toLowerCase()} · ${totalAccountsMetric.provenanceLabel}`}
      />

      <div className="account360-layout">
        <aside className="account360-list">
          {listRows.map((row) => (
            <button key={row.company.id} className={row.company.id === company.id ? "active account360-list-row" : "account360-list-row"} onClick={() => onSelectAccount?.(row.company.id)}>
              <AccountToken name={row.company.name} riskScore={row.score?.dimensions.risk.score} size="sm" />
              <span className="account360-list-row-main">
                <strong>{row.company.name}</strong>
                <span>{accountListScoreLabel(row.attractiveness)}</span>
                <em>{row.linkedSignals.length} confirmed signal{row.linkedSignals.length === 1 ? "" : "s"} · {money(row.openPipeline)} open</em>
              </span>
            </button>
          ))}
        </aside>

        <div className="account360-detail">
          <section className="account-decision-strip" aria-labelledby="account-decision-title">
            <div>
              <span>Recommended</span>
              <h2 id="account-decision-title">{primaryAccountWork?.recommended_action ?? (rec ? actionLabel(rec.action) : "Review account context")}</h2>
              <p>{primaryAccountWork ? `${company.name} needs a decision because this work is ${plainWorkStatus(primaryAccountWork.status).toLowerCase()}.` : rec?.reason ?? "The current records do not include a specific recommendation yet."}</p>
            </div>
            <div>
              <span>Why</span>
              <strong>{evidenceWhy}</strong>
              <em>{evidenceDetail}</em>
            </div>
            <div>
              <span>Missing</span>
              <strong>{primaryMissing}</strong>
              <em>{scoreAvailability(deliveryScore)}</em>
            </div>
            <div className="decision-action-stack">
              <button ref={evidenceTriggerRef} type="button" onClick={() => openEvidence(buildAccountEvidence(world, company, strongestScore, selected.linkedSignals), evidenceTriggerRef.current)}>View evidence</button>
              <button type="button" onClick={() => openDeliverableWizard({ accountId: company.id, startStep: "pick" })}>Create executive brief</button>
            </div>
          </section>

          <div className="mode-action-strip">
            <button type="button" onClick={() => navigateTo(pathWithView(isFocus ? null : "focus"))}>{isFocus ? "Exit focus" : "Focus mode"}</button>
            <button type="button" onClick={() => navigateTo(pathWithView("briefing"))}>Briefing mode</button>
            <button type="button" onClick={() => navigateTo(`/ask?account=${encodeURIComponent(company.id)}&prompt=${encodeURIComponent(`Why did the system recommend this action, and what should I discuss with ${company.name}?`)}`)}>Ask with context</button>
          </div>

          <div className="account360-kpis">
            {availableScores.map(({ family, label, score: scoreResult }) => {
              return (
                <div key={family}>
                  <span>{label}</span>
                  <strong>{scoreDisplay(scoreResult)}</strong>
                  <em>{scoreInterpretation(scoreResult, label)}</em>
                  <button type="button" onClick={(event) => openEvidence(buildScoreEvidence(world, scoreResult, family, company.id), event.currentTarget)}>View evidence</button>
                </div>
              );
            })}
            <div><span>Capability fit</span><strong>{fit.matched.length ? fitLabel(fit.score) : "Unqualified"}</strong><em>Capacity has not been assessed.</em></div>
          </div>

          <section className="surface-panel">
            <div className="panel-head"><h2>Qualification gaps</h2><span>{qualificationGaps.length}</span></div>
            <p>Missing inputs are not zero values. Assign the evidence collection needed before these decision aids are calculated.</p>
            <div className="score-explain-list">
              {qualificationGaps.map(({ family, label, gap }, index) => (
                <div key={`${family}-${index}`}>
                  <strong>{label}</strong>
                  <p>{gap}</p>
                  <span>Owner: Revenue Operations</span>
                  <button type="button" onClick={() => navigateTo(`/ask?account=${encodeURIComponent(company.id)}&prompt=${encodeURIComponent(`Create qualification work for ${company.name}: ${gap}`)}`)}>Assign qualification action</button>
                </div>
              ))}
            </div>
          </section>

          {availableScores.length > 0 && <section className="surface-panel">
            <div className="panel-head"><h2>Calculated decision aids</h2></div>
            <p>Rule-based decision aids; not statistical probabilities.</p>
            <div className="score-explain-list">
              {availableScores.map(({ family, label, score: scoreResult }) => {
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
                        <button type="button" onClick={(event) => openEvidence(buildScoreEvidence(world, scoreResult, family, company.id), event.currentTarget)}>View score evidence</button>
                      </div>
                    ) : (
                      <p>No backend score snapshot is available for this account.</p>
                    )}
                  </details>
                );
              })}
            </div>
          </section>}

          <section className="surface-panel primary-action-panel">
            <div>
              <h2>Next actions</h2>
              <p>Create a deliverable or confirm a HubSpot task from this account context.</p>
            </div>
              <div className="primary-action-row">
                <button type="button" onClick={() => navigateTo(`/ask?account=${encodeURIComponent(company.id)}&prompt=${encodeURIComponent(`What should we do next with ${company.name}?`)}`)}>Ask about this account</button>
                <button type="button" onClick={() => openDeliverableWizard({ accountId: company.id, startStep: "pick" })}>Create deliverable</button>
              </div>
            <CrmWriteActions
              key={company.id}
              company={company}
              contact={contacts[0]}
              environment={world.sources.find((source) => source.id.includes("hubspot"))?.environment ?? "none"}
              writeConnected={world.sources.find((source) => source.id.includes("hubspot"))?.canWrite ?? false}
              currentRouteEntityId={route.accountId}
              variant="account"
              defaultTaskSubject={`Follow up with ${company.name}`}
              defaultTaskBody={rec?.reason ?? `Review next step for ${company.name}.`}
            />
          </section>

          {rec && !primaryAccountWork && (
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
                  actionLabel="View evidence"
                  onAction={() => openEvidence(buildSignalEvidence(world, signal))}
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
              {contacts.map((contact) => <p key={contact.id}><strong>{contact.name}</strong> · {contact.title} <ProvenanceBadge label={provenanceForRecord(contact)} /></p>)}
              {contacts.length === 0 && <div className="rail-quiet-empty">No contacts available.</div>}
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Deals</h2></div>
              {deals.map((deal) => <p key={deal.id}><strong>{deal.name}</strong> · {deal.stage} · {money(deal.value)} <ProvenanceBadge label={provenanceForRecord(deal)} /></p>)}
              {deals.length === 0 && <div className="rail-quiet-empty">No deals available.</div>}
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Capability fit</h2></div>
              <p>{fit.matched.length ? fit.matched.join(", ") : "No capability overlap is documented in current records."}</p>
              <p className="muted">{facilities.length} facility record{facilities.length === 1 ? "" : "s"} in the current production view.</p>
            </section>
            <section className="surface-panel">
              <div className="panel-head"><h2>Work items</h2></div>
              <WorkItemList items={workItems} empty="No account-specific work items." world={world} />
            </section>
          </div>
          <MeaningfulTimeline
            events={accountTimeline}
            onEvidence={(next) => openEvidence(next)}
            evidenceById={(event) => {
              if (event.evidenceId?.startsWith("signal-")) {
                const signal = selected.linkedSignals.find((item) => `signal-${item.id}` === event.evidenceId);
                return signal ? buildSignalEvidence(world, signal) : null;
              }
              if (event.evidenceId?.startsWith("score-")) {
                const family = String(event.evidenceId.split("-")[1]);
                return buildScoreEvidence(world, latestAccountScore(world, company.id, family as keyof NonNullable<World["scoreResults"]>), family, company.id);
              }
              if (event.evidenceId?.startsWith("work-")) {
                const item = workItems.find((work) => `work-${work.id}` === event.evidenceId);
                return item ? buildWorkItemEvidence(world, item) : null;
              }
              return null;
            }}
          />
        </div>
      </div>
      <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} triggerRef={evidenceTriggerRef} />
    </section>
  );
}
