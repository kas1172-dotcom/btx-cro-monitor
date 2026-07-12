import { setState } from "../../store/store.ts";
import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  UTILITY_SURFACES,
  brainAreaForSurface,
  type SurfaceId,
} from "../../app/surfaces.ts";

const ICONS: Record<SurfaceId, string> = {
  brief: "B",
  work_queue: "Q",
  accounts: "A",
  ask: "?",
  map: "M",
  analysis: "%",
  capacity: "C",
  programs: "P",
  settings: "*",
};

function openSurface(surface: SurfaceId): void {
  setState({
    activeSurface: surface,
    activeSettings: surface === "settings",
    activeHome: surface === "brief",
    activeBrainArea: brainAreaForSurface(surface),
    brainResponse: null,
    activeDeliverable: null,
    activeAnalysisSpec: null,
    activeCompanyId: null,
  });
}

export function BrainSidebar({
  activeSurface,
  counts,
}: {
  activeSurface: SurfaceId;
  counts: Partial<Record<SurfaceId, number>>;
}) {
  const groups = [
    { label: "Core", items: CORE_SURFACES },
    { label: "Analytical", items: ANALYTICAL_SURFACES },
    { label: "Utility", items: UTILITY_SURFACES },
  ];
  return (
    <aside className="brain-rail">
      {groups.map((group) => (
        <div key={group.label} className={group.label === "Utility" ? "brain-rail-group brain-rail-utility" : "brain-rail-group"}>
          <div className="brain-rail-group-label">{group.label}</div>
          {group.items.map((surface) => (
            <button
              key={surface.id}
              className={activeSurface === surface.id ? "brain-rail-btn active" : "brain-rail-btn"}
              onClick={() => openSurface(surface.id)}
              title={surface.title}
            >
              <span>{ICONS[surface.id]}</span>
              <strong>{surface.label}</strong>
              {counts[surface.id] ? <em>{counts[surface.id]}</em> : null}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
