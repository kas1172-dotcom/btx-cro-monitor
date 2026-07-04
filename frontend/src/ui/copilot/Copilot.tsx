// Chatpil panel — the CRO's chief-of-staff. Runs on every view.
// LLM path when proxy is configured and health-check passes; rule-based offline fallback.
// No debug text ever renders in the thread.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { World } from "../../app/useWorld.ts";
import { askJarvis, openingBrief, runHealthCheck, subscribeToLiveStatus, getLiveStatus, dispatchChatpilAction } from "../../brain/jarvis.ts";
import type { Msg } from "../../brain/jarvis.ts";
import { worldSuggestions } from "../../brain/copilot.ts";
import { useStore, setState as setStoreState } from "../../store/store.ts";
import { runAgent } from "../../agents/runAgent.ts";
import { saveDeliverable } from "../../memory/localMemory.ts";

type CopilotState = "closed" | "normal" | "expanded" | "minimized";

export function Copilot({ world }: { world: World }) {
  const [windowState, setWindowState] = useState<CopilotState>("closed");
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  // True once we've shown the offline note this session — show at most once per "falling offline" event.
  const [offlineNoteShown, setOfflineNoteShown] = useState(false);
  const { copilotPrompt, copilotPromptId, activeBrainArea, activeCompanyId } = useStore();
  const lastPromptId = useRef(0);
  const threadKey = `btx.chatpil.thread.${activeBrainArea}`;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reactive live status — updates whenever the health-check result changes.
  const liveStatus = useSyncExternalStore(subscribeToLiveStatus, getLiveStatus);
  const isLive = liveStatus === "live";

  // Per-tab thread persistence
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(threadKey);
      setLog(raw ? (JSON.parse(raw) as Msg[]) : []);
    } catch {
      setLog([]);
    }
  }, [threadKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(threadKey, JSON.stringify(log));
    } catch { /* best effort */ }
  }, [log, threadKey]);

  useEffect(() => {
    const clear = () => setLog([]);
    window.addEventListener("btx:clear-chatpil-thread", clear);
    return () => window.removeEventListener("btx:clear-chatpil-thread", clear);
  }, []);

  // Health-check on first open
  useEffect(() => {
    if (windowState !== "closed") {
      void runHealthCheck();
    }
  }, [windowState]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [log, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const userMsg: Msg = { role: "user", content: text };
    const history: Msg[] = [...log, userMsg];
    setLog(history);
    setQ("");
    setBusy(true);

    const reply = await askJarvis(history, world, { currentArea: activeBrainArea, selectedCompanyId: activeCompanyId });

    // If the reply carries an offline note and we haven't shown one yet, attach it.
    // After the proxy recovers, reset so the next dropout shows the note again.
    let finalReply = reply;
    if (reply.offlineNote && !offlineNoteShown) {
      setOfflineNoteShown(true);
      finalReply = { ...reply };
    } else if (!reply.offlineNote && offlineNoteShown && liveStatus === "live") {
      setOfflineNoteShown(false);
    } else {
      // Suppress repeat offline notes
      finalReply = { ...reply, offlineNote: undefined };
    }

    setLog([...history, finalReply]);
    setBusy(false);
  }

  // Handle offer button press — triggers a real agent or store action
  async function acceptOffer(msg: Msg) {
    if (!msg.offer) return;
    const label = msg.offer.label;
    if (label.toLowerCase().includes("outreach")) {
      const company = world.prospects[0]?.company;
      if (company) {
        setBusy(true);
        try {
          const deliverable = await runAgent("outreach", { accountId: company.id }, world);
          saveDeliverable(deliverable);
          setStoreState({ activeDeliverable: deliverable, activeBrainArea: deliverable.brainArea, brainResponse: null, activeAnalysisSpec: null });
          setLog((prev) => [...prev, { role: "assistant", content: `Created outreach draft for ${company.name}. Opening now.` }]);
        } finally {
          setBusy(false);
        }
      }
    } else if (label.toLowerCase().includes("dossier")) {
      const nameMatch = world.companies.find((c) => label.toLowerCase().includes(c.name.toLowerCase()));
      if (nameMatch) setStoreState({ activeCompanyId: nameMatch.id });
    } else if (label.toLowerCase().includes("capabilities assessment")) {
      const company = world.prospects[0]?.company;
      if (company) {
        setBusy(true);
        try {
          const deliverable = await runAgent("capabilities_assessment", { accountId: company.id }, world);
          saveDeliverable(deliverable);
          setStoreState({ activeDeliverable: deliverable, activeBrainArea: deliverable.brainArea, brainResponse: null, activeAnalysisSpec: null });
          setLog((prev) => [...prev, { role: "assistant", content: `Created capabilities assessment. Opening now.` }]);
        } finally {
          setBusy(false);
        }
      }
    } else {
      // Generic: try action dispatch
      const dispatched = dispatchChatpilAction(label, world);
      if (dispatched) {
        setLog((prev) => [...prev, { role: "assistant", content: dispatched }]);
      }
    }
  }

  // Injected prompts from other components (AskChatpilButton)
  useEffect(() => {
    if (!copilotPrompt || copilotPromptId === lastPromptId.current) return;
    lastPromptId.current = copilotPromptId;
    setWindowState("normal");
    void ask(copilotPrompt);
  }, [copilotPrompt, copilotPromptId]);

  const suggestions = worldSuggestions(world);

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
          ✦ Chatpil{" "}
          <em className={isLive ? "live" : liveStatus === "unknown" ? "offline" : "offline"}>
            {isLive ? "live" : liveStatus === "unknown" ? "…" : "offline"}
          </em>
          <small>{activeBrainArea} thread</small>
        </span>
        <div className="copilot-controls">
          <button onClick={() => setWindowState("minimized")} aria-label="minimize Chatpil">−</button>
          <button onClick={() => setWindowState(expanded ? "normal" : "expanded")} aria-label={expanded ? "restore Chatpil" : "expand Chatpil"}>
            {expanded ? "↙" : "↗"}
          </button>
          <button onClick={() => setWindowState("closed")} aria-label="close Chatpil">×</button>
        </div>
      </div>

      <div className="copilot-body" ref={bodyRef}>
        <div className="copilot-brief">{openingBrief(world)}</div>
        {log.length === 0 && (
          <div className="copilot-hint">
            {suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {log.map((msg, i) => (
          msg.role === "user" ? (
            <div key={i} className="copilot-turn">
              <div className="copilot-q">{msg.content}</div>
            </div>
          ) : (
            <div key={i} className="copilot-turn">
              {msg.actionConfirmation && (
                <div className="copilot-action-confirm">{msg.actionConfirmation}</div>
              )}
              {msg.content && <div className="copilot-a">{msg.content}</div>}
              {msg.offlineNote && (
                <div className="copilot-offline-note">{msg.offlineNote}</div>
              )}
              {msg.offer && (
                <button className="copilot-offer-btn" onClick={() => void acceptOffer(msg)}>
                  {msg.offer.label}
                </button>
              )}
            </div>
          )
        ))}
        {busy && <div className="copilot-a copilot-thinking">thinking…</div>}
      </div>

      <form className="copilot-input" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isLive ? "Ask Chatpil anything…" : "Ask (offline: rule-based)…"}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}
