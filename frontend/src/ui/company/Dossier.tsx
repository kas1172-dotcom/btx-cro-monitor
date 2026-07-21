// The sale dossier: everything a rep needs to make the call, all from the
// deterministic engine. Opportunity score + its trace, fit to the client's
// capabilities, recent buying signals, and who to call. Every number is traceable.

import { useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import { groupTrace, summarizeGroups } from "../../engine/decision/explain.ts";
import { CONFIG, PROFILE } from "../../app/config.ts";
import { narrateOpportunity, findingMeaning } from "../../app/narrate.ts";
import { getInsight } from "../../app/insights.ts";
import { pipelineHealth } from "../../engine/decision/health.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { explainAccountPrompt, expandSignalPrompt, nextActionPrompt } from "../../app/copilotPrompts.ts";
import { companyLinks, formatAddress, plural } from "../../app/format.ts";
import { provenanceForRecord } from "../../app/provenance.ts";
import { displayLabel } from "../../app/displayLabels.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { ExternalLink } from "../common/ExternalLink.tsx";
import { DemoActionButton } from "../actions/DemoActionButton.tsx";
import { ProvenanceBadge } from "../common/ProvenanceBadge.tsx";
import { runAgent, type AgentId } from "../../agents/runAgent.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";
import { setState } from "../../store/store.ts";

export function Dossier({ world, companyId }: { world: World; companyId: string }) {
  const [busyDeliverable, setBusyDeliverable] = useState<AgentId | null>(null);
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;
  const activeCompany = company;

  const score = world.analysis.byId.get(companyId);
  const fit = scoreFit(company.needs, PROFILE.capabilities);
  const contacts = world.contacts.filter((k) => k.company_id === companyId);
  const signals = world.analysis.valid
    .filter((s) => s.subject_id === companyId)
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  const opp = score?.dimensions.opportunity;
  const oppGroups = opp ? groupTrace(opp, CONFIG) : [];
  const insight = getInsight(companyId);
  const narrative = insight?.opportunity ?? narrateOpportunity(company, opp?.score ?? 0, fit, signals);
  const rec = world.analysis.recById.get(companyId);
  const health = pipelineHealth(world.opportunities.filter((o) => o.company_id === companyId));
  const facilities = world.facilities.filter((f) => f.company_id === companyId);
  const openOpps = world.opportunities
    .filter((o) => o.company_id === companyId && o.stage !== "won" && o.stage !== "lost")
    .sort((a, b) => b.value - a.value);
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);
  const fmtM = (v: number) => `$${(v / 1e6).toFixed(1)}M`;
  const companyAddress = formatAddress(company.location);
  const links = companyLinks(company);
  async function createDeliverable(agentId: AgentId) {
    setBusyDeliverable(agentId);
    try {
      const inputs = agentId === "board_deck"
        ? { quarter: "Q2 2026", audience: "board" }
        : agentId === "outreach"
          ? { accountId: activeCompany.id, instructions: "Keep it concise and tied to the strongest available evidence." }
          : { accountId: activeCompany.id };
      const deliverable = await runAgent(agentId, inputs, world);
      saveDeliverable(deliverable);
      setState({ activeDeliverable: deliverable, activeCompanyId: null, activeTab: deliverable.brainArea, brainResponse: null, activeAnalysisSpec: null });
    } finally {
      setBusyDeliverable(null);
    }
  }

  return (
    <div className="dossier">
      <div className="dossier-head">
        <h3>{company.name}</h3>
        <span className={`pill rel-${company.relationship}`}>{displayLabel(company.relationship)}</span>
        <ProvenanceBadge label={provenanceForRecord(company)} />
        <div className="muted">
          {company.location.city}
          {facilities.length > 0 && ` · ${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}`}
        </div>
        {companyAddress && <div className="muted">{companyAddress}</div>}
        {links.length > 0 && (
          <div className="link-row">
            {links.map((link) => <ExternalLink key={link.label} href={link.url} label={link.label} />)}
          </div>
        )}
      </div>

      <section className="dossier-actions">
        <h4>Create deliverable</h4>
        <div className="dossier-action-row">
          <button onClick={() => void createDeliverable("meeting_brief")} disabled={busyDeliverable !== null}>{busyDeliverable === "meeting_brief" ? "Creating..." : "Meeting brief"}</button>
          <button onClick={() => void createDeliverable("outreach")} disabled={busyDeliverable !== null}>{busyDeliverable === "outreach" ? "Creating..." : "Outreach"}</button>
          <button onClick={() => void createDeliverable("sales_pitch")} disabled={busyDeliverable !== null}>{busyDeliverable === "sales_pitch" ? "Creating..." : "Sales pitch"}</button>
          <button onClick={() => void createDeliverable("capabilities_assessment")} disabled={busyDeliverable !== null}>{busyDeliverable === "capabilities_assessment" ? "Creating..." : "Capabilities assessment"}</button>
        </div>
      </section>

      {rec && (
        <div className={`rec rec-${rec.action}`}>
          <span className="rec-action" title={actionDescription(rec.action)}>
            {actionLabel(rec.action)}
          </span>
          <span className="rec-reason">{rec.reason}</span>
          <AskChatpilButton
            label="Explain"
            prompt={nextActionPrompt(company.name, `Dossier recommendation: ${actionLabel(rec.action)}. Reason: ${rec.reason}.`)}
          />
          <DemoActionButton
            label="Create CRM Task"
            action={{
              action: "crm_task",
              title: "Create CRM Task",
              accountName: company.name,
              accountId: company.id,
              evidence: rec.reason,
              workItemType: "account_action",
            }}
          />
        </div>
      )}

      <div className="metrics">
        <div className="metric">
          <div className="metric-val">{opp?.score ?? 0}</div>
          <div className="metric-lbl">opportunity</div>
        </div>
        <div className="metric">
          <div className="metric-val">{fit.score}%</div>
          <div className="metric-lbl">fit to {PROFILE.name}</div>
        </div>
        <div className="metric">
          <div className="metric-val">{health}</div>
          <div className="metric-lbl">pipeline health</div>
        </div>
      </div>

      <section>
        <h4>Why this is a target</h4>
        <p className="narrative">{narrative}</p>
        {oppGroups.length > 0 && <p className="audit">scoring: {summarizeGroups(oppGroups)}</p>}
        <AskChatpilButton
          label="Why this account?"
          prompt={explainAccountPrompt(company, `Dossier narrative: ${narrative}. Opportunity ${opp?.score ?? 0}, fit ${fit.score}%, pipeline health ${health}.`)}
        />
      </section>

      {openOpps.length > 0 && (
        <section id="dossier-pipeline">
          <h4>Pipeline — {fmtM(pipelineValue)} open ({plural(openOpps.length, "deal")})</h4>
          <ul className="opps">
            {openOpps.slice(0, 6).map((o) => (
              <li key={o.id}>
                <span className={`opp-stage stage-${o.stage}`}>{o.stage}</span>
                <span className="opp-name">{o.name}</span>
                <span className="opp-val">{fmtM(o.value)}</span>
                <ProvenanceBadge label={provenanceForRecord(o)} />
                <ExternalLink href={o.contract_url} label="Contract" />
                <ExternalLink href={o.document_url} label="Document" />
                <ExternalLink href={o.source_url} label="Source" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {facilities.length > 0 && (
        <section>
          <h4>Facilities</h4>
          <ul className="contacts">
            {facilities.map((f) => (
              <li key={f.id}>
                <strong>{f.kind}</strong> — {formatAddress(f) ?? f.city}
                <ProvenanceBadge label="Seeded baseline" />
                <div className="link-row"><ExternalLink href={f.source_url} label="ERP source" /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>How {PROFILE.name} can serve them</h4>
        {fit.matched.length ? (
          <div className="tags">{fit.matched.map((m) => <span key={m} className="tag good">{m}</span>)}</div>
        ) : (
          <p className="muted">No capability overlap — likely a teaming play, not a direct sale.</p>
        )}
        {fit.missing.length > 0 && (
          <div className="tags">{fit.missing.map((m) => <span key={m} className="tag gap">{m}</span>)}</div>
        )}
      </section>

      <section>
        <h4>Buying signals ({signals.length})</h4>
        <ul className="signals">
          {signals.map((s) => {
            const meaning = insight?.findings?.[s.id] ?? findingMeaning(s.event_type);
            return (
              <li key={s.id}>
                <span className="ev">{displayLabel(s.event_type)}</span>
                <ProvenanceBadge label={provenanceForRecord(s)} />
                <span className="q">{s.source_quote}</span>
                {meaning && <span className="meaning">{meaning}</span>}
                <span className="conf">conf {s.confidence.toFixed(2)}</span>
                <div className="link-row">
                  <ExternalLink href={s.source_url} label="Source" />
                  <ExternalLink href={s.document_url} label="Document" />
                </div>
                <AskChatpilButton label="Expand signal" prompt={expandSignalPrompt(s, company.name)} />
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h4>Who to call</h4>
        <ul className="contacts">
          {contacts.map((k) => (
            <li key={k.id}>
              <strong>{k.name}</strong> — {k.title}
              <ProvenanceBadge label={provenanceForRecord(k)} />
            </li>
          ))}
          {contacts.length === 0 && <li className="muted">No contacts on file.</li>}
        </ul>
      </section>
    </div>
  );
}
