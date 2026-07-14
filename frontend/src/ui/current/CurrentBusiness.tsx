import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { accountStatus, businessMotionForAccount, getBusinessMotionLabel, isCurrentBusinessAccount } from "../../brain/classification.ts";
import type { AccountStatus, BusinessMotion, Company, Opportunity } from "../../engine/brain/entities.ts";
import type { Signal } from "../../engine/signals/contract.ts";
import { setState } from "../../store/store.ts";
import { explainAccountPrompt, expandSignalPrompt, nextActionPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { formatAddress } from "../../app/format.ts";
import { provenanceForRecord } from "../../app/provenance.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { RankingWhy } from "../ranking/RankingWhy.tsx";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";
import { EmptyState } from "../primitives.tsx";

const CURRENT_STATUSES = new Set<AccountStatus>([
  "current_customer",
  "active_pipeline",
  "past_customer",
  "partner",
]);

const CURRENT_MOTIONS = new Set<BusinessMotion>([
  "manage_current_business",
  "grow_existing_business",
  "reduce_risk",
]);

const RISK_EVENTS = new Set([
  "quality_escape",
  "capacity_constraint",
  "contract_loss",
  "pricing_pressure",
  "supplier_delay",
  "regulatory_change",
  "competitor_expansion",
]);

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

function riskLine(risk: number, capacity: number): string {
  if (risk === 0 && capacity === 0) return "No active risk signals";
  const parts: string[] = [];
  if (risk > 0) parts.push(`Risk ${risk}`);
  if (capacity > 0) parts.push(`Capacity ${capacity}`);
  return parts.join(" · ");
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isCurrentOpportunity(opp: Opportunity): boolean {
  return Boolean(
    (opp.account_status && CURRENT_STATUSES.has(opp.account_status)) ||
      (opp.business_motion && CURRENT_MOTIONS.has(opp.business_motion)),
  );
}

function isCurrentSignal(signal: Signal): boolean {
  return Boolean(
    (signal.account_status && CURRENT_STATUSES.has(signal.account_status)) ||
      (signal.business_motion && CURRENT_MOTIONS.has(signal.business_motion)) ||
      RISK_EVENTS.has(signal.event_type),
  );
}

function whyAccountMatters(world: World, company: Company): string {
  const score = world.analysis.byId.get(company.id);
  const openPipeline = world.opportunities
    .filter((o) => o.company_id === company.id && o.stage !== "won" && o.stage !== "lost")
    .reduce((sum, o) => sum + o.value, 0);
  const risk = score?.dimensions.risk.score ?? 0;
  const capacity = score?.dimensions.capacityRisk.score ?? 0;
  const opportunity = score?.dimensions.opportunity.score ?? 0;

  if (risk >= 60 || capacity >= 60) return `High risk signals need attention before they affect delivery or revenue.`;
  if (openPipeline > 0) return `${money(openPipeline)} in open pipeline is tied to this account.`;
  if (opportunity >= 50) return `Expansion signals show room to grow the relationship.`;
  return `${getBusinessMotionLabel(businessMotionForAccount(company))} based on current account context.`;
}

export function CurrentBusiness({ world }: { world: World }) {
  const [showAll, setShowAll] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const currentOpportunities = world.opportunities.filter(isCurrentOpportunity);
  const currentSignals = world.analysis.valid.filter(isCurrentSignal);
  const idsFromOpportunities = new Set(currentOpportunities.map((o) => o.company_id));
  const idsFromSignals = new Set(currentSignals.map((s) => s.subject_id));
  const currentCompanies = world.companies.filter(
    (c) =>
      isCurrentBusinessAccount(c) ||
      CURRENT_MOTIONS.has(businessMotionForAccount(c)) ||
      idsFromOpportunities.has(c.id) ||
      idsFromSignals.has(c.id),
  );
  const currentIds = new Set(currentCompanies.map((c) => c.id));
  const openPipeline = currentOpportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const wonContracts = currentOpportunities.filter((o) => o.stage === "won");
  const pipelineValue = openPipeline.reduce((sum, o) => sum + o.value, 0);
  const riskSignals = currentSignals
    .filter((s) => s.business_motion === "reduce_risk" || RISK_EVENTS.has(s.event_type))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
  const recommendations = world.analysis.recommendations
    .filter((r) => currentIds.has(r.subject_id) && r.priority !== "low")
    .slice(0, 8);
  const accountsNeedingAttention = currentCompanies
    .map((company) => {
      const score = world.analysis.byId.get(company.id);
      const rec = world.analysis.recById.get(company.id);
      const openValue = openPipeline.filter((o) => o.company_id === company.id).reduce((sum, o) => sum + o.value, 0);
      const attention =
        (score?.dimensions.risk.score ?? 0) +
        (score?.dimensions.capacityRisk.score ?? 0) +
        (rec?.priority === "high" ? 40 : rec?.priority === "medium" ? 20 : 0) +
        (openValue > 0 ? 15 : 0);
      return { company, score, rec, openValue, attention };
    })
    .filter((row) => row.attention > 0 && row.company.name.trim().length > 0)
    .sort((a, b) => b.attention - a.attention || a.company.name.localeCompare(b.company.name))
    .slice(0, 8);
  const expansionOpportunities = currentCompanies
    .map((company) => {
      const score = world.analysis.byId.get(company.id);
      const opportunity = score?.dimensions.opportunity.score ?? 0;
      return { company, opportunity, motion: businessMotionForAccount(company) };
    })
    .filter((row) => row.opportunity > 0 && row.motion !== "reduce_risk")
    .sort((a, b) => b.opportunity - a.opportunity || a.company.name.localeCompare(b.company.name))
    .slice(0, 6);
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const activeCustomerCount = currentCompanies.filter((c) => accountStatus(c) === "current_customer").length;
  const headline = accountsNeedingAttention[0]
    ? `${accountsNeedingAttention[0].company.name} needs the first look: risk ${accountsNeedingAttention[0].score?.dimensions.risk.score ?? 0}, capacity ${accountsNeedingAttention[0].score?.dimensions.capacityRisk.score ?? 0}${accountsNeedingAttention[0].openValue > 0 ? `, and ${money(accountsNeedingAttention[0].openValue)} open pipeline` : ""}.`
    : "No current-business account needs immediate attention in the active market.";
  const selectedRow = useMemo(
    () => accountsNeedingAttention.find((row) => row.company.id === (selectedCompanyId ?? accountsNeedingAttention[0]?.company.id)) ?? accountsNeedingAttention[0],
    [accountsNeedingAttention, selectedCompanyId],
  );
  const visibleAttentionRows = showAll ? accountsNeedingAttention : accountsNeedingAttention.slice(0, 5);

  function selectCompany(companyId: string) {
    setSelectedCompanyId(companyId);
    setState({ activeCompanyId: companyId });
  }

  return (
    <div className="current-workspace">
      <section className="current-head">
        <p className="eyebrow">Current business</p>
        <h1>What existing business needs attention?</h1>
        <p>{headline}</p>
      </section>

      <section className="current-summary">
        <div>
          <span>Existing accounts</span>
          <strong>{activeCustomerCount}</strong>
          <em>{currentCompanies.length} accounts in scope</em>
        </div>
        <div>
          <span>Open pipeline</span>
          <strong>{money(pipelineValue)}</strong>
          <em>{openPipeline.length} active opportunities</em>
        </div>
        <div>
          <span>Risk signals</span>
          <strong>{riskSignals.length}</strong>
          <em>delivery, capacity, supplier, or revenue risk</em>
        </div>
        <div>
          <span>Recommended actions</span>
          <strong>{recommendations.length}</strong>
          <em>non-low priority actions</em>
        </div>
      </section>

      <section className="current-grid">
        <div className="current-panel current-panel-wide">
          <div className="panel-head">
            <h2>Accounts Needing Attention</h2>
          </div>
          {visibleAttentionRows.map(({ company, score, rec, openValue }) => (
            <button
              key={company.id}
              className={selectedRow?.company.id === company.id ? "current-account-row active" : "current-account-row"}
              onClick={() => selectCompany(company.id)}
            >
              <span>
                <strong>{company.name}</strong>
                <em>{titleCase(accountStatus(company))} · {getBusinessMotionLabel(businessMotionForAccount(company))}</em>
                {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(company)} />}
              </span>
              <span>
                {whyAccountMatters(world, company)}
              </span>
              <span className="current-score">
                {riskLine(score?.dimensions.risk.score ?? 0, score?.dimensions.capacityRisk.score ?? 0)}
                {openValue > 0 ? ` · ${money(openValue)} open` : ""}
                {rec ? ` · ${actionLabel(rec.action)}` : ""}
              </span>
              <AskChatpilButton
                label="Explain"
                prompt={explainAccountPrompt(company, `Current Business attention row. Risk ${score?.dimensions.risk.score ?? 0}, capacity ${score?.dimensions.capacityRisk.score ?? 0}, open pipeline ${money(openValue)}. Recommendation ${rec ? actionLabel(rec.action) : "none"}.`)}
              />
            </button>
          ))}
          {visibleAttentionRows.length === 0 && (
            <EmptyState headline="No accounts need attention" body="Current accounts are healthy — nothing is flagged for risk or capacity review right now." icon="accounts" />
          )}
          {accountsNeedingAttention.length > 5 && (
            <button className="quiet-expander" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show top 5" : `View all ${accountsNeedingAttention.length}`}
            </button>
          )}
        </div>

        {selectedRow && (
          <div className="current-panel current-detail-card">
            <div className="panel-head">
              <h2>{selectedRow.company.name}</h2>
            </div>
            <p>{whyAccountMatters(world, selectedRow.company)}</p>
            {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(selectedRow.company)} />}
            <RankingWhy explanation={rankingExplanation(world, selectedRow.company, { rank: accountsNeedingAttention.findIndex((row) => row.company.id === selectedRow.company.id) + 1, dimension: "risk" })} />
            <span className="current-score">
              {riskLine(selectedRow.score?.dimensions.risk.score ?? 0, selectedRow.score?.dimensions.capacityRisk.score ?? 0)}
              {selectedRow.openValue > 0 ? ` · ${money(selectedRow.openValue)} open pipeline` : ""}
              {selectedRow.rec ? ` · ${actionLabel(selectedRow.rec.action)}` : ""}
            </span>
          </div>
        )}

        {showAll && <div className="current-panel">
          <div className="panel-head">
            <h2>Recommended Actions</h2>
          </div>
          {recommendations.map((r) => (
            <button key={r.subject_id} className="rec-row" onClick={() => setState({ activeCompanyId: r.subject_id })}>
              <span className={`rec-tag rec-${r.action}`} title={actionDescription(r.action)}>
                {actionLabel(r.action)}
              </span>
              <span className="rec-name">{nameOf(r.subject_id)}</span>
              <span className="muted">{r.reason}</span>
              <AskChatpilButton
                label="What next?"
                prompt={nextActionPrompt(nameOf(r.subject_id), `Current Business recommendation: ${actionLabel(r.action)}. Priority ${r.priority}. Reason: ${r.reason}.`)}
              />
            </button>
          ))}
        </div>}

        {showAll && <div className="current-panel">
          <div className="panel-head">
            <h2>Expansion Opportunities</h2>
          </div>
          {expansionOpportunities.map(({ company, opportunity, motion }) => (
            <button key={company.id} className="current-mini-row" onClick={() => setState({ activeCompanyId: company.id })}>
              <strong>{company.name}</strong>
              <span>{getBusinessMotionLabel(motion)}</span>
              {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(company)} />}
              {formatAddress(company.location) && <span>{formatAddress(company.location)}</span>}
              <em>Opportunity {opportunity}: {whyAccountMatters(world, company)}</em>
              <AskChatpilButton
                label="Explain"
                prompt={explainAccountPrompt(company, `Expansion opportunity. Opportunity score ${opportunity}. ${whyAccountMatters(world, company)}`)}
              />
            </button>
          ))}
        </div>}

        {showAll && <div className="current-panel">
          <div className="panel-head">
            <h2>Current Pipeline / Contracts</h2>
          </div>
          {[...openPipeline, ...wonContracts].slice(0, 10).map((opp) => (
            <button key={opp.id} className="current-pipeline-row" onClick={() => setState({ activeCompanyId: opp.company_id })}>
              <span className={`opp-stage stage-${opp.stage}`}>{opp.stage}</span>
              <strong>{nameOf(opp.company_id)}</strong>
              <span>{opp.name}</span>
              <em>{money(opp.value)}</em>
              {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(opp)} />}
              <span className="link-row">
                <ExternalLink href={opp.contract_url} label="Contract" />
                <ExternalLink href={opp.document_url} label="Document" />
              </span>
            </button>
          ))}
        </div>}

        {showAll && <div className="current-panel">
          <div className="panel-head">
            <h2>Risk Signals</h2>
          </div>
          {riskSignals.map((signal) => (
            <button key={signal.id} className="current-signal-row" onClick={() => setState({ activeCompanyId: signal.subject_id })}>
              <span className="sig-type">{titleCase(signal.event_type)}</span>
              <strong>{nameOf(signal.subject_id)}</strong>
              {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(signal)} />}
              <span>{signal.source_quote}</span>
              <span className="link-row">
                <ExternalLink href={signal.source_url} label="Source" />
                <ExternalLink href={signal.document_url} label="Document" />
              </span>
              <AskChatpilButton label="Expand signal" prompt={expandSignalPrompt(signal, nameOf(signal.subject_id))} />
            </button>
          ))}
        </div>}
      </section>
    </div>
  );
}
