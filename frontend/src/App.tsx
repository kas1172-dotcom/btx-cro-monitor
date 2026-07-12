import { lazy, Suspense, useEffect, useState } from "react";
import type React from "react";
import { useStore, setState, closeDemoAction, goHome, clearTourRequest } from "./store/store.ts";
import { useWorld } from "./app/useWorld.ts";
import { CITIES, PROFILE } from "./app/config.ts";
import { Dossier } from "./ui/company/Dossier.tsx";
import { BrainSidebar } from "./ui/brain/BrainSidebar.tsx";
import { BrainResponseWorkspace } from "./ui/brain/BrainResponseWorkspace.tsx";
import { AskBrainBar } from "./ui/brain/AskBrainBar.tsx";
import { RightContextPanel } from "./ui/brain/RightContextPanel.tsx";
import { TourHud } from "./ui/brain/TourHud.tsx";
import { useMemory } from "./memory/localMemory.ts";
import { AnalysisView } from "./ui/analysis/AnalysisView.tsx";
import { SettingsWorkspace } from "./ui/settings/SettingsWorkspace.tsx";
import { TodayBrief } from "./ui/surfaces/TodayBrief.tsx";
import { WorkQueue } from "./ui/surfaces/WorkQueue.tsx";
import { Account360 } from "./ui/surfaces/Account360.tsx";
import { AskSurface } from "./ui/surfaces/AskSurface.tsx";
import { AnalysisDashboard } from "./ui/surfaces/AnalysisDashboard.tsx";
import { CapacityAssessment } from "./ui/surfaces/CapacityAssessment.tsx";
import { ProgramContractTracker } from "./ui/surfaces/ProgramContractTracker.tsx";
import { countForSurface, type SurfaceId } from "./app/surfaces.ts";
import { createWorkItem } from "./app/workItems.ts";

const ALL_MARKETS_VALUE = "__all_markets__";
const ProspectMap = lazy(() => import("./ui/map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));
const DocumentViewer = lazy(() => import("./ui/deliverables/DocumentViewer.tsx").then((module) => ({ default: module.DocumentViewer })));

function formatRunDate(value: string | null | undefined): string {
  if (!value) return "not available";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function App() {
  const { city, activeHome, activeSettings, activeSurface, brainResponse, activeCompanyId, demoAction, activeDeliverable, activeAnalysisSpec, tourRequested } = useStore();
  const [workItemStatus, setWorkItemStatus] = useState("");
  const memory = useMemory();
  const marketWorld = useWorld(city); // selected-market scope; null means all markets.
  const world = useWorld(null); // global — dashboard, graph, and the dossier
  const settingsActive = (activeSettings || activeSurface === "settings") && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const homeActive = (activeHome || activeSurface === "brief") && !settingsActive && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const marketScoped = activeSurface === "map" && !homeActive && !settingsActive && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
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
    if (activeDeliverable) return (
      <Suspense fallback={<div className="loading">loading deliverable…</div>}>
        <DocumentViewer deliverable={activeDeliverable} world={world} />
      </Suspense>
    );
    if (brainResponse) return <BrainResponseWorkspace response={brainResponse} world={viewWorld ?? world} />;
    switch (activeSurface) {
      case "brief": return <TodayBrief world={world} />;
      case "work_queue": return <WorkQueue world={world} />;
      case "accounts": return <Account360 world={world} />;
      case "ask": return <AskSurface world={world} />;
      case "map": return viewWorld ? (
        <Suspense fallback={<div className="loading">loading map…</div>}>
          <ProspectMap world={viewWorld} />
        </Suspense>
      ) : <div className="loading">loading map…</div>;
      case "analysis": return <AnalysisDashboard world={world} />;
      case "capacity": return <CapacityAssessment world={world} />;
      case "programs": return <ProgramContractTracker world={world} />;
      case "settings": return <SettingsWorkspace />;
      default: return <TodayBrief world={world} />;
    }
  };
  const counts = Object.fromEntries(
    (["brief", "work_queue", "accounts", "ask", "map", "analysis", "capacity", "programs", "settings"] as SurfaceId[])
      .map((surface) => [surface, countForSurface(surface, world, memory)]),
  ) as Partial<Record<SurfaceId, number>>;

  const rightPanelOpen = dossierOpen || contextPanelOpen;

  return (
    <div
      className={rightPanelOpen ? "quiet-cockpit right-panel-open" : "quiet-cockpit"}
      style={{ "--right-w": rightW } as React.CSSProperties}
    >
      <BrainSidebar activeSurface={settingsActive ? "settings" : homeActive ? "brief" : activeSurface} counts={counts} />
      <main className="quiet-main" onClickCapture={() => {
        if (activeCompanyId) setState({ activeCompanyId: null });
      }}>
        <header className="quiet-topbar">
          <button className="quiet-brand" onClick={goHome}>{PROFILE.name} Revenue Brain</button>
          {world?.dataMode === "hybrid" && world.provenanceSummary && (
            <div className="data-provenance-status">
              <span>Data provenance</span>
              <strong>{world.provenanceSources.length} sources: {world.provenanceSummary}</strong>
            </div>
          )}
          {world?.dataSource && !world.loadErrors.length && (
            <div className="live-source-status">
              <span>Live</span>
              <strong>{world.dataSource}</strong>
            </div>
          )}
          {world?.loadErrors.length ? (
            <div className="live-source-status error" role="status">
              <span>Live data issue</span>
              <strong>{world.loadErrors[0]}</strong>
            </div>
          ) : null}
          {world?.snapshot?.publicSignals.source_mode === "artifact" && (
            <div className={world.snapshot.publicSignals.stale ? "artifact-status stale" : "artifact-status"}>
              <span>Monitor run</span>
              <strong>{formatRunDate(world.snapshot.publicSignals.run_at)}</strong>
              {world.snapshot.publicSignals.stale && <em>stale data</em>}
            </div>
          )}
          {world?.snapshot?.publicSignals.source_mode === "artifact_fallback" && (
            <div className="artifact-status fallback">
              <span>Artifact fallback</span>
              <strong>{world.snapshot.publicSignals.notice ?? "Using demo signals"}</strong>
            </div>
          )}
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
        {world && !homeActive && !settingsActive && activeSurface !== "ask" && <AskBrainBar world={viewWorld ?? world} />}
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
            <p className="eyebrow">Create work item</p>
            <h2 id="demo-action-title">{demoAction.title}</h2>
            {demoAction.accountName && <p className="demo-action-account">{demoAction.accountName}</p>}
            <p>
              Review the action before creating a durable backend work item. CRM execution is intentionally separate and lands in the later CRM write workflow.
            </p>
            {demoAction.evidence && (
              <div className="demo-action-evidence">
                <span>Evidence attached</span>
                <strong>{demoAction.evidence}</strong>
              </div>
            )}
            <div className="demo-action-steps">
              <span>Create work item</span>
              <span>Attach evidence</span>
              <span>Assign owner</span>
              <span>Queue approval</span>
            </div>
            {workItemStatus && <div className={workItemStatus.startsWith("Created") ? "live-inline-status" : "live-inline-status error"}>{workItemStatus}</div>}
            <div className="demo-action-modal-actions">
              <button
                onClick={() => {
                  setWorkItemStatus("Creating work item...");
                  void createWorkItem({
                    title: demoAction.title,
                    accountName: demoAction.accountName,
                    accountId: demoAction.accountId,
                    sourceSignalIds: demoAction.sourceSignalIds,
                    evidence: demoAction.evidence,
                    type: demoAction.workItemType,
                  }).then((item) => {
                    setWorkItemStatus(`Created work item ${item.id}.`);
                    window.setTimeout(() => {
                      closeDemoAction();
                      setWorkItemStatus("");
                      setState({ activeSurface: "work_queue" });
                    }, 800);
                  }).catch((error) => {
                    setWorkItemStatus(error instanceof Error ? error.message : "Could not create work item.");
                  });
                }}
              >
                Confirm
              </button>
              <button onClick={() => {
                setWorkItemStatus("");
                closeDemoAction();
              }}>Cancel</button>
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
