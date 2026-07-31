import { useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { accountStatus, isProspectingAccount } from "../../brain/classification.ts";
import type { AccountStatus, BusinessMotion, Company } from "../../engine/brain/entities.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import { openDeliverableWizard, setState, useStore } from "../../store/store.ts";
import { explainRankingPrompt, expandSignalPrompt, nextActionPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { companyLinks, formatAddress } from "../../app/format.ts";
import { AskButton } from "../ask/AskButton.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { RankingWhy } from "../ranking/RankingWhy.tsx";
import { DemoActionButton } from "../actions/DemoActionButton.tsx";
import { EmptyState } from "../primitives.tsx";
import { ImportListModal } from "../prospecting/ImportListModal.tsx";
import { ProspectMap } from "../map/ProspectMap.tsx";
import { prospectQualificationLabel, qualitativeSignalConfidence } from "../../app/confidence.ts";
import { CrmWriteActions } from "../actions/CrmWriteActions.tsx";
import { useAppRoute } from "../../app/router.ts";

const PROSPECT_STATUSES = new Set<AccountStatus>(["target_prospect", "new_logo"]);
const PROSPECT_MOTIONS = new Set<BusinessMotion>(["prospect_new_business"]);
const BUYING_EVENTS = new Set([
  "government_contract_award",
  "contract_win",
  "demand_spike",
  "hiring_surge",
  "capacity_constraint",
]);

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalStrength(signals: Signal[]): number {
  return signals.reduce((sum, s) => sum + (qualitativeSignalConfidence(s).band === "high" ? 3 : qualitativeSignalConfidence(s).band === "medium" ? 2 : 1), 0);
}

function isProspectingSignal(signal: Signal): boolean {
  return Boolean(
    (signal.account_status && PROSPECT_STATUSES.has(signal.account_status)) ||
      (signal.business_motion && PROSPECT_MOTIONS.has(signal.business_motion)) ||
      BUYING_EVENTS.has(signal.event_type),
  );
}

function signalMatchesCompany(signal: Signal, company: Company): boolean {
  if (signal.subject_id === company.id || signal.subject_id === company.canonical_account_id) return true;
  const haystack = [
    signal.artifact?.headline,
    signal.source_quote,
    signal.subject_id,
    signal.entities.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
  const needles = [
    company.name,
    ...(company.aliases ?? []),
    ...(company.domains ?? []),
  ].map((value) => value.toLowerCase().replace(/^www\./, ""));
  return needles.some((needle) => needle && haystack.includes(needle));
}

function whyNow(signals: Signal[]): string {
  const top = signals[0];
  if (!top) return "No recent buying signal, but the account fits the target profile.";
  return `${titleCase(top.event_type)}: ${top.source_quote}`;
}

function recommendedOutreach(company: Company, contactName: string | undefined): string {
  const lead = contactName ? `Ask ${contactName}` : "Ask the buying team";
  if (company.needs.length === 0) return `${lead} about current supplier gaps and upcoming work.`;
  return `${lead} about ${company.needs.slice(0, 2).join(" and ")} needs, then offer a capacity-fit conversation.`;
}

function visitReason(row: { opportunity: number; qualification: { label: string; gaps: string[] }; signals: Signal[]; contact?: { name: string } }): string {
  const signal = row.signals[0];
  const contact = row.contact ? ` and ${row.contact.name} is available` : "";
  const gaps = row.qualification.gaps.length ? ` Missing evidence: ${row.qualification.gaps.join(", ")}.` : "";
  if (signal) return `Opportunity ${row.opportunity}, ${row.qualification.label}, and a ${titleCase(signal.event_type)} signal${contact}.${gaps}`;
  return `Opportunity ${row.opportunity} and ${row.qualification.label} make this a practical market stop${contact}.${gaps}`;
}

function scoreLabel(row: { score?: unknown; rankedProspect?: unknown; opportunity: number }): string {
  if (!row.score && !row.rankedProspect) return "Not scored";
  return String(row.opportunity);
}

function nextBestAction(row: { contact?: { name: string }; signals: Signal[]; qualification: { gaps: string[] }; company: Company }): string {
  if (row.contact && row.signals.length > 0) return `Draft outreach to ${row.contact.name}`;
  if (row.contact) return `Qualify timing with ${row.contact.name}`;
  if (row.signals.length > 0) return "Find a decision-maker";
  if (row.qualification.gaps.length > 0) return `Resolve ${row.qualification.gaps[0]}`;
  return "Review fit before outreach";
}

export function Prospecting({ world }: { world: World }) {
  const route = useAppRoute();
  const { city } = useStore();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [expandedProspectId, setExpandedProspectId] = useState<string | null>(null);
  const [prospectView, setProspectView] = useState<"list" | "map">("list");
  const prospectSignals = world.analysis.valid.filter(isProspectingSignal);
  const idsFromSignals = new Set(prospectSignals.map((s) => s.subject_id));
  const prospectCompanies = world.companies.filter(
    (c) =>
      isProspectingAccount(c) ||
      c.business_motion === "prospect_new_business" ||
      idsFromSignals.has(c.id),
  );
  const prospectIds = new Set(prospectCompanies.map((c) => c.id));
  const prospectRows = prospectCompanies
    .map((company) => {
      const score = world.analysis.byId.get(company.id);
      const rankedProspect = world.prospects.find((p) => p.company.id === company.id);
      const signals = prospectSignals
        .filter((s) => signalMatchesCompany(s, company))
        .sort((a, b) => b.confidence - a.confidence);
      const contact = world.contacts.find((c) => c.company_id === company.id);
      const revenue = world.opportunities
        .filter((o) => o.company_id === company.id && o.stage !== "lost")
        .reduce((sum, o) => sum + (o.value ?? 0), 0);
      const opportunity = score?.dimensions.opportunity.score ?? rankedProspect?.opportunity ?? 0;
      const fit = rankedProspect?.fit.score ?? 0;
      const qualification = prospectQualificationLabel({
        company,
        contact,
        opportunities: world.opportunities.filter((opportunity) => opportunity.company_id === company.id),
        fitMatched: rankedProspect?.fit.matched ?? [],
      });
      const urgency = opportunity + fit + signalStrength(signals) + (contact ? 10 : 0) + (revenue > 0 ? 12 : 0);
      return { company, score, rankedProspect, signals, contact, revenue, opportunity, fit, qualification, urgency };
    })
    .filter((row) => PROSPECT_STATUSES.has(accountStatus(row.company)) || row.company.business_motion === "prospect_new_business")
    .sort((a, b) => b.urgency - a.urgency || a.company.name.localeCompare(b.company.name));
  const topProspects = prospectRows.slice(0, 6);
  const selectedMarket = city;
  const marketProspects = prospectRows
    .filter((row) => selectedMarket === null || row.company.location.city === selectedMarket)
    .slice(0, 8);
  const visitPlanRows = (selectedMarket
    ? prospectRows.filter((row) => row.company.location.city === selectedMarket)
    : prospectRows
  ).slice(0, 5);
  const buyingSignals = prospectSignals
    .filter((signal) => prospectRows.some((row) => signalMatchesCompany(signal, row.company)) || prospectIds.has(signal.subject_id))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const outreachQueue = prospectRows.filter((row) => row.contact).slice(0, 8);
  const recommendedActions = world.analysis.recommendations
    .filter((r) => prospectIds.has(r.subject_id) && r.priority !== "low")
    .slice(0, 8);
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const totalRevenue = prospectRows.reduce((sum, row) => sum + row.revenue, 0);
  const marketLabel = selectedMarket ?? "All Markets";
  const visitPlanTitle = selectedMarket ? `${selectedMarket} prospecting shortlist` : "Prospecting shortlist";

  return (
    <div className="prospecting-workspace" data-surface-component="surface-prospecting">
      <section className="current-head">
        <p className="eyebrow">Prospecting</p>
        <h1>Who should we pursue next?</h1>
        <p>
          New-logo and target-account discovery, ranked by fit, buying signal strength, revenue potential, geography,
          contact availability, and urgency.
        </p>
        <button className="import-list-trigger" type="button" onClick={() => setIsImportOpen(true)}>Import list</button>
      </section>

      <div className="surface-view-toggle" role="group" aria-label="Prospects view">
        <button type="button" className={prospectView === "list" ? "active" : ""} onClick={() => setProspectView("list")}>List</button>
        <button type="button" className={prospectView === "map" ? "active" : ""} onClick={() => setProspectView("map")}>Map</button>
      </div>

      {prospectView === "map" && (
        <section className="surface-panel prospects-map-panel" aria-label="Prospect map">
          <ProspectMap world={world} prospectsOnly />
        </section>
      )}

      <section className="current-summary">
        <div>
          <span>Target accounts</span>
          <strong>{prospectRows.length}</strong>
          <em>{marketLabel}</em>
        </div>
        <div>
          <span>Buying signals</span>
          <strong>{buyingSignals.length}</strong>
          <em>award, demand, hiring, or capacity signals</em>
        </div>
        <div>
          <span>Revenue potential</span>
          <strong>{money(totalRevenue)}</strong>
          <em>{prospectRows.some((row) => row.revenue > 0) ? "estimated from current pipeline records" : "No pipeline value available"}</em>
        </div>
        <div>
          <span>Outreach queue</span>
          <strong>{outreachQueue.length}</strong>
          <em>prospects with contacts available</em>
        </div>
      </section>

      <section className="visit-plan-panel">
        <div className="visit-plan-head">
          <div>
            <p className="eyebrow">{selectedMarket ? "Market workflow" : "All markets"}</p>
            <h2>{visitPlanTitle}</h2>
            <p>
              {selectedMarket
                ? `A practical prospecting list for a ${selectedMarket} visit, ranked by opportunity, fit, signal strength, contact availability, and geography.`
                : "Select a city for an in-market visit plan. For now, these are the strongest national targets in the current data."}
            </p>
          </div>
          <button onClick={() => setProspectView("map")}>{selectedMarket ? "Open map" : "Choose on map"}</button>
        </div>
        <div className="visit-plan-list">
          {visitPlanRows.map((row, index) => {
            const evidence = row.signals[0]?.source_quote ?? "No validated signal attached in current data.";
            const expanded = expandedProspectId === `visit-${row.company.id}`;
            return (
              <article key={row.company.id} className="visit-plan-card compact-scan-card">
                <span className="rank-badge">#{index + 1}</span>
                <div>
                  <strong>{row.company.name}</strong>
                  <em>{row.company.location.city} · score {scoreLabel(row)} · next best action: {nextBestAction(row)}</em>
                  {expanded && (
                    <div className="scan-detail-panel">
                      <p><b>Address:</b> {formatAddress(row.company.location) ?? row.company.location.city}</p>
                      <p><b>Talking point:</b> {recommendedOutreach(row.company, row.contact?.name)}</p>
                      <small>{evidence}</small>
                      <div className="link-row">
                        {row.signals[0] && <ExternalLink href={row.signals[0].source_url} label="Source" />}
                        <AskButton
                          label="Draft outreach"
                          prompt={outreachPrompt(row.company, `Visit plan stop in ${row.company.location.city}. Why visit: ${visitReason(row)} Evidence: ${evidence}. Contact: ${row.contact?.name ?? "not available"}.`)}
                        />
                        <DemoActionButton
                          label="Create CRM Task"
                          action={{
                            action: "crm_task",
                            title: "Create CRM Task",
                            accountName: row.company.name,
                            evidence,
                          }}
                        />
                        <DemoActionButton
                          label="Add to Follow-up"
                          action={{
                            action: "follow_up",
                            title: "Add to Follow-up",
                            accountName: row.company.name,
                            evidence,
                          }}
                        />
                      </div>
                      <CrmWriteActions
                        key={row.company.id}
                        company={row.company}
                        contact={row.contact}
                        environment={world.sources.find((source) => source.id.includes("hubspot"))?.environment ?? "none"}
                        writeConnected={world.sources.find((source) => source.id.includes("hubspot"))?.canWrite ?? false}
                        currentRouteEntityId={route.accountId}
                        variant="prospect"
                        defaultTaskSubject={`Qualify ${row.company.name}`}
                        defaultTaskBody={`${whyNow(row.signals)} Missing evidence: ${row.qualification.gaps.join(", ") || "none"}.`}
                      />
                    </div>
                  )}
                </div>
                <div className="visit-plan-meta">
                  <span>{row.qualification.label}</span>
                  <span>Opportunity {scoreLabel(row)}</span>
                  <button type="button" onClick={() => setExpandedProspectId(expanded ? null : `visit-${row.company.id}`)}>
                    {expanded ? "Hide" : "Details"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="prospecting-grid">
        <div className="current-panel current-panel-wide">
          <div className="panel-head">
            <h2>Top new prospects</h2>
            <button onClick={() => setProspectView("map")}>Open map</button>
          </div>
          {topProspects.map((row, index) => {
            const expanded = expandedProspectId === row.company.id;
            return (
            <article key={row.company.id} className="prospect-card compact-scan-card">
              <span className="rank-badge">#{index + 1}</span>
              <span className="prospect-card-main">
                <strong>{row.company.name}</strong>
                <em>{row.company.location.city} · {row.qualification.label} · score {scoreLabel(row)} · next best action: {nextBestAction(row)}</em>
                {expanded && (
                  <div className="scan-detail-panel">
                    {formatAddress(row.company.location) && <span>{formatAddress(row.company.location)}</span>}
                    <RankingWhy explanation={rankingExplanation(world, row.company, { rank: index + 1, dimension: "opportunity", fitScore: row.fit })} />
                    <span><b>Why this company?</b> {row.qualification.label} with opportunity {scoreLabel(row)}; {row.qualification.gaps.length ? `missing ${row.qualification.gaps.join(", ")}` : `estimated revenue ${money(row.revenue)}`}.</span>
                    <span><b>Why now?</b> {whyNow(row.signals)}</span>
                    <span><b>Next best action:</b> {nextBestAction(row)}. {recommendedOutreach(row.company, row.contact?.name)}</span>
                    <span className="link-row">
                      {companyLinks(row.company).map((link) => <ExternalLink key={link.label} href={link.url} label={link.label} />)}
                      {row.signals[0] && <ExternalLink href={row.signals[0].source_url} label="Top signal source" />}
                    </span>
                    <AskButton
                      label="Explain ranking"
                      prompt={explainRankingPrompt(row.company.name, `Prospecting rank #${index + 1}. ${rankingExplanation(world, row.company, { rank: index + 1, dimension: "opportunity", fitScore: row.fit }).summary} ${row.qualification.label}, missing ${row.qualification.gaps.join(", ") || "none"}, contact ${row.contact?.name ?? "not available"}.`)}
                    />
                    <AskButton
                      label="Draft outreach"
                      prompt={outreachPrompt(row.company, `Prospecting card. Why now: ${whyNow(row.signals)} Contact: ${row.contact?.name ?? "not available"}. ${row.qualification.label}, opportunity ${row.opportunity}, missing ${row.qualification.gaps.join(", ") || "none"}.`)}
                    />
                    <button type="button" onClick={() => openDeliverableWizard({ accountId: row.company.id, startStep: "pick" })}>Create deliverable</button>
                    <DemoActionButton
                      label="Create CRM Task"
                      action={{
                        action: "crm_task",
                        title: "Create CRM Task",
                        accountName: row.company.name,
                        evidence: row.signals[0]?.source_quote,
                      }}
                    />
                  </div>
                )}
              </span>
              <span className="prospect-card-score">
                <button type="button" onClick={() => setState({ activeCompanyId: row.company.id })}>Open dossier</button>
                <button type="button" onClick={() => setExpandedProspectId(expanded ? null : row.company.id)}>
                  {expanded ? "Hide" : "Details"}
                </button>
              </span>
            </article>
            );
          })}
          {topProspects.length === 0 && (
            <EmptyState headline="No new prospects" body="No accounts currently match the prospecting filters for this market." icon="accounts" />
          )}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Nearby market-based prospects</h2>
          </div>
          {marketProspects.map((row) => (
            <article key={row.company.id} className="current-mini-row">
              <strong>{row.company.name}</strong>
              <span>{row.company.location.city} · {row.qualification.label} · opportunity {scoreLabel(row)}</span>
              <span>Next best action: {nextBestAction(row)}</span>
              {formatAddress(row.company.location) && <span>{formatAddress(row.company.location)}</span>}
              <em>{row.contact ? `Call ${row.contact.name}` : "Contact discovery needed"}</em>
              <span className="link-row">{companyLinks(row.company).map((link) => <ExternalLink key={link.label} href={link.url} label={link.label} />)}</span>
              <button type="button" onClick={() => setState({ activeCompanyId: row.company.id })}>Open dossier</button>
              <AskButton
                label="Why this account?"
                prompt={explainRankingPrompt(row.company.name, `Market-based prospect. City ${row.company.location.city}, ${row.qualification.label}, opportunity ${row.opportunity}, contact ${row.contact?.name ?? "not available"}, missing ${row.qualification.gaps.join(", ") || "none"}.`)}
              />
            </article>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Recommended next actions</h2>
          </div>
          {recommendedActions.map((r) => (
            <article key={r.subject_id} className="rec-row">
              <span className={`rec-tag rec-${r.action}`} title={actionDescription(r.action)}>
                {actionLabel(r.action)}
              </span>
              <span className="rec-name">{nameOf(r.subject_id)}</span>
              <span className="muted">{r.reason}</span>
              <button type="button" onClick={() => setState({ activeCompanyId: r.subject_id })}>Open dossier</button>
              <AskButton
                label="What next?"
                prompt={nextActionPrompt(nameOf(r.subject_id), `Prospecting recommendation: ${actionLabel(r.action)}. Priority ${r.priority}. Reason: ${r.reason}.`)}
              />
            </article>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Buying signals</h2>
          </div>
          {buyingSignals.map((signal) => (
            <article key={signal.id} className="current-signal-row">
              <span className="sig-type">{titleCase(signal.event_type)}</span>
              <strong>{nameOf(signal.subject_id)}</strong>
              <span>{signal.source_quote}</span>
              <span className="link-row">
                <ExternalLink href={signal.source_url} label="Source" />
                <ExternalLink href={signal.document_url} label="Document" />
              </span>
              <button type="button" onClick={() => setState({ activeCompanyId: signal.subject_id })}>Open dossier</button>
              <AskButton label="Expand signal" prompt={expandSignalPrompt(signal, nameOf(signal.subject_id))} />
            </article>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Outreach queue</h2>
          </div>
          {outreachQueue.map((row) => (
            <article key={row.company.id} className="outreach-row">
              <strong>{row.contact?.name}</strong>
              <span>{row.contact?.title} · {row.company.name}</span>
              <em>{recommendedOutreach(row.company, row.contact?.name)}</em>
              <button type="button" onClick={() => setState({ activeCompanyId: row.company.id })}>Open dossier</button>
              <AskButton
                label="Draft outreach"
                prompt={outreachPrompt(row.company, `Outreach queue contact ${row.contact?.name}, ${row.contact?.title}. Recommended next step: ${recommendedOutreach(row.company, row.contact?.name)}`)}
              />
              <DemoActionButton
                label="Add to Follow-up"
                action={{
                  action: "follow_up",
                  title: "Add to Follow-up",
                  accountName: row.company.name,
                  evidence: row.signals[0]?.source_quote,
                }}
              />
            </article>
          ))}
        </div>
      </section>
      {isImportOpen && <ImportListModal world={world} onClose={() => setIsImportOpen(false)} />}
    </div>
  );
}
