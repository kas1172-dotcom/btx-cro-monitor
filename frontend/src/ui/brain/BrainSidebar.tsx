import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  PRIMARY_TAB_IDS,
  UTILITY_SURFACES,
  type SurfaceSpec,
  type TabId,
} from "../../app/surfaces.ts";
import { navigateTo, pathForTab } from "../../app/router.ts";
import { CountBadge, UiIcon } from "../primitives.tsx";

const SECONDARY_IDS: TabId[] = ["programs", "prospecting", "capacity", "analysis", "map"];
const UTILITY_IDS: TabId[] = ["deliverables", "hubspot", "settings"];

const surfaceById = new Map(
  [...CORE_SURFACES, ...ANALYTICAL_SURFACES, ...UTILITY_SURFACES].map((surface) => [surface.id, surface]),
);

function surfacesFor(ids: TabId[]): SurfaceSpec[] {
  return ids.map((id) => surfaceById.get(id)).filter((surface): surface is SurfaceSpec => Boolean(surface));
}

function openSurface(surface: TabId): void {
  navigateTo(pathForTab(surface));
}

function primaryTabFor(surface: TabId): TabId {
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
    { label: "Primary", items: surfacesFor(PRIMARY_TAB_IDS) },
    { label: "Workspace", items: surfacesFor(SECONDARY_IDS) },
    { label: "Utilities", items: surfacesFor(UTILITY_IDS) },
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
