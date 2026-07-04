import type { World } from "../../app/useWorld.ts";
import { PROFILE } from "../../app/config.ts";
import { setState, useStore } from "../../store/store.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { isCurrentBusinessAccount, isProspectingAccount } from "../../brain/classification.ts";
import type { BusinessMotion } from "../../engine/brain/entities.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { RankingWhy } from "../ranking/RankingWhy.tsx";

const CURRENT_MOTIONS = new Set<BusinessMotion>([
  "manage_current_business",
  "grow_existing_business",
  "reduce_risk",
]);

const PROSPECT_MOTIONS = new Set<BusinessMotion>(["prospect_new_business"]);
const BUYING_EVENTS = new Set(["government_contract_award", "contract_win", "demand_spike", "hiring_surge", "capacity_constraint"]);
const RISK_EVENTS = new Set(["quality_escape", "capacity_constraint", "contract_loss", "pricing_pressure", "supplier_delay", "regulatory_change"]);

function money(n: number): string {
  return `$${(n / 1e6).toFixed(1)}M`;
}

export function Home({ world, cityWorld }: { world: World; cityWorld: World | null }) {
  const { city } = useStore();
  const open = world.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const currentCompanies = world.companies.filter(
    (c) => isCurrentBusinessAccount(c) || (c.business_motion ? CURRENT_MOTIONS.has(c.business_motion) : false),
  );
  const prospectCompanies = world.companies.filter(
    (c) => isProspectingAccount(c) || (c.business_motion ? PROSPECT_MOTIONS.has(c.business_motion) : false),
  );
  const currentIds = new Set(currentCompanies.map((c) => c.id));
  const prospectIds = new Set(prospectCompanies.map((c) => c.id));
  const currentOpen = open.filter((o) => currentIds.has(o.company_id) || o.account_status === "active_pipeline");
  const currentPipeline = currentOpen.reduce((sum, o) => sum + o.value, 0);
  const currentRiskSignals = world.analysis.valid.filter(
    (s) => currentIds.has(s.subject_id) && (s.business_motion === "reduce_risk" || RISK_EVENTS.has(s.event_type)),
  );
  const accountsNeedingAttention = currentCompanies.filter((c) => {
    const score = world.analysis.byId.get(c.id);
    const rec = world.analysis.recById.get(c.id);
    return (score?.dimensions.risk.score ?? 0) >= 50 || (score?.dimensions.capacityRisk.score ?? 0) >= 50 || rec?.priority === "high";
  }).length;
  const revenueAtRisk = currentCompanies.reduce((sum, c) => {
    const score = world.analysis.byId.get(c.id);
    const risky = (score?.dimensions.risk.score ?? 0) >= 50 || (score?.dimensions.capacityRisk.score ?? 0) >= 50;
    if (!risky) return sum;
    return sum + currentOpen.filter((o) => o.company_id === c.id).reduce((oppSum, o) => oppSum + o.value, 0);
  }, 0);
  const expansionOpportunities = currentCompanies.filter((c) => (world.analysis.byId.get(c.id)?.dimensions.opportunity.score ?? 0) >= 40).length;
  const highFitProspects = world.prospects.filter((p) => prospectIds.has(p.company.id) && p.fit.score >= 60).length;
  const prospectSignals = world.analysis.valid.filter(
    (s) => prospectIds.has(s.subject_id) && (s.business_motion === "prospect_new_business" || BUYING_EVENTS.has(s.event_type)),
  );
  const prospectOpportunityValue = world.opportunities
    .filter((o) => prospectIds.has(o.company_id) && o.stage !== "lost")
    .reduce((sum, o) => sum + o.value, 0);
  const outreachActions = world.prospects.filter((p) => prospectIds.has(p.company.id) && p.contact).length;
  const topActions = world.analysis.recommendations.filter((r) => r.priority !== "low").slice(0, 3);
  const localProspects = (cityWorld?.prospects ?? []).slice(0, 3);
  const marketLabel = city ?? "All Markets";
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="home">
      <section className="home-hero">
        <div>
          <p className="eyebrow">Static CRO demo · deterministic engine</p>
          <h1>{PROFILE.name} Enterprise Brain</h1>
          <p className="home-copy">
            Split every CRO decision into two modes: protect and grow the business you already have, or find the next accounts to pursue.
          </p>
        </div>
        <div className="home-actions">
          <button onClick={() => setState({ view: "current" })}>Manage Current Business</button>
          <button onClick={() => setState({ view: "prospecting" })}>Find New Business</button>
        </div>
      </section>

      <section className="home-mode-grid">
        <button className="home-mode-card" onClick={() => setState({ view: "current" })}>
          <span className="eyebrow">Manage Current Business</span>
          <strong>What existing business needs attention?</strong>
          <em>Customers, active pipeline, expansion, delivery risk, and recommended actions.</em>
          <span className="home-mode-metrics">
            <span><b>{accountsNeedingAttention}</b> accounts needing attention</span>
            <span><b>{money(currentPipeline)}</b> open pipeline</span>
            <span><b>{revenueAtRisk > 0 ? money(revenueAtRisk) : "None flagged"}</b> revenue at risk</span>
            <span><b>{expansionOpportunities}</b> expansion opportunities</span>
            <span><b>{currentRiskSignals.length}</b> risk signals</span>
          </span>
        </button>

        <button className="home-mode-card" onClick={() => setState({ view: "prospecting" })}>
          <span className="eyebrow">Find New Business</span>
          <strong>Who should we pursue next?</strong>
          <em>Target accounts, market-based prospects, buying signals, fit, revenue potential, and outreach.</em>
          <span className="home-mode-metrics">
            <span><b>{highFitProspects}</b> high-fit prospects</span>
            <span><b>{prospectSignals.length}</b> new buying signals</span>
            <span><b>{prospectOpportunityValue > 0 ? money(prospectOpportunityValue) : "No estimate"}</b> estimated opportunity value</span>
            <span><b>{outreachActions}</b> suggested outreach actions</span>
            <span><b>{city ? marketLabel : "All Markets"}</b> market view</span>
          </span>
        </button>
      </section>

      <section className="home-grid">
        <div className="home-panel">
          <div className="panel-head">
            <h2>What to do now</h2>
            <button onClick={() => setState({ view: "dashboard" })}>Dashboard</button>
          </div>
          {topActions.map((r) => (
            <button key={r.subject_id} className="home-row" onClick={() => setState({ activeCompanyId: r.subject_id })}>
              <span className={`rec-tag rec-${r.action}`} title={actionDescription(r.action)}>
                {actionLabel(r.action)}
              </span>
              <strong>{nameOf(r.subject_id)}</strong>
              <span>{r.reason}</span>
            </button>
          ))}
        </div>

        <div className="home-panel">
          <div className="panel-head">
            <h2>{city ? `In ${city}` : marketLabel}</h2>
            <button onClick={() => setState({ view: "map" })}>Map</button>
          </div>
          {localProspects.map((p, i) => (
            <button key={p.company.id} className="home-row" onClick={() => setState({ view: "map", activeCompanyId: p.company.id })}>
              <span className="rank-badge">#{i + 1}</span>
              <strong>{p.company.name}</strong>
              <span>
                Opportunity {p.opportunity}, fit {p.fit.score}%{p.contact ? `, call ${p.contact.name}` : ""}
                <RankingWhy explanation={rankingExplanation(cityWorld ?? world, p.company, { rank: i + 1, dimension: "opportunity", fitScore: p.fit.score })} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
