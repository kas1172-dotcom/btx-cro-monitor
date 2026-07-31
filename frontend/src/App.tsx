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
import { canonicalMetricForSurface, type DisplayMetric } from "./app/canonicalMetrics.ts";
import { createWorkItem } from "./app/workItems.ts";
import { AppShell, SurfaceHeader } from "./ui/primitives.tsx";
import { CommandPalette } from "./ui/CommandPalette.tsx";
import type { Deliverable } from "./deliverables/types.ts";
import { getStoredDeliverable, recordToDeliverable } from "./app/deliverablesApi.ts";
import { checkAiStatus, getAiStatusSnapshot, subscribeAiStatus } from "./app/aiStatus.ts";
import { accountPath, deliverablePath, figureInsertPath, figureSpecFromRoute, navigateTo, useAppRoute } from "./app/router.ts";
import { sourceFreshness, sourceModeLabel, sourcePermissionLabel } from "./app/sourceRegistry.ts";
import { BUILD_ENVIRONMENT, loadEnvironmentContract, type EnvironmentContract } from "./app/environmentContract.ts";
import type { AppRoute } from "./app/router.ts";

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
const IndustryUpdates = lazy(() => import("./ui/intelligence/IndustryUpdates.tsx").then((module) => ({ default: module.IndustryUpdates })));
const DeliverableWizard = lazy(() => import("./ui/deliverables/DeliverableWizard.tsx").then((module) => ({ default: module.DeliverableWizard })));

const ROUTE_LOAD_LABELS: Record<AppRoute["id"], { title: string; detail: string }> = {
  today: { title: "Preparing briefing", detail: "Loading account signals, work state, and source health." },
  work: { title: "Loading work queue", detail: "Checking current assignments, approvals, and execution status." },
  accounts: { title: "Loading account workspace", detail: "Resolving account records, CRM provenance, contacts, and deals." },
  programs: { title: "Loading program tracker", detail: "Collecting program signals and contract context." },
  industry_updates: { title: "Loading industry updates", detail: "Collecting monitor records and source freshness." },
  prospecting: { title: "Loading prospects", detail: "Scoring account records and mapped opportunities." },
  capacity: { title: "Loading capacity", detail: "Checking facility and operating-data availability." },
  analysis: { title: "Loading analysis", detail: "Preparing metrics, charts, and freshness checks." },
  map: { title: "Loading map", detail: "Resolving mapped accounts and geography." },
  ask: { title: "Loading assistant workspace", detail: "Preparing conversations and account context." },
  deliverables: { title: "Loading deliverables", detail: "Preparing saved documents and source-backed figures." },
  integrations: { title: "Loading integrations", detail: "Checking CRM, monitor, and backend source health." },
  settings: { title: "Loading settings", detail: "Preparing environment and source configuration." },
  not_found: { title: "Checking route", detail: "Looking up the requested cockpit route." },
};

export function App() {
  const { city, brainResponse, activeCompanyId, demoAction, tourRequested, deliverableWizardRequest } = useStore();
  const route = useAppRoute();
  const routeTab = route.tab;
  const [workItemStatus, setWorkItemStatus] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentContract>(BUILD_ENVIRONMENT);
  const handledWizardSaveIds = useRef(new Set<number>());
  const memory = useMemory();
  const marketWorld = useWorld(city); // selected-market scope; null means all markets.
  const world = useWorld(null); // global - dashboard, graph, and the dossier
  const aiStatus = useSyncExternalStore(subscribeAiStatus, getAiStatusSnapshot, getAiStatusSnapshot);
  const settingsActive = routeTab === "settings" && !brainResponse;
  const homeActive = routeTab === "brief" && !settingsActive && !brainResponse;
  const marketScoped = routeTab === "map" && !homeActive && !settingsActive && !brainResponse;
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
    void loadEnvironmentContract().then(setEnvironment).catch(() => {
      // Build truth remains visible if the diagnostic is temporarily unavailable.
    });
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
      if (route.query.has("view")) {
        event.stopPropagation();
        navigateTo(route.path);
        return;
      }
      if (route.id === "deliverables" && route.deliverableView !== "library") {
        event.stopPropagation();
        navigateTo("/deliverables");
        return;
      }
      goHome();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [brainResponse, commandOpen, previewAccountId, route]);
  const renderDefault = () => {
    if (route.id === "not_found") return <RouteNotFound path={route.path} />;
    if (settingsActive) return (
      <Suspense fallback={<div className="loading">loading settings...</div>}>
        <SettingsWorkspace />
      </Suspense>
    );
    if (!world || !world.worldSnapshot) return <RouteDataFallback route={route} world={world} />;
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
      case "industry_updates": return (
        <Suspense fallback={<div className="loading">loading industry updates...</div>}>
          <IndustryUpdates world={world} />
        </Suspense>
      );
      case "deliverables": return (
        <Suspense fallback={<div className="loading">loading deliverables...</div>}>
          {route.deliverableView === "insert_figure" ? (
            <AnalysisView
              key={route.query.toString()}
              world={world}
              initialSpec={figureSpecFromRoute(route)}
              onCancel={() => navigateTo("/deliverables")}
              onSpecChange={(spec) => navigateTo(figureInsertPath(spec), { replace: true })}
            />
          ) : route.deliverableView === "document" && route.deliverableId ? (
            <RoutedDocumentViewer deliverableId={route.deliverableId} localDeliverables={memory.deliverables} world={world} />
          ) : (
            <DeliverableLibrary world={world} />
          )}
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
  const surfaceMetrics = Object.fromEntries(
    ALL_SURFACES.map((surface) => [surface.id, canonicalMetricForSurface(surface.id, world, memory)]),
  ) as Partial<Record<TabId, DisplayMetric>>;

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
          navigateTo(deliverablePath(deliverable.backendRecordId ?? deliverable.id));
        }
        setWorkItemStatus("Created work item.");
      } catch (error) {
        setWorkItemStatus(error instanceof Error ? error.message : "Could not create work item.");
        if (request.afterSave.openDeliverable) {
          closeDeliverableWizard();
          navigateTo(deliverablePath(deliverable.backendRecordId ?? deliverable.id));
        }
      }
    }
  }

  return (
    <AppShell
      className={shellClassName}
      rightW={rightW}
      banner={environment.isDemonstration ? (
        <div className="environment-demo-banner" role="status" aria-label="Demonstration environment">
          {environment.demoNotice ?? "Demonstration — internal records are illustrative"}
        </div>
      ) : null}
      rail={<BrainSidebar activeTab={settingsActive ? "settings" : homeActive ? "brief" : routeTab} counts={counts} metrics={surfaceMetrics} />}
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
            <div className="system-status-wrap">
              <button
                type="button"
                className="system-status-trigger"
                onClick={() => setSystemOpen((value) => !value)}
                aria-expanded={systemOpen}
                aria-controls="system-status-panel"
              >
                System <span className={systemNeedsAttention ? "system-dot warning" : "system-dot"} />
              </button>
              {systemOpen && (
                <section id="system-status-panel" className="system-status-panel" aria-label="System status">
                  <div className="system-panel-head">
                    <strong>System status</strong>
                    <button type="button" onClick={() => setSystemOpen(false)} aria-label="Close system status">Close</button>
                  </div>
                  <div className="system-source-list">
                    {(world?.sources ?? []).map((source) => (
                      <div key={source.id}>
                        <span><strong>{source.name}</strong><small>{sourceModeLabel(source)}</small></span>
                        <span><strong>{sourceFreshness(source).relative}</strong><small>{sourcePermissionLabel(source)}</small></span>
                      </div>
                    ))}
                    <div>
                        <span><strong>Assistant</strong><small>{aiStatus.state === "live" ? "AI connected" : "Rules-based summary"}</small></span>
                      <span><strong>{aiStatus.state === "live" ? "Available" : "Generative answers unavailable"}</strong></span>
                    </div>
                  </div>
                  <button type="button" className="system-details-link" onClick={() => { setSystemOpen(false); navigateTo("/integrations"); }}>View integration details</button>
                </section>
              )}
            </div>
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
      <section className="quiet-stage">{renderDefault()}</section>
      <CommandPalette world={world} open={commandOpen} onClose={() => setCommandOpen(false)} />
    </AppShell>
  );
}

function RouteDataFallback({ route, world }: { route: AppRoute; world: ReturnType<typeof useWorld> }) {
  const copy = ROUTE_LOAD_LABELS[route.id];
  const elapsedSeconds = Math.round((world?.loadElapsedMs ?? 0) / 1000);
  const error = world?.loadErrors[0] ?? null;
  const isError = world?.queryStatus === "error";
  const delayed = Boolean(world?.isTimedOut);
  const offline = Boolean(world?.isOffline || world?.loadErrorKind === "offline");
  const auth = world?.loadErrorKind === "auth";
  const status = offline
    ? "Browser appears offline."
    : auth
      ? "Your session may have expired."
      : isError
        ? "The data service rejected the request."
        : delayed
          ? "This route is taking longer than expected."
          : "Request in progress.";
  return (
    <section className="surface-page route-data-state" data-surface-component={`surface-route-${route.id}`}>
      <SurfaceHeader eyebrow="Route data" headline={copy.title} subline={copy.detail} />
      <div className="route-skeleton-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={isError || offline || auth ? "route-data-card error" : "route-data-card"} role={isError || offline || auth ? "alert" : "status"}>
        <strong>{status}</strong>
        <p>
          {delayed && !isError ? `Still waiting after ${Math.max(elapsedSeconds, 1)} seconds. You can navigate elsewhere while this keeps trying.` : null}
          {isError && error ? error : null}
          {!delayed && !isError ? "The cockpit shell stays available while this route loads." : null}
        </p>
        <div className="route-data-actions">
          <button type="button" onClick={() => world?.refresh()}>Retry</button>
          <button type="button" onClick={() => navigateTo("/today")}>Open Briefing</button>
          <button type="button" onClick={() => navigateTo("/work")}>Open Work</button>
        </div>
      </div>
    </section>
  );
}

function RoutedDocumentViewer({ deliverableId, localDeliverables, world }: { deliverableId: string; localDeliverables: Deliverable[]; world: NonNullable<ReturnType<typeof useWorld>> }) {
  const local = localDeliverables.find((item) => item.id === deliverableId || item.backendRecordId === deliverableId) ?? null;
  const [remote, setRemote] = useState<Deliverable | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setRemote(null);
    setError("");
    if (local) return;
    let current = true;
    void getStoredDeliverable(deliverableId)
      .then((record) => {
        if (current) setRemote(recordToDeliverable(record));
      })
      .catch(() => {
        if (current) setError("This saved deliverable is unavailable.");
      });
    return () => {
      current = false;
    };
  }, [deliverableId, local]);

  const deliverable = local ?? remote;
  if (deliverable) return <DocumentViewer key={deliverableId} deliverable={deliverable} world={world} openedFrom="library" />;
  if (error) {
    return (
      <section className="surface-page">
        <div className="surface-panel">
          <h1>Deliverable not found</h1>
          <p>{error}</p>
          <button type="button" onClick={() => navigateTo("/deliverables")}>Back to Deliverables</button>
        </div>
      </section>
    );
  }
  return <div className="loading">loading saved deliverable…</div>;
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
