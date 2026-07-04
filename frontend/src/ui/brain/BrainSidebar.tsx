import type { BrainArea } from "../../brain/types.ts";
import { useState } from "react";
import { clearMemory } from "../../memory/localMemory.ts";
import { goHome, resetUiState, setState } from "../../store/store.ts";

const AREAS: Array<{ id: BrainArea; icon: string; label: string; title: string }> = [
  { id: "market", icon: "⚡", label: "Signals", title: "Market signals and news linked to your accounts" },
  { id: "customer", icon: "☷", label: "Accounts", title: "Current business, account risk, and customer attention" },
  { id: "capability", icon: "◷", label: "Capability", title: "Capacity, fit, and operating context" },
  { id: "revenue", icon: "$", label: "Revenue", title: "Revenue priorities and recommendations" },
  { id: "geographic", icon: "⌖", label: "Map", title: "Market map and geographic prospecting" },
  { id: "decision", icon: "▤", label: "Memory", title: "Saved notes, activity, and reusable work" },
  { id: "workflow", icon: "⇄", label: "Actions", title: "Simulated action workflows and integrations" },
];

export function BrainSidebar({ activeBrainArea, counts, homeActive }: { activeBrainArea: BrainArea; counts: Partial<Record<BrainArea, number>>; homeActive: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  function clearCurrentThread() {
    window.localStorage.removeItem(`btx.chatpil.thread.${activeBrainArea}`);
    window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
  }
  function clearAllThreads() {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("btx.chatpil.thread.")) window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new Event("btx:clear-chatpil-thread"));
  }
  function resetDemo() {
    if (!window.confirm("Reset demo and clear all local state?")) return;
    clearAllThreads();
    clearMemory();
    resetUiState();
    window.location.reload();
  }
  return (
    <aside className="brain-rail">
      <button className={homeActive ? "brain-rail-btn active" : "brain-rail-btn"} onClick={goHome} title="Home cockpit">
        <span>⌂</span>
        <strong>Home</strong>
      </button>
      {AREAS.map((area) => (
        <button
          key={area.id}
          className={activeBrainArea === area.id && !homeActive ? "brain-rail-btn active" : "brain-rail-btn"}
          onClick={() => setState({ activeBrainArea: area.id, brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null })}
          title={area.title}
        >
          <span>{area.icon}</span>
          <strong>{area.label}</strong>
          {counts[area.id] ? <em>{counts[area.id]}</em> : null}
        </button>
      ))}
      <button className="brain-rail-btn brain-settings-btn" onClick={() => setSettingsOpen((open) => !open)} title="Settings and reset">
        <span>⚙</span>
        <strong>Settings</strong>
      </button>
      {settingsOpen && (
        <div className="rail-settings">
          <button onClick={clearCurrentThread}>Clear this chat</button>
          <button onClick={clearAllThreads}>Clear all chats</button>
          <button onClick={clearMemory}>Clear notes + activity</button>
          <button onClick={resetDemo}>Reset demo</button>
        </div>
      )}
    </aside>
  );
}
