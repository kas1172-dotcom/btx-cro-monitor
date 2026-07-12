import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { PROFILE } from "../../app/config.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import { actionLabel } from "../../app/actionLabels.ts";
import { formatAddress } from "../../app/format.ts";
import { signalHeadline, signalSourceDate, signalSourceName } from "../../app/signalProvenance.ts";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";
import { provenanceForRecord } from "../../app/provenance.ts";
import { WorkItemList } from "./WorkItemList.tsx";
import { deriveWorkItems } from "../../app/workItems.ts";

function money(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`;
}

function relationshipBackedSignals(world: World, accountId: string) {
  return world.analysis.valid
    .filter((signal) =>
      signal.scope === "specific_account" &&
      signal.subject_id === accountId &&
      (signal.relationships ?? []).some((relationship) => relationship.canonical_account_id === accountId)
    )
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
}

export function Account360({ world }: { world: World }) {
  const accountRows = useMemo(() => {
    return world.companies
      .filter((company) => company.relationship === "customer" || company.relationship === "target")
      .map((company) => ({
        company,
        score: world.analysis.byId.get(company.id),
        rec: world.analysis.recById.get(company.id),
        linkedSignals: relationshipBackedSignals(world, company.id),
        openPipeline: world.opportunities.filter((opp) => opp.company_id === company.id && opp.stage !== "won" && opp.stage !== "lost").reduce((sum, opp) => sum + opp.value, 0),
      }))
      .sort((a, b) =>
        (b.score?.dimensions.opportunity.score ?? 0) - (a.score?.dimensions.opportunity.score ?? 0) ||
        b.linkedSignals.length - a.linkedSignals.length ||
        a.company.name.localeCompare(b.company.name)
      );
  }, [world]);
  const [selectedId, setSelectedId] = useState(accountRows[0]?.company.id ?? "");
  const selected = accountRows.find((row) => row.company.id === selectedId) ?? accountRows[0];
  const contacts = selected ? world.contacts.filter((contact) => contact.company_id === selected.company.id) : [];
  const deals = selected ? world.opportunities.filter((opp) => opp.company_id === selected.company.id) : [];
  const facilities = selected ? world.facilities.filter((facility) => facility.company_id === selected.company.id) : [];
  const workItems = selected ? deriveWorkItems(world).filter((item) => item.canonical_account_id === selected.company.id).slice(0, 5) : [];

  if (!selected) {
    return (
      <section className="surface-page" data-surface-component="surface-account-360">
        <div className="quiet-view-head">
          <p className="eyebrow">Accounts</p>
          <h1>No canonical accounts are available.</h1>
        </div>
      </section>
    );
  }

  const company = selected.company;
  const score = selected.score;
  const rec = selected.rec;
  const fit = scoreFit(company.needs, PROFILE.capabilities);

  return (
    <section className="surface-page account360" data-surface-component="surface-account-360">
      <div className="quiet-view-head">
        <p className="eyebrow">Accounts / Account 360</p>
        <h1>{company.name}</h1>
        <p>{formatAddress(company.location) ?? company.location.city} · canonical id {company.canonical_account_id ?? company.id}</p>
      </div>

      <div className="account360-layout">
        <aside className="account360-list">
          {accountRows.map((row) => (
            <button key={row.company.id} className={row.company.id === company.id ? "active" : ""} onClick={() => setSelectedId(row.company.id)}>
              <strong>{row.company.name}</strong>
              <span>opp {row.score?.dimensions.opportunity.score ?? 0} · risk {row.score?.dimensions.risk.score ?? 0}</span>
              <em>{row.linkedSignals.length} linked signal{row.linkedSignals.length === 1 ? "" : "s"} · {money(row.openPipeline)} open</em>
            </button>
          ))}
        </aside>

        <div className="account360-detail">
          <div className="account360-kpis">
            <div><span>Health</span><strong>{score?.dimensions.risk.score ?? 0} risk</strong></div>
            <div><span>Opportunity</span><strong>{score?.dimensions.opportunity.score ?? 0}</strong></div>
            <div><span>Capacity fit</span><strong>{fit.score}%</strong></div>
            <div><span>Pipeline</span><strong>{money(selected.openPipeline)}</strong></div>
          </div>

          {rec && (
            <section className="surface-panel">
              <div className="panel-head"><h2>Recommended action</h2></div>
              <p><strong>{actionLabel(rec.action)}</strong> - {rec.reason}</p>
            </section>
          )}

          <section className="surface-panel">
            <div className="panel-head"><h2>Relationship-backed signals</h2></div>
            <div className="signal-mini-list">
              {selected.linkedSignals.map((signal) => (
                <article key={signal.id}>
                  <strong>{signalHeadline(signal)}</strong>
                  <span>{signalSourceName(signal)} {signalSourceDate(signal)} · confidence {(signal.confidence * 100).toFixed(0)}%</span>
                  <em>{signal.source_quote}</em>
                  {world.dataMode === "hybrid" && <ProvenanceBadge label={provenanceForRecord(signal)} />}
                </article>
              ))}
              {selected.linkedSignals.length === 0 && (
                <div className="rail-quiet-empty">No relationship-backed account signals. Market signals stay portfolio-level until a relationship record exists.</div>
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
              <div className="panel-head"><h2>Capacity fit</h2></div>
              <p>{fit.matched.length ? fit.matched.join(", ") : "No direct capability overlap."}</p>
              <p className="muted">{facilities.length} facility record{facilities.length === 1 ? "" : "s"} in the current operating snapshot.</p>
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
