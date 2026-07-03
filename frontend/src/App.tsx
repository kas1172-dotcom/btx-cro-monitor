import { useStore, setState } from "./store/store.ts";
import type { View } from "./store/store.ts";
import { useWorld } from "./app/useWorld.ts";
import { CITIES, PROFILE } from "./app/config.ts";
import { ProspectMap } from "./ui/map/ProspectMap.tsx";
import { Dashboard } from "./ui/dashboard/Dashboard.tsx";
import { RelationshipGraph } from "./ui/graph/RelationshipGraph.tsx";
import { SignalFeed } from "./ui/feed/SignalFeed.tsx";
import { Copilot } from "./ui/copilot/Copilot.tsx";
import { Dossier } from "./ui/company/Dossier.tsx";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "map", label: "Prospect Map" },
  { id: "dashboard", label: "Dashboard" },
  { id: "graph", label: "Relationships" },
  { id: "feed", label: "Signal Feed" },
];

export function App() {
  const { city, view, activeCompanyId } = useStore();
  const cityWorld = useWorld(city); // city-scoped — the prospect map
  const world = useWorld(null); // global — dashboard, graph, and the dossier

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◇</span> {PROFILE.name} <span className="brand-sub">Enterprise Brain</span>
        </div>
        <div className="controls">
          <label className="city-picker">
            <span>You are in</span>
            <select value={city} onChange={(e) => setState({ city: e.target.value, activeCompanyId: null })}>
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
        {view === "map" ? (
          cityWorld ? <ProspectMap world={cityWorld} /> : <div className="loading">running the brain for {city}…</div>
        ) : view === "dashboard" ? (
          world ? <Dashboard world={world} /> : <div className="loading">loading…</div>
        ) : view === "feed" ? (
          world ? <SignalFeed world={world} /> : <div className="loading">loading…</div>
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
