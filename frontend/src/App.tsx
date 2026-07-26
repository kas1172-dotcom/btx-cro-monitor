import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore, setState, closeDemoAction, goHome, clearTourRequest, closeDeliverableWizard } from "./store/store.ts";
import { useWorld } from "./app/useWorld.ts";
import { Dossier } from "./ui/company/Dossier.tsx";
import { BrainSidebar } from "./ui/brain/BrainSidebar.tsx";
import { BrainResponseWorkspace } from "./ui/brain/BrainResponseWorkspace.tsx";
import { RightContextPanel } from "./ui/brain/RightContextPanel.tsx";
import { TourHud } from "./ui/brain/TourHud.tsx";
import { useMemory } from "./memory/localMemory.ts";
import { TodayBrief } from "./ui/surfaces/TodayBrief.tsx";
import { WorkQueue } from "./ui/surfaces/WorkQueue.tsx";
import { Account360 } from "./ui/surfaces/Account360.tsx";
import { AskSurface } from "./ui/surfaces/AskSurface.tsx";
import { ALL_SURFACES, countForSurface, type TabId } from "./app/surfaces.ts";
import { createWorkItem } from "./app/workItems.ts";
import { AppShell, StatusChip } from "./ui/primitives.tsx";
import { CommandPalette, ContextRibbon } from "./ui/CommandPalette.tsx";
import { CockpitAuthStatus } from "./app/clerkAuth.tsx";
import type { Deliverable } from "./deliverables/types.ts";
import { checkAiStatus, getAiStatusSnapshot, subscribeAiStatus } from "./app/aiStatus.ts";
import { accountPath, navigateTo, useAppRoute } from "./app/router.ts";

const ALL_MARKETS_VALUE = "__all_markets__";
const AnalysisView = lazy(() => import("./ui/analysis/AnalysisView.tsx").then((module) => ({ default: module.AnalysisView })));
const SettingsWorkspace = lazy(() => import("./ui/settings/SettingsWorkspace.tsx").then((module) => ({ default: module.SettingsWorkspace })));
const AnalysisDashboard = lazy(() => import("./ui/surfaces/AnalysisDashboard.tsx").then((module) => ({ default: module.AnalysisDashboard })));
const CapacityAssessment = lazy(() => import("./ui/surfaces/CapacityAssessment.tsx").then((module) => ({ default: module.CapacityAssessment })));
const ProgramContractTracker = lazy(() => import("./ui/surfaces/ProgramContractTracker.tsx").then((module) => ({ default: module.ProgramContractTracker })));
const DeliverableLibrary = lazy(() => import("./ui/surfaces/DeliverableLibrary.tsx").then((module) => ({ default: module.DeliverableLibrary })));
const HubSpotViewer = lazy(() => import("./ui/surfaces/HubSpotViewer.tsx").then((module) => ({ default: module.HubSpotViewer })));
const Prospecting = lazy(() => import("./ui/surfaces/Prospecting.tsx").then((module) => ({ default: module.Prospecting })));
const TripPlanner = lazy(() => import("./ui/surfaces/TripPlanner.tsx").then((module) => ({ default: module.TripPlanner })));
const ProspectMap = lazy(() => import("./ui/map/ProspectMap.tsx").then((module) => ({ default: module.ProspectMap })));
const DocumentViewer = lazy(() => import("./ui/deliverables/DocumentViewer.tsx").then((module) => ({ default: module.DocumentViewer })));
const DeliverableWizard = lazy(() => import("./ui/deliverables/DeliverableWizard.tsx").then((module) => ({ default: module.DeliverableWizard })));

export function App() {
  const { city, brainResponse, activeCompanyId, demoAction, activeDeliverable, activeDeliverableOrigin, activeAnalysisSpec, tourRequested, deliverableWizardRequest } = useStore();
  const route = useAppRoute();
  const routeTab = route.tab;
  const [workItemStatus, setWorkItemStatus] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const handledWizardSaveIds = useRef(new Set<number>());
  const memory = useMemory();
  const marketWorld = useWorld(city); // selected-market scope; null means all markets.
  const world = useWorld(null); // global - dashboard, graph, and the dossier
  const aiStatus = useSyncExternalStore(subscribeAiStatus, getAiStatusSnapshot, getAiStatusSnapshot);
  const settingsActive = routeTab === "settings" && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const homeActive = routeTab === "brief" && !settingsActive && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const marketScoped = routeTab === "map" && !homeActive && !settingsActive && !brainResponse && !activeDeliverable && !activeAnalysisSpec;
  const viewWorld = marketScoped ? marketWorld ?? world : world;
  const cityOptions = [...new Set((world?.companies ?? []).map((company) => company.location.city).filter(Boolean))].sort();

  // Right-panel: dossier takes priority over context panel, one at a time.
  const routedAccountId = route.id === "accounts" ? route.accountId : null;
  const previewAccountId = route.id === "accounts" ? null : (route.accountId ?? activeCompanyId);
  const dossierOpen = !!previewAccountId;
  const contextPanelOpen = !dossierOpen && !!brainResponse;
  const rightW = dossierOpen ? "minmax(360px, 420px)" : contextPanelOpen ? "320px" : "0px";

  useEffect(() => {
    void checkAiStatus();
  }, []);

  useEffect(() => {
    const routeLabel = route.id === "not_found"
      ? "Page not found"
      : ALL_SURFACES.find((surface) => surface.id === routeTab)?.label ?? "Cockpit";
    document.title = `${routeLabel} | BTX Precision`;
  }, [route.id, routeTab]);

  useEffect(() => {
    setState({
      activeTab: routeTab,
      activeHome: routeTab === "brief",
      activeSettings: routeTab === "settings",
      activeCompanyId: previewAccountId,
    });
  }, [previewAccountId, routeTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key !== "Escape") return;
      if (commandOpen) {
        event.stopPropagation();
        setCommandOpen(false);
        return;
      }
      // Close topmost open panel only - never navigate away.
      if (previewAccountId) {
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
  }, [brainResponse, commandOpen, previewAccountId]);
  const renderDefault = () => {
    if (route.id === "not_found") return <RouteNotFound path={route.path} />;
    if (settingsActive) return (
      <Suspense fallback={<div className="loading">loading settings...</div>}>
        <SettingsWorkspace />
      </Suspense>
    );
    if (!world) return <div className="loading">loading…</div>;
    if (activeAnalysisSpec) return (
      <Suspense fallback={<div className="loading">loading analysis...</div>}>
        <AnalysisView world={world} initialSpec={activeAnalysisSpec} />
      </Suspense>
    );
    if (activeDeliverable) return (
      <Suspense fallback={<div className="loading">loading deliverable…</div>}>
        <DocumentViewer deliverable={activeDeliverable} world={world} openedFrom={activeDeliverableOrigin ?? "generation"} />
      </Suspense>
    );
    if (brainResponse) return <BrainResponseWorkspace response={brainResponse} world={viewWorld ?? world} />;
    switch (routeTab) {
      case "brief": return <TodayBrief world={world} />;
      case "work_queue": return <WorkQueue world={world} workItemId={route.workItemId} />;
      case "accounts": return <Account360 world={world} accountId={routedAccountId} onSelectAccount={(accountId) => navigateTo(accountPath(accountId))} />;
      case "ask": return <AskSurface world={world} />;
      case "prospecting": return (
        <Suspense fallback={<div className="loading">loading prospecting...</div>}>
          <Prospecting world={world} />
        </Suspense>
      );
      case "trip_planner": return (
        <Suspense fallback={<div className="loading">loading trip planner...</div>}>
          <TripPlanner world={world} />
        </Suspense>
      );
      case "map": return viewWorld ? (
        <Suspense fallback={<div className="loading">loading map…</div>}>
          <ProspectMap world={viewWorld} selectedAccountId={previewAccountId} onSelectAccount={(accountId) => navigateTo(`/map?account=${encodeURIComponent(accountId)}`)} />
        </Suspense>
      ) : <div className="loading">loading map…</div>;
      case "analysis": return (
        <Suspense fallback={<div className="loading">loading analysis...</div>}>
          <AnalysisDashboard world={world} />
        </Suspense>
      );
      case "capacity": return (
        <Suspense fallback={<div className="loading">loading capacity...</div>}>
          <CapacityAssessment world={world} />
        </Suspense>
      );
      case "programs": return (
        <Suspense fallback={<div className="loading">loading programs...</div>}>
          <ProgramContractTracker world={world} />
        </Suspense>
      );
      case "deliverables": return (
        <Suspense fallback={<div className="loading">loading deliverables...</div>}>
          <DeliverableLibrary world={world} />
        </Suspense>
      );
      case "hubspot": return (
        <Suspense fallback={<div className="loading">loading HubSpot...</div>}>
          <HubSpotViewer world={world} />
        </Suspense>
      );
      case "settings": return (
        <Suspense fallback={<div className="loading">loading settings...</div>}>
          <SettingsWorkspace />
        </Suspense>
      );
      default: return <TodayBrief world={world} />;
    }
  };
  const counts = Object.fromEntries(
    ALL_SURFACES.map((surface) => [surface.id, countForSurface(surface.id, world, memory)]),
  ) as Partial<Record<TabId, number>>;

  const rightPanelOpen = dossierOpen || contextPanelOpen;
  const surfaceTitle = ALL_SURFACES.find((surface) => surface.id === (settingsActive ? "settings" : homeActive ? "brief" : routeTab))?.label ?? "Cockpit";
  const sourceFailures = world?.sources.filter((source) => source.verification === "failed") ?? [];
  const systemNeedsAttention = Boolean(world?.loadErrors.length || sourceFailures.length || aiStatus.state === "offline");
  const commandShortcut = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  const globalViewMode = route.query.get("view");
  const shellClassName = [
    "quiet-cockpit",
    rightPanelOpen ? "right-panel-open" : "",
    globalViewMode === "focus" ? "app-focus-mode" : "",
    globalViewMode === "briefing" ? "app-briefing-mode" : "",
  ].filter(Boolean).join(" ");

  async function handleWizardCommitted(deliverable: Deliverable) {
    const request = deliverableWizardRequest;
    if (!request?.afterSave || handledWizardSaveIds.current.has(request.id)) return;
    handledWizardSaveIds.current.add(request.id);
    if (request.afterSave.kind === "create_work_item") {
      const artifactRef = deliverable.backendRecordId ?? deliverable.id;
      setWorkItemStatus("Creating work item...");
      try {
        await createWorkItem({ ...request.afterSave.draft, evidence: artifactRef });
        if (request.afterSave.openDeliverable) {
          closeDeliverableWizard();
          setState({
            activeDeliverable: deliverable,
            activeDeliverableOrigin: "generation",
            activeTab: "deliverables",
            activeCompanyId: null,
            brainResponse: null,
            activeAnalysisSpec: null,
          });
        }
        setWorkItemStatus("Created work item.");
      } catch (error) {
        setWorkItemStatus(error instanceof Error ? error.message : "Could not create work item.");
        if (request.afterSave.openDeliverable) {
          closeDeliverableWizard();
          setState({
            activeDeliverable: deliverable,
            activeDeliverableOrigin: "generation",
            activeTab: "deliverables",
            activeCompanyId: null,
            brainResponse: null,
            activeAnalysisSpec: null,
          });
        }
      }
    }
  }

  return (
    <AppShell
      className={shellClassName}
      rightW={rightW}
      rail={<BrainSidebar activeTab={settingsActive ? "settings" : homeActive ? "brief" : routeTab} counts={counts} />}
      topbar={(
        <header className="quiet-topbar">
          <div className="surface-title">
            <span>{world?.worldSnapshot?.tenant.displayName ?? "Workspace"}</span>
            <strong>{surfaceTitle}</strong>
          </div>
          <div className="topbar-status">
            <button type="button" className="global-command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
              Command <kbd>{commandShortcut}</kbd>
            </button>
            <StatusChip
              tone={systemNeedsAttention ? "warning" : "success"}
              label="System status"
              value={systemNeedsAttention ? "Needs attention" : "Ready"}
            />
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
                {cityOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>}
            <CockpitAuthStatus />
          </div>
        </header>
      )}
      onMainClickCapture={() => {
        if (previewAccountId) setState({ activeCompanyId: null });
      }}
      side={(
        <>
          <RightContextPanel response={brainResponse} />
          <aside className={dossierOpen ? "inspector open" : "inspector"}>
            {dossierOpen && (
              <div className="inspector-topbar">
                <button className="inspector-back" onClick={() => setState({ activeCompanyId: null })} aria-label="Close dossier">×</button>
              </div>
            )}
            {world && previewAccountId ? (
              <Dossier world={world} companyId={previewAccountId} />
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
                          navigateTo("/work");
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
          {world && deliverableWizardRequest && (
            <Suspense fallback={<div className="loading">loading wizard...</div>}>
              <DeliverableWizard
                key={deliverableWizardRequest.id}
                world={world}
                initialAgentId={deliverableWizardRequest.agentId}
                initialAccountId={deliverableWizardRequest.accountId}
                initialInstructions={deliverableWizardRequest.instructions}
                startStep={deliverableWizardRequest.startStep}
                onCommitted={handleWizardCommitted}
                onClose={closeDeliverableWizard}
              />
            </Suspense>
          )}
        </>
      )}
    >
      <ContextRibbon world={world} />
      <section className="quiet-stage">{renderDefault()}</section>
      <CommandPalette world={world} open={commandOpen} onClose={() => setCommandOpen(false)} />
    </AppShell>
  );
}

function RouteNotFound({ path }: { path: string }) {
  return (
    <section className="surface-page" data-surface-component="surface-not-found">
      <div className="surface-panel">
        <p className="eyebrow">Not found</p>
        <h1>That page is not available.</h1>
        <p>The route <code>{path}</code> does not match a cockpit workspace.</p>
        <button type="button" onClick={() => navigateTo("/today", { replace: true })}>Open Today</button>
      </div>
    </section>
  );
}
