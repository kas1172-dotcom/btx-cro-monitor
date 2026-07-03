// Jarvis panel — a conversational assistant available on every view. It opens
// with a proactive brief, then converses: a real LLM (grounded in the engine
// state) when a proxy is configured, else the rule-based resolver. Never
// computes the numbers — the engine does that; Jarvis explains and advises.

import { useEffect, useRef, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { askJarvis, openingBrief, jarvisLive } from "../../app/jarvis.ts";
import type { Msg } from "../../app/jarvis.ts";
import { SUGGESTIONS } from "../../app/copilot.ts";
import { useStore } from "../../store/store.ts";

type CopilotState = "closed" | "normal" | "expanded" | "minimized";

export function Copilot({ world }: { world: World }) {
  const [windowState, setWindowState] = useState<CopilotState>("closed");
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const { copilotPrompt, copilotPromptId } = useStore();
  const lastPromptId = useRef(0);

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

  useEffect(() => {
    if (!copilotPrompt || copilotPromptId === lastPromptId.current) return;
    lastPromptId.current = copilotPromptId;
    setWindowState("normal");
    void ask(copilotPrompt);
  }, [copilotPrompt, copilotPromptId]);

  if (windowState === "closed") {
    return (
      <button className="copilot-fab" onClick={() => setWindowState("normal")}>
        ✦ Chatpil
      </button>
    );
  }

  if (windowState === "minimized") {
    return (
      <button className="copilot-mini" onClick={() => setWindowState("normal")}>
        <span>✦ Chatpil</span>
        <em>{busy ? "thinking..." : log.length ? `${log.length} messages` : "ready"}</em>
      </button>
    );
  }

  const expanded = windowState === "expanded";

  return (
    <div className={expanded ? "copilot expanded" : "copilot"}>
      <div className="copilot-head">
        <span>
          ✦ Chatpil <em className={jarvisLive ? "live" : "offline"}>{jarvisLive ? "live" : "offline"}</em>
        </span>
        <div className="copilot-controls">
          <button onClick={() => setWindowState("minimized")} aria-label="minimize Chatpil">−</button>
          <button
            onClick={() => setWindowState(expanded ? "normal" : "expanded")}
            aria-label={expanded ? "restore Chatpil" : "expand Chatpil"}
          >
            {expanded ? "↙" : "↗"}
          </button>
          <button onClick={() => setWindowState("closed")} aria-label="close Chatpil">×</button>
        </div>
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
          placeholder={jarvisLive ? "Ask Chatpil anything…" : "Ask (offline: rule-based)…"}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>Ask</button>
      </form>
    </div>
  );
}
