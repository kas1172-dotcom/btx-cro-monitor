// Copilot panel — a floating assistant available on every view. It renders the
// deterministic engine's answers (no AI yet); the resolver in app/copilot.ts is
// the swap point for an LLM proxy later. Never computes — only explains.

import { useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { answer, SUGGESTIONS } from "../../app/copilot.ts";

export function Copilot({ world }: { world: World }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Array<{ q: string; a: string }>>([]);

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    setLog((l) => [...l, { q: text, a: answer(text, world) }]);
    setQ("");
  }

  if (!open) {
    return (
      <button className="copilot-fab" onClick={() => setOpen(true)}>
        ✦ Copilot
      </button>
    );
  }

  return (
    <div className="copilot">
      <div className="copilot-head">
        <span>✦ Copilot</span>
        <button onClick={() => setOpen(false)} aria-label="close">×</button>
      </div>
      <div className="copilot-body">
        {log.length === 0 && (
          <div className="copilot-hint">
            <p className="muted">Answers come straight from the deterministic engine.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {log.map((e, i) => (
          <div key={i} className="copilot-turn">
            <div className="copilot-q">{e.q}</div>
            <div className="copilot-a">{e.a}</div>
          </div>
        ))}
      </div>
      <form
        className="copilot-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the portfolio…" />
        <button type="submit">Ask</button>
      </form>
    </div>
  );
}
