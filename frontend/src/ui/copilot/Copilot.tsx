// Jarvis panel — a conversational assistant available on every view. It opens
// with a proactive brief, then converses: a real LLM (grounded in the engine
// state) when a proxy is configured, else the rule-based resolver. Never
// computes the numbers — the engine does that; Jarvis explains and advises.

import { useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { askJarvis, openingBrief, jarvisLive } from "../../app/jarvis.ts";
import type { Msg } from "../../app/jarvis.ts";
import { SUGGESTIONS } from "../../app/copilot.ts";

export function Copilot({ world }: { world: World }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: Msg[] = [...log, { role: "user", content: text }];
    setLog(history);
    setQ("");
    setBusy(true);
    const reply = await askJarvis(history, world);
    setLog([...history, { role: "assistant", content: reply }]);
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="copilot-fab" onClick={() => setOpen(true)}>
        ✦ Jarvis
      </button>
    );
  }

  return (
    <div className="copilot">
      <div className="copilot-head">
        <span>
          ✦ Jarvis <em className={jarvisLive ? "live" : "offline"}>{jarvisLive ? "live" : "offline"}</em>
        </span>
        <button onClick={() => setOpen(false)} aria-label="close">×</button>
      </div>
      <div className="copilot-body">
        <div className="copilot-brief">{openingBrief(world)}</div>
        {log.length === 0 && (
          <div className="copilot-hint">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {log.map((e, i) =>
          e.role === "user" ? (
            <div key={i} className="copilot-turn"><div className="copilot-q">{e.content}</div></div>
          ) : (
            <div key={i} className="copilot-turn"><div className="copilot-a">{e.content}</div></div>
          ),
        )}
        {busy && <div className="copilot-a copilot-thinking">thinking…</div>}
      </div>
      <form className="copilot-input" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={jarvisLive ? "Ask Jarvis anything…" : "Ask (offline: rule-based)…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>Ask</button>
      </form>
    </div>
  );
}
