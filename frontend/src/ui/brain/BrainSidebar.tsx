import { useState } from "react";
import {
  ANALYTICAL_SURFACES,
  CORE_SURFACES,
  UTILITY_SURFACES,
  type SurfaceSpec,
  type TabId,
} from "../../app/surfaces.ts";
import { navigateTo, pathForTab, toBrowserPath } from "../../app/router.ts";
import { CountBadge, UiIcon } from "../primitives.tsx";
import { CockpitRailIdentity } from "../../app/clerkAuth.tsx";

const SECONDARY_IDS: TabId[] = ["industry_updates", "programs", "prospecting", "capacity", "analysis", "map"];
const UTILITY_IDS: TabId[] = ["deliverables", "hubspot", "settings"];
const PRIMARY_IDS: TabId[] = ["brief", "work_queue", "accounts"];

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
  const [moreOpen, setMoreOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(SECONDARY_IDS.includes(activeTab));
  const primaryActiveTab = primaryTabFor(activeTab);
  const primary = surfacesFor(PRIMARY_IDS);
  const ask = surfaceById.get("ask");
  const intelligence = surfacesFor(SECONDARY_IDS);
  const utilities = surfacesFor(UTILITY_IDS);
  const link = (surface: SurfaceSpec, compact = false) => (
    <a
      key={surface.id}
      className={`${primaryActiveTab === surface.id ? "brain-rail-btn active" : "brain-rail-btn"}${compact ? " intelligence-child" : ""}`}
      href={toBrowserPath(pathForTab(surface.id))}
      onClick={(event) => {
        event.preventDefault();
        setMoreOpen(false);
        openSurface(surface.id);
      }}
      aria-current={primaryActiveTab === surface.id ? "page" : undefined}
      aria-label={surface.label}
      title={surface.title}
    >
      <span><UiIcon name={surface.id} /></span>
      <strong>{surface.label}</strong>
      {counts[surface.id] ? <CountBadge value={counts[surface.id] ?? 0} /> : null}
    </a>
  );
  return (
    <nav className="brain-rail" aria-label="Cockpit navigation">
      <div className="rail-brand" aria-label="BTX">
        <span>BTX</span>
        <strong>Steel & Signal</strong>
      </div>
      <div className="brain-rail-group brain-rail-primary">
        <div className="brain-rail-group-label">Operate</div>
        {primary.map((surface) => link(surface))}
        <button
          type="button"
          className={SECONDARY_IDS.includes(activeTab) ? "brain-rail-btn active" : "brain-rail-btn"}
          onClick={() => setIntelligenceOpen((value) => !value)}
          aria-expanded={intelligenceOpen}
          aria-controls="intelligence-navigation"
        >
          <span><UiIcon name="signal" /></span>
          <strong>Intelligence</strong>
          <span className="nav-disclosure" aria-hidden="true">{intelligenceOpen ? "−" : "+"}</span>
        </button>
        {intelligenceOpen && <div id="intelligence-navigation" className="intelligence-navigation">{intelligence.map((surface) => link(surface, true))}</div>}
        {ask ? link(ask) : null}
      </div>
      <div className="brain-rail-group brain-rail-utility">
        <div className="brain-rail-group-label">Utilities</div>
        {utilities.map((surface) => link(surface))}
      </div>
      <button
        type="button"
        className={moreOpen ? "brain-rail-btn brain-rail-more active" : "brain-rail-btn brain-rail-more"}
        onClick={() => setMoreOpen((value) => !value)}
        aria-expanded={moreOpen}
        aria-controls="mobile-more-menu"
        aria-label="Open navigation"
      >
        <span><UiIcon name="chevron" /></span>
        <strong>Navigation</strong>
      </button>
      {moreOpen && (
        <div id="mobile-more-menu" className="mobile-more-menu">
          {[...primary, ...(ask ? [ask] : []), ...intelligence, ...utilities].map((surface) => (
            <a
              key={surface.id}
              href={toBrowserPath(pathForTab(surface.id))}
              aria-label={surface.label}
              aria-current={primaryActiveTab === surface.id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setMoreOpen(false);
                openSurface(surface.id);
              }}
            >
              <UiIcon name={surface.id} />
              <span>{surface.label}</span>
            </a>
          ))}
        </div>
      )}
      <div className="rail-user-chip">
        <UiIcon name="user" />
        <CockpitRailIdentity />
      </div>
    </nav>
  );
}
