import { useStore, setState } from "./store/store.ts";
import type { View } from "./store/store.ts";
import { useWorld } from "./app/useWorld.ts";
import { CITIES, PROFILE } from "./app/config.ts";
import { Home } from "./ui/home/Home.tsx";
import { CurrentBusiness } from "./ui/current/CurrentBusiness.tsx";
import { Prospecting } from "./ui/prospecting/Prospecting.tsx";
import { ProspectMap } from "./ui/map/ProspectMap.tsx";
import { Dashboard } from "./ui/dashboard/Dashboard.tsx";
import { RelationshipGraph } from "./ui/graph/RelationshipGraph.tsx";
import { SignalFeed } from "./ui/feed/SignalFeed.tsx";
import { OperatingSnapshot } from "./ui/operating/OperatingSnapshot.tsx";
import { Integrations } from "./ui/integrations/Integrations.tsx";
import { Copilot } from "./ui/copilot/Copilot.tsx";
import { Dossier } from "./ui/company/Dossier.tsx";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "home", label: "Home" },
  { id: "current", label: "Current Business" },
  { id: "prospecting", label: "Prospecting" },
  { id: "map", label: "Map" },
  { id: "dashboard", label: "Dashboard" },
  { id: "graph", label: "Graph" },
  { id: "feed", label: "Signals" },
  { id: "operating", label: "Operating Snapshot" },
  { id: "integrations", label: "Integrations" },
];

const ALL_MARKETS_VALUE = "__all_markets__";

export function App() {
  const { city, view, activeCompanyId } = useStore();
  const marketWorld = useWorld(city); // selected-market scope; null means all markets.
  const world = useWorld(null); // global — dashboard, graph, and the dossier
  const marketLabel = city ?? "All Markets";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◇</span> {PROFILE.name} <span className="brand-sub">Enterprise Brain</span>
        </div>
        <div className="demo-banner">
          Demo Mode — simulated CRM, ERP/capacity, contacts, pipeline, and market data.
        </div>
        <div className="controls">
          <label className="city-picker">
            <span>Market</span>
            <select
              value={city ?? ALL_MARKETS_VALUE}
              onChange={(e) => setState({
                city: e.target.value === ALL_MARKETS_VALUE ? null : e.target.value,
                activeCompanyId: null,
              })}
            >
              <option value={ALL_MARKETS_VALUE}>All Markets</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <nav className="tabs">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={v.id === view ? "tab active" : "tab"}
                onClick={() => setState({ view: v.id })}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="stage">
        {view === "home" ? (
          world ? <Home world={world} cityWorld={marketWorld} /> : <div className="loading">loading…</div>
        ) : view === "current" ? (
          world ? <CurrentBusiness world={world} /> : <div className="loading">loading…</div>
        ) : view === "prospecting" ? (
          world ? <Prospecting world={world} /> : <div className="loading">loading…</div>
        ) : view === "map" ? (
          marketWorld ? <ProspectMap world={marketWorld} /> : <div className="loading">running the brain for {marketLabel}…</div>
        ) : view === "dashboard" ? (
          world ? <Dashboard world={world} /> : <div className="loading">loading…</div>
        ) : view === "feed" ? (
          world ? <SignalFeed world={world} /> : <div className="loading">loading…</div>
        ) : view === "operating" ? (
          <OperatingSnapshot />
        ) : view === "integrations" ? (
          <Integrations />
        ) : (
          world ? <RelationshipGraph world={world} /> : <div className="loading">loading…</div>
        )}
        {world && <Copilot world={world} />}
      </main>

      <aside className={activeCompanyId ? "inspector open" : "inspector"}>
        {activeCompanyId && (
          <button className="inspector-back" onClick={() => setState({ activeCompanyId: null })}>← Back</button>
        )}
        {world && activeCompanyId ? (
          <Dossier world={world} companyId={activeCompanyId} />
        ) : (
          <div className="inspector-empty">
            <h3>Sale dossier</h3>
            <p>Click a pin or a row to see the prospect's opportunity, fit to {PROFILE.name}, buying signals, and who to call.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
