import { useEffect } from "react";
import type React from "react";
import { useStore, setState, closeDemoAction, goHome, clearTourRequest } from "./store/store.ts";
import { useWorld } from "./app/useWorld.ts";
import { CITIES, PROFILE } from "./app/config.ts";
import { ProspectMap } from "./ui/map/ProspectMap.tsx";
import { Copilot } from "./ui/copilot/Copilot.tsx";
import { Dossier } from "./ui/company/Dossier.tsx";
import { BrainSidebar } from "./ui/brain/BrainSidebar.tsx";
import { BrainHome } from "./ui/brain/BrainHome.tsx";
import { RailAreaView } from "./ui/brain/RailAreaView.tsx";
import { BrainResponseWorkspace } from "./ui/brain/BrainResponseWorkspace.tsx";
import { AskBrainBar } from "./ui/brain/AskBrainBar.tsx";
import { RightContextPanel } from "./ui/brain/RightContextPanel.tsx";
import { TourHud } from "./ui/brain/TourHud.tsx";
import { DocumentViewer } from "./ui/deliverables/DocumentViewer.tsx";
import { recordSimulatedAction, useMemory } from "./memory/localMemory.ts";
import { AnalysisView } from "./ui/analysis/AnalysisView.tsx";
import { isMarketScopedView } from "./app/viewScope.ts";
import { buildRailView } from "./app/railViews.ts";
import { SettingsWorkspace } from "./ui/settings/SettingsWorkspace.tsx";

const ALL_MARKETS_VALUE = "__all_markets__";

export function App() {
  const { city, activeHome, activeSettings, activeBrainArea, brainResponse, activeCompanyId, demoAction, activeDeliverable, activeAnalysisSpec, tourRequested } = useStore();
  const memory = useMemory();
  const marketWorld = useWorld(city); // selected-market scope; null means all markets.
  const world = useWorld(null); // global — dashboard, graph, and the dossier
  const settingsActive = activeSettings && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const homeActive = activeHome && !settingsActive && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const marketScoped = !homeActive && !settingsActive && isMarketScopedView({ activeBrainArea, brainResponse, activeDeliverable, activeAnalysisSpec });
  const viewWorld = marketScoped ? marketWorld ?? world : world;

  // Right-panel: dossier takes priority over context panel, one at a time.
  const dossierOpen = !!activeCompanyId;
  const contextPanelOpen = !dossierOpen && !!brainResponse;
  const rightW = dossierOpen ? "minmax(360px, 420px)" : contextPanelOpen ? "320px" : "0px";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close topmost open panel only — never navigate away.
      if (activeCompanyId) {
        event.stopPropagation();
        setState({ activeCompanyId: null });
        return;
      }
      if (brainResponse) {
        event.stopPropagation();
        setState({ brainResponse: null });
        return;
      }
      goHome();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeCompanyId, brainResponse]);
  const renderDefault = () => {
    if (settingsActive) return <SettingsWorkspace />;
    if (!world) return <div className="loading">loading…</div>;
    if (activeAnalysisSpec) return <AnalysisView world={world} initialSpec={activeAnalysisSpec} />;
    if (activeDeliverable) return <DocumentViewer deliverable={activeDeliverable} world={world} />;
    if (brainResponse) return <BrainResponseWorkspace response={brainResponse} world={viewWorld ?? world} />;
    if (homeActive) return <BrainHome world={world} askBar={<AskBrainBar world={world} large />} />;
    switch (activeBrainArea) {
      case "market": return <RailAreaView area="market" world={viewWorld ?? world} />;
      case "customer": return <RailAreaView area="customer" world={world} />;
      case "capability": return <RailAreaView area="capability" world={world} />;
      case "geographic": return viewWorld ? <ProspectMap world={viewWorld} /> : <div className="loading">loading map…</div>;
      case "decision": return <RailAreaView area="decision" world={world} />;
      case "workflow": return <RailAreaView area="workflow" world={world} />;
      case "revenue": return <RailAreaView area="revenue" world={world} />;
      default: return <RailAreaView area="revenue" world={world} />;
    }
  };
  const counts = world ? {
    market: buildRailView("market", viewWorld ?? world, memory).total,
    customer: buildRailView("customer", world, memory).total,
    capability: buildRailView("capability", world, memory).total,
    revenue: buildRailView("revenue", world, memory).total,
    geographic: buildRailView("geographic", viewWorld ?? world, memory).total,
    decision: buildRailView("decision", world, memory).total,
    workflow: buildRailView("workflow", world, memory).total,
  } : {};

  const rightPanelOpen = dossierOpen || contextPanelOpen;

  return (
    <div
      className={rightPanelOpen ? "quiet-cockpit right-panel-open" : "quiet-cockpit"}
      style={{ "--right-w": rightW } as React.CSSProperties}
    >
      <BrainSidebar activeBrainArea={activeBrainArea} counts={counts} homeActive={homeActive} settingsActive={settingsActive} />
      <main className="quiet-main" onClickCapture={() => {
        if (activeCompanyId) setState({ activeCompanyId: null });
      }}>
        <header className="quiet-topbar">
          <button className="quiet-brand" onClick={goHome}>{PROFILE.name} Revenue Brain</button>
          {marketScoped && <label className="cockpit-city-picker">
            <span>Market</span>
            <select
              value={city ?? ALL_MARKETS_VALUE}
              onChange={(e) => setState({
                city: e.target.value === ALL_MARKETS_VALUE ? null : e.target.value,
                activeCompanyId: null,
                activeAnalysisSpec: null,
              })}
            >
              <option value={ALL_MARKETS_VALUE}>All Markets</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>}
        </header>
        <section className="quiet-stage">{renderDefault()}</section>
        {world && !homeActive && !settingsActive && <AskBrainBar world={viewWorld ?? world} />}
        {world && <Copilot world={world} />}
      </main>
      <RightContextPanel response={brainResponse} />

      <aside className={dossierOpen ? "inspector open" : "inspector"}>
        {dossierOpen && (
          <div className="inspector-topbar">
            <button className="inspector-back" onClick={() => setState({ activeCompanyId: null })} aria-label="Close dossier">×</button>
          </div>
        )}
        {world && activeCompanyId ? (
          <Dossier world={world} companyId={activeCompanyId} />
        ) : null}
      </aside>

      {demoAction && (
        <div className="demo-action-overlay" role="dialog" aria-modal="true" aria-labelledby="demo-action-title">
          <div className="demo-action-modal">
            <p className="eyebrow">Demo workflow</p>
            <h2 id="demo-action-title">{demoAction.title}</h2>
            {demoAction.accountName && <p className="demo-action-account">{demoAction.accountName}</p>}
            <p>
              In production, this would create a Salesforce task or lead, assign an owner, attach source evidence,
              and schedule follow-up. This demo does not send email, write to a CRM, or call an external API.
            </p>
            {demoAction.evidence && (
              <div className="demo-action-evidence">
                <span>Evidence attached</span>
                <strong>{demoAction.evidence}</strong>
              </div>
            )}
            <div className="demo-action-steps">
              <span>Create CRM task</span>
              <span>Attach evidence</span>
              <span>Assign owner</span>
              <span>Schedule follow-up</span>
            </div>
            <div className="demo-action-modal-actions">
              <button
                onClick={() => {
                  recordSimulatedAction({
                    title: demoAction.title,
                    summary: "Confirmed simulated workflow. Demo mode - no external writes occurred.",
                    brainArea: "workflow",
                  });
                  closeDemoAction();
                }}
              >
                Confirm Demo Action
              </button>
              <button onClick={closeDemoAction}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {tourRequested && world && (
        <TourHud world={world} autoStart onDismiss={clearTourRequest} />
      )}
    </div>
  );
}
