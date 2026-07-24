import { setState } from "../../store/store.ts";
import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  PRIMARY_TAB_IDS,
  UTILITY_SURFACES,
  type SurfaceSpec,
  type TabId,
} from "../../app/surfaces.ts";
import { CountBadge, UiIcon } from "../primitives.tsx";

const PIPELINE_IDS: TabId[] = ["accounts", "prospecting", "programs"];
const TOOLS_IDS: TabId[] = ["deliverables", "settings"];

const surfaceById = new Map(
  [...CORE_SURFACES, ...ANALYTICAL_SURFACES, ...UTILITY_SURFACES].map((surface) => [surface.id, surface]),
);

function surfacesFor(ids: TabId[]): SurfaceSpec[] {
  return ids.map((id) => surfaceById.get(id)).filter((surface): surface is SurfaceSpec => Boolean(surface));
}

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

function primaryTabFor(surface: TabId): TabId {
  if (surface === "hubspot" || surface === "capacity") return "accounts";
  if (surface === "map" || surface === "trip_planner") return "prospecting";
  if (surface === "analysis") return "deliverables";
  if (surface === "ask") return "brief";
  return surface;
}

export function BrainSidebar({
  activeTab,
  counts,
}: {
  activeTab: TabId;
  counts: Partial<Record<TabId, number>>;
}) {
  const groups = [
    { label: "Today", items: surfacesFor(PRIMARY_TAB_IDS.slice(0, 2)) },
    { label: "Pipeline", items: surfacesFor(PIPELINE_IDS) },
    { label: "Tools", items: surfacesFor(TOOLS_IDS) },
  ];
  const primaryActiveTab = primaryTabFor(activeTab);
  return (
    <aside className="brain-rail">
      <div className="rail-brand" aria-label="BTX">
        <span>BTX</span>
        <strong>Steel & Signal</strong>
      </div>
      {groups.map((group) => (
        <div key={group.label} className={group.label === "Tools" ? "brain-rail-group brain-rail-utility" : "brain-rail-group"}>
          <div className="brain-rail-group-label">{group.label}</div>
          {group.items.map((surface) => (
            <button
              key={surface.id}
              className={primaryActiveTab === surface.id ? "brain-rail-btn active" : "brain-rail-btn"}
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
