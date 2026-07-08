import type { BrainArea } from "../../brain/types.ts";
import { goHome, setState } from "../../store/store.ts";

const AREAS: Array<{ id: BrainArea; icon: string; label: string; title: string }> = [
  { id: "market", icon: "⚡", label: "Signals", title: "Market signals and news linked to your accounts" },
  { id: "customer", icon: "☷", label: "Accounts", title: "Current business, account risk, and customer attention" },
  { id: "capability", icon: "◷", label: "Capability", title: "Capacity, fit, and operating context" },
  { id: "revenue", icon: "$", label: "Revenue", title: "Revenue priorities and recommendations" },
  { id: "geographic", icon: "⌖", label: "Map", title: "Market map and geographic prospecting" },
  { id: "decision", icon: "▤", label: "Memory", title: "Saved notes, activity, and reusable work" },
  { id: "workflow", icon: "⇄", label: "Actions", title: "Simulated action workflows and integrations" },
];

export function BrainSidebar({ activeBrainArea, counts, homeActive, settingsActive }: { activeBrainArea: BrainArea; counts: Partial<Record<BrainArea, number>>; homeActive: boolean; settingsActive: boolean }) {
  return (
    <aside className="brain-rail">
      <button className={homeActive ? "brain-rail-btn active" : "brain-rail-btn"} onClick={goHome} title="Home cockpit">
        <span>⌂</span>
        <strong>Home</strong>
      </button>
      {AREAS.map((area) => (
        <button
          key={area.id}
          className={activeBrainArea === area.id && !homeActive && !settingsActive ? "brain-rail-btn active" : "brain-rail-btn"}
          onClick={() => setState({ activeBrainArea: area.id, activeSettings: false, brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null })}
          title={area.title}
        >
          <span>{area.icon}</span>
          <strong>{area.label}</strong>
          {counts[area.id] ? <em>{counts[area.id]}</em> : null}
        </button>
      ))}
      <button
        className={settingsActive ? "brain-rail-btn brain-settings-btn active" : "brain-rail-btn brain-settings-btn"}
        onClick={() => setState({ activeSettings: true, activeHome: false, brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null })}
        title="Settings"
      >
        <span>⚙</span>
        <strong>Settings</strong>
      </button>
    </aside>
  );
}
