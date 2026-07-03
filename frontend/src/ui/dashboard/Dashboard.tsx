// Portfolio dashboard: aggregates the engine output across the whole world (not
// city-scoped). Pure rendering — every row is derived from scores/alerts/signals.
// Clicking any row sets activeCompanyId, opening the dossier (cross-surface link
// falls out of the shared store, no special glue).

import type { World } from "../../app/useWorld.ts";
import type { ScoreDimension } from "../../engine/signals/contract.ts";
import { rankBy } from "../../engine/decision/portfolio.ts";
import { setState } from "../../store/store.ts";
import { actionDescription, actionLabel } from "../../app/actionLabels.ts";
import { explainRankingPrompt, expandSignalPrompt, nextActionPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { RankingWhy } from "../ranking/RankingWhy.tsx";

function RankList({ world, dimension, title }: { world: World; dimension: ScoreDimension; title: string }) {
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const rows = rankBy(world.analysis.scores, dimension)
    .filter((s) => s.dimensions[dimension].score > 0)
    .slice(0, 6);
  const color = dimension === "opportunity" ? "var(--good)" : "var(--bad)";
  return (
    <div className="dash-card">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="muted">none</p>}
      {rows.map((s) => {
        const v = s.dimensions[dimension].score;
        const company = world.companies.find((c) => c.id === s.subject_id);
        const explanation = company ? rankingExplanation(world, company, { dimension, heading: title }) : null;
        return (
          <button key={s.subject_id} className="rank-row" onClick={() => setState({ activeCompanyId: s.subject_id })}>
            <span className="rank-name">{nameOf(s.subject_id)}</span>
            <span className="rank-bar"><span style={{ width: `${v}%`, background: color }} /></span>
            <span className="rank-val">{v}</span>
            {explanation && <RankingWhy explanation={explanation} />}
            <AskChatpilButton
              label="Explain ranking"
              prompt={explainRankingPrompt(nameOf(s.subject_id), `${title}. ${explanation?.summary ?? `${dimension} score ${v}`}. ${explanation?.driverLine ?? ""} ${explanation?.signalLine ?? ""} ${explanation?.contextLine ?? ""}`)}
            />
          </button>
        );
      })}
    </div>
  );
}

export function Dashboard({ world }: { world: World }) {
  const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? id;
  const alerts = world.analysis.alerts.slice(0, 8);
  const recent = [...world.analysis.valid]
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at))
    .slice(0, 8);

  return (
    <div className="dashboard">
      <div className="dash-head">
        Portfolio intelligence · {world.companies.length} entities · {world.analysis.valid.length} validated signals
      </div>

      <div className="dash-card">
        <h3>What to do now</h3>
        {world.analysis.recommendations
          .filter((r) => r.priority !== "low")
          .slice(0, 6)
          .map((r) => (
            <button key={r.subject_id} className="rec-row" onClick={() => setState({ activeCompanyId: r.subject_id })}>
              <span className={`rec-tag rec-${r.action}`} title={actionDescription(r.action)}>
                {actionLabel(r.action)}
              </span>
              <span className="rec-name">{nameOf(r.subject_id)}</span>
              <span className="muted">{r.reason}</span>
              <AskChatpilButton
                label="Explain"
                prompt={nextActionPrompt(nameOf(r.subject_id), `Dashboard recommendation: ${actionLabel(r.action)}. Priority ${r.priority}. Reason: ${r.reason}.`)}
              />
            </button>
          ))}
      </div>

      <div className="dash-grid">
        <RankList world={world} dimension="risk" title="Top risk" />
        <RankList world={world} dimension="opportunity" title="Top opportunity" />
      </div>

      <div className="dash-card">
        <h3>Alerts ({alerts.length})</h3>
        {alerts.map((a, i) => (
          <button key={i} className="alert-row" onClick={() => setState({ activeCompanyId: a.subject_id })}>
            <span className={`sev sev-${a.severity}`}>{a.severity}</span>
            <span className="alert-main">{nameOf(a.subject_id)} — {a.dimension} {a.score}</span>
            <span className="muted">{a.reason}</span>
            <AskChatpilButton
              label="Explain"
              prompt={`Explain this alert using only engine context. Account: ${nameOf(a.subject_id)}. Dimension: ${a.dimension}. Score: ${a.score}. Severity: ${a.severity}. Reason: ${a.reason}. Do not invent numbers.`}
            />
          </button>
        ))}
      </div>

      <div className="dash-card">
        <h3>Recent signals</h3>
        {recent.map((s) => (
          <button key={s.id} className="feed-row" onClick={() => setState({ activeCompanyId: s.subject_id })}>
            <span className="feed-ev">{s.event_type}</span>
            <span className="feed-q">{nameOf(s.subject_id)}: {s.source_quote}</span>
            <AskChatpilButton label="Expand signal" prompt={expandSignalPrompt(s, nameOf(s.subject_id))} />
          </button>
        ))}
      </div>
    </div>
  );
}
