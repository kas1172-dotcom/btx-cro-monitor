import { setState } from "../../store/store.ts";
import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  UTILITY_SURFACES,
  type SurfaceSpec,
  type TabId,
} from "../../app/surfaces.ts";
import { CountBadge, UiIcon } from "../primitives.tsx";

const DEMO_FLOW_IDS: TabId[] = ["brief", "work_queue", "prospecting", "deliverables"];
const PROOF_POINT_IDS: TabId[] = ["accounts", "programs", "capacity", "hubspot"];
const WORKBENCH_IDS: TabId[] = ["ask", "map", "analysis", "settings"];

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

export function BrainSidebar({
  activeTab,
  counts,
}: {
  activeTab: TabId;
  counts: Partial<Record<TabId, number>>;
}) {
  const groups = [
    { label: "Demo Flow", items: surfacesFor(DEMO_FLOW_IDS) },
    { label: "Proof Points", items: surfacesFor(PROOF_POINT_IDS) },
    { label: "Workbench", items: surfacesFor(WORKBENCH_IDS) },
  ];
  return (
    <aside className="brain-rail">
      <div className="rail-brand" aria-label="BTX">
        <span>BTX</span>
        <strong>Steel & Signal</strong>
      </div>
      {groups.map((group) => (
        <div key={group.label} className={group.label === "Workbench" ? "brain-rail-group brain-rail-utility" : "brain-rail-group"}>
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
