import { setState } from "../../store/store.ts";
import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  UTILITY_SURFACES,
  type TabId,
} from "../../app/surfaces.ts";
import { CountBadge, UiIcon } from "../primitives.tsx";

function openSurface(surface: TabId): void {
  setState({
    activeTab: surface,
    activeSettings: surface === "settings",
    activeHome: surface === "brief",
    brainResponse: null,
    activeDeliverable: null,
    activeAnalysisSpec: null,
    activeCompanyId: null,
  });
}

export function BrainSidebar({
  activeTab,
  counts,
}: {
  activeTab: TabId;
  counts: Partial<Record<TabId, number>>;
}) {
  const groups = [
    { label: "Core", items: CORE_SURFACES },
    { label: "Analytical", items: ANALYTICAL_SURFACES },
    { label: "Utility", items: UTILITY_SURFACES },
  ];
  return (
    <aside className="brain-rail">
      <div className="rail-brand" aria-label="BTX">
        <span>BTX</span>
        <strong>Steel & Signal</strong>
      </div>
      {groups.map((group) => (
        <div key={group.label} className={group.label === "Utility" ? "brain-rail-group brain-rail-utility" : "brain-rail-group"}>
          <div className="brain-rail-group-label">{group.label}</div>
          {group.items.map((surface) => (
            <button
              key={surface.id}
              className={activeTab === surface.id ? "brain-rail-btn active" : "brain-rail-btn"}
              onClick={() => openSurface(surface.id)}
              title={surface.title}
            >
              <span><UiIcon name={surface.id} /></span>
              <strong>{surface.label}</strong>
              {counts[surface.id] ? <CountBadge value={counts[surface.id] ?? 0} /> : null}
            </button>
          ))}
        </div>
      ))}
      <div className="rail-user-chip">
        <UiIcon name="user" />
        <span><strong>BTX operator</strong><em>Signed in</em></span>
      </div>
    </aside>
  );
}
