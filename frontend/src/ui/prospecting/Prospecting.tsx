import type { World } from "../../app/useWorld.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { accountStatus, isProspectingAccount } from "../../brain/classification.ts";
import type { AccountStatus, BusinessMotion, Company } from "../../engine/brain/entities.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import { setState, useStore } from "../../store/store.ts";
import { explainRankingPrompt, expandSignalPrompt, nextActionPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { companyLinks, formatAddress } from "../../app/format.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { RankingWhy } from "../ranking/RankingWhy.tsx";
import { DemoActionButton } from "../actions/DemoActionButton.tsx";

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
  return Math.round(signals.reduce((sum, s) => sum + s.confidence * 100, 0) / Math.max(signals.length, 1));
}

function isProspectingSignal(signal: Signal): boolean {
  return Boolean(
    (signal.account_status && PROSPECT_STATUSES.has(signal.account_status)) ||
      (signal.business_motion && PROSPECT_MOTIONS.has(signal.business_motion)) ||
      BUYING_EVENTS.has(signal.event_type),
  );
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

function visitReason(row: { opportunity: number; fit: number; signals: Signal[]; contact?: { name: string } }): string {
  const signal = row.signals[0];
  const contact = row.contact ? ` and ${row.contact.name} is available` : "";
  if (signal) return `Opportunity ${row.opportunity}, fit ${row.fit}%, and a ${titleCase(signal.event_type)} signal${contact}.`;
  return `Opportunity ${row.opportunity} and fit ${row.fit}% make this a practical market stop${contact}.`;
}

export function Prospecting({ world }: { world: World }) {
  const { city } = useStore();
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
        .filter((s) => s.subject_id === company.id)
        .sort((a, b) => b.confidence - a.confidence);
      const contact = world.contacts.find((c) => c.company_id === company.id);
      const revenue = world.opportunities
        .filter((o) => o.company_id === company.id && o.stage !== "lost")
        .reduce((sum, o) => sum + o.value, 0);
      const opportunity = score?.dimensions.opportunity.score ?? rankedProspect?.opportunity ?? 0;
      const fit = rankedProspect?.fit.score ?? 0;
      const urgency = opportunity + fit + signalStrength(signals) + (contact ? 10 : 0) + (revenue > 0 ? 12 : 0);
      return { company, score, rankedProspect, signals, contact, revenue, opportunity, fit, urgency };
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
    .filter((s) => prospectIds.has(s.subject_id))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const outreachQueue = prospectRows.filter((row) => row.contact).slice(0, 8);
  const recommendedActions = world.analysis.recommendations
    .filter((r) => prospectIds.has(r.subject_id) && r.priority !== "low")
    .slice(0, 8);
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const totalRevenue = prospectRows.reduce((sum, row) => sum + row.revenue, 0);
  const marketLabel = selectedMarket ?? "All Markets";
  const visitPlanTitle = selectedMarket ? `${selectedMarket} Visit Plan` : "National Target List";

  return (
    <div className="prospecting-workspace">
      <section className="current-head">
        <p className="eyebrow">Prospecting</p>
        <h1>Who should we pursue next?</h1>
        <p>
          New-logo and target-account discovery, ranked by fit, buying signal strength, revenue potential, geography,
          contact availability, and urgency.
        </p>
      </section>

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
          <em>estimated from demo pipeline records</em>
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
                : "Select a city for an in-market visit plan. For now, these are the strongest national targets from the demo data."}
            </p>
          </div>
          <button onClick={() => setState({ view: "map" })}>{selectedMarket ? "Open Map" : "Choose on Map"}</button>
        </div>
        <div className="visit-plan-list">
          {visitPlanRows.map((row, index) => {
            const evidence = row.signals[0]?.source_quote ?? "No validated signal attached in demo data.";
            return (
              <div key={row.company.id} className="visit-plan-card">
                <span className="rank-badge">#{index + 1}</span>
                <div>
                  <strong>{row.company.name}</strong>
                  <em>{formatAddress(row.company.location) ?? row.company.location.city}</em>
                  <p>{visitReason(row)}</p>
                  <p><b>Talking point:</b> {recommendedOutreach(row.company, row.contact?.name)}</p>
                  <small>{evidence}</small>
                  <div className="link-row">
                    {row.signals[0] && <ExternalLink href={row.signals[0].source_url} label="Source" />}
                    <AskChatpilButton
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
                </div>
                <div className="visit-plan-meta">
                  <span>Fit {row.fit}%</span>
                  <span>Opportunity {row.opportunity}</span>
                  <span>{row.contact ? row.contact.name : "Find contact"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="prospecting-grid">
        <div className="current-panel current-panel-wide">
          <div className="panel-head">
            <h2>Top New Prospects</h2>
            <button onClick={() => setState({ view: "map" })}>Open Map</button>
          </div>
          {topProspects.map((row, index) => (
            <button key={row.company.id} className="prospect-card" onClick={() => setState({ activeCompanyId: row.company.id })}>
              <span className="rank-badge">#{index + 1}</span>
              <span className="prospect-card-main">
                <strong>{row.company.name}</strong>
                <em>{row.company.location.city} · {titleCase(accountStatus(row.company))}</em>
                {formatAddress(row.company.location) && <span>{formatAddress(row.company.location)}</span>}
                <RankingWhy explanation={rankingExplanation(world, row.company, { rank: index + 1, dimension: "opportunity", fitScore: row.fit })} />
                <span><b>Why this company?</b> Fit {row.fit}% with opportunity {row.opportunity}; estimated revenue {money(row.revenue)}.</span>
                <span><b>Why now?</b> {whyNow(row.signals)}</span>
                <span><b>Next:</b> {recommendedOutreach(row.company, row.contact?.name)}</span>
                <span className="link-row">
                  {companyLinks(row.company).map((link) => <ExternalLink key={link.label} href={link.url} label={link.label} />)}
                  {row.signals[0] && <ExternalLink href={row.signals[0].source_url} label="Top signal source" />}
                </span>
              </span>
              <span className="prospect-card-score">
                Signal {signalStrength(row.signals)} · {row.contact ? "Contact ready" : "Find contact"}
                <AskChatpilButton
                  label="Explain ranking"
                  prompt={explainRankingPrompt(row.company.name, `Prospecting rank #${index + 1}. ${rankingExplanation(world, row.company, { rank: index + 1, dimension: "opportunity", fitScore: row.fit }).summary} Estimated revenue ${money(row.revenue)}, signal strength ${signalStrength(row.signals)}, contact ${row.contact?.name ?? "not available"}.`)}
                />
                <AskChatpilButton
                  label="Draft outreach"
                  prompt={outreachPrompt(row.company, `Prospecting card. Why now: ${whyNow(row.signals)} Contact: ${row.contact?.name ?? "not available"}. Fit ${row.fit}%, opportunity ${row.opportunity}.`)}
                />
                <DemoActionButton
                  label="Create CRM Task"
                  action={{
                    action: "crm_task",
                    title: "Create CRM Task",
                    accountName: row.company.name,
                    evidence: row.signals[0]?.source_quote,
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Nearby / Market-Based Prospects</h2>
          </div>
          {marketProspects.map((row) => (
            <button key={row.company.id} className="current-mini-row" onClick={() => setState({ activeCompanyId: row.company.id })}>
              <strong>{row.company.name}</strong>
              <span>{row.company.location.city} · fit {row.fit}% · opportunity {row.opportunity}</span>
              {formatAddress(row.company.location) && <span>{formatAddress(row.company.location)}</span>}
              <em>{row.contact ? `Call ${row.contact.name}` : "Contact discovery needed"}</em>
              <span className="link-row">{companyLinks(row.company).map((link) => <ExternalLink key={link.label} href={link.url} label={link.label} />)}</span>
              <AskChatpilButton
                label="Why this account?"
                prompt={explainRankingPrompt(row.company.name, `Market-based prospect. City ${row.company.location.city}, fit ${row.fit}%, opportunity ${row.opportunity}, contact ${row.contact?.name ?? "not available"}.`)}
              />
            </button>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Recommended Next Actions</h2>
          </div>
          {recommendedActions.map((r) => (
            <button key={r.subject_id} className="rec-row" onClick={() => setState({ activeCompanyId: r.subject_id })}>
              <span className={`rec-tag rec-${r.action}`} title={actionDescription(r.action)}>
                {actionLabel(r.action)}
              </span>
              <span className="rec-name">{nameOf(r.subject_id)}</span>
              <span className="muted">{r.reason}</span>
              <AskChatpilButton
                label="What next?"
                prompt={nextActionPrompt(nameOf(r.subject_id), `Prospecting recommendation: ${actionLabel(r.action)}. Priority ${r.priority}. Reason: ${r.reason}.`)}
              />
            </button>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Buying Signals</h2>
          </div>
          {buyingSignals.map((signal) => (
            <button key={signal.id} className="current-signal-row" onClick={() => setState({ activeCompanyId: signal.subject_id })}>
              <span className="sig-type">{titleCase(signal.event_type)}</span>
              <strong>{nameOf(signal.subject_id)}</strong>
              <span>{signal.source_quote}</span>
              <span className="link-row">
                <ExternalLink href={signal.source_url} label="Source" />
                <ExternalLink href={signal.document_url} label="Document" />
              </span>
              <AskChatpilButton label="Expand signal" prompt={expandSignalPrompt(signal, nameOf(signal.subject_id))} />
            </button>
          ))}
        </div>

        <div className="current-panel">
          <div className="panel-head">
            <h2>Outreach Queue</h2>
          </div>
          {outreachQueue.map((row) => (
            <button key={row.company.id} className="outreach-row" onClick={() => setState({ activeCompanyId: row.company.id })}>
              <strong>{row.contact?.name}</strong>
              <span>{row.contact?.title} · {row.company.name}</span>
              <em>{recommendedOutreach(row.company, row.contact?.name)}</em>
              <AskChatpilButton
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
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
