// The sale dossier: everything a rep needs to make the call, all from the
// deterministic engine. Opportunity score + its trace, fit to the client's
// capabilities, recent buying signals, and who to call. Every number is traceable.

import type { World } from "../../app/useWorld.ts";
import { scoreFit } from "../../engine/decision/fit.ts";
import { groupTrace, summarizeGroups } from "../../engine/decision/explain.ts";
import { CONFIG, PROFILE } from "../../app/config.ts";
import { narrateOpportunity, findingMeaning } from "../../app/narrate.ts";
import { getInsight } from "../../app/insights.ts";

export function Dossier({ world, companyId }: { world: World; companyId: string }) {
  const company = world.companies.find((c) => c.id === companyId);
  if (!company) return null;

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

  return (
    <div className="dossier">
      <div className="dossier-head">
        <h3>{company.name}</h3>
        <span className={`pill rel-${company.relationship}`}>{company.relationship}</span>
        <div className="muted">{company.location.city}</div>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="metric-val">{opp?.score ?? 0}</div>
          <div className="metric-lbl">opportunity</div>
        </div>
        <div className="metric">
          <div className="metric-val">{fit.score}%</div>
          <div className="metric-lbl">fit to {PROFILE.name}</div>
        </div>
      </div>

      <section>
        <h4>Why this is a target</h4>
        <p className="narrative">{narrative}</p>
        {oppGroups.length > 0 && <p className="audit">scoring: {summarizeGroups(oppGroups)}</p>}
      </section>

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
                <span className="ev">{s.event_type}</span>
                <span className="q">{s.source_quote}</span>
                {meaning && <span className="meaning">{meaning}</span>}
                <span className="conf">conf {s.confidence.toFixed(2)}</span>
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
            </li>
          ))}
          {contacts.length === 0 && <li className="muted">No contacts on file.</li>}
        </ul>
      </section>
    </div>
  );
}
