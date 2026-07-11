// Geographic prospecting map. Plots the scored companies in the selected market;
// prospects (targets + customers) glow by opportunity. Click a pin -> the store's
// activeCompanyId updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from "react-leaflet";
import { useMap } from "react-leaflet";
import type { World } from "../../app/useWorld.ts";
import { setState, useStore } from "../../store/store.ts";
import { explainRankingPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { buildMapMarkers, mapCenter, mappableCompanies } from "./mapModel.ts";

function MapSizeInvalidator({ watchKey }: { watchKey: string }) {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    const frame = window.requestAnimationFrame(invalidate);
    const timer = window.setTimeout(invalidate, 180);
    window.addEventListener("resize", invalidate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("resize", invalidate);
    };
  }, [map, watchKey]);
  return null;
}

export function ProspectMap({ world }: { world: World }) {
  const { activeCompanyId } = useStore();
  const markers = buildMapMarkers(world.companies, world.analysis.byId);
  const center = mapCenter(mappableCompanies(world.companies));
  const omittedCount = world.companies.length - markers.length;
  const marketLabel = world.city ?? "All Markets";
  const initialZoom = world.city ? 11 : 4;
  const watchKey = `${world.city ?? "all"}:${markers.length}:${activeCompanyId ?? "none"}`;

  return (
    <div className="map-shell">
      <MapContainer key={world.city ?? "all"} center={center} zoom={initialZoom} className="map" scrollWheelZoom zoomControl={false}>
        <MapSizeInvalidator watchKey={watchKey} />
        <ZoomControl position="bottomright" />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />
        {markers.map(({ company: c, center: markerCenter, opportunity: opp, prospect, radius }) => {
          const active = c.id === activeCompanyId;
          const color = prospect ? "#9ecf6a" : "#7b8467";
          return (
            <CircleMarker
              key={c.id}
              center={markerCenter}
              radius={radius}
              pathOptions={{
                color: active ? "#f4f1dc" : color,
                weight: active ? 3 : 1,
                fillColor: color,
                fillOpacity: prospect ? 0.78 : 0.45,
              }}
              eventHandlers={{ click: () => setState({ activeCompanyId: c.id }) }}
            >
              <Tooltip direction="top" opacity={0.93} permanent={false} sticky={false}>
                <strong>{c.name}</strong>
                {prospect ? `  ·  opp ${opp}` : `  ·  ${c.relationship}`}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <aside className="map-rail">
        <div className="map-rail-head">
          <span>{marketLabel}</span>
          <strong>{markers.length} mapped</strong>
        </div>
        {omittedCount > 0 && <p className="map-rail-note">{omittedCount} account{omittedCount === 1 ? "" : "s"} omitted: missing coordinates</p>}
        <div className="map-prospect-list">
          {world.prospects.slice(0, 12).map((p, i) => (
            <button
              key={p.company.id}
              className={p.company.id === activeCompanyId ? "map-prospect active" : "map-prospect"}
              onClick={() => setState({ activeCompanyId: p.company.id })}
            >
              <span className="rank-badge">#{i + 1}</span>
              <span className="map-prospect-main">
                <strong>{p.company.name}</strong>
                <em>Opp {p.opportunity} · fit {p.fit.score}% · {p.company.location.city}</em>
                {p.topSignal && <small>{p.topSignal.event_type}: {p.topSignal.source_quote}</small>}
                <span className="map-prospect-actions">
                  <AskChatpilButton
                    label="Explain"
                    prompt={explainRankingPrompt(p.company.name, `Map rank #${i + 1}. Opportunity ${p.opportunity}, fit ${p.fit.score}%, market ${marketLabel}. ${rankingExplanation(world, p.company, { rank: i + 1, dimension: "opportunity", fitScore: p.fit.score }).driverLine} Top signal: ${p.topSignal?.source_quote ?? "none"}.`)}
                  />
                  <AskChatpilButton
                    label="Draft outreach"
                    prompt={outreachPrompt(p.company, `Map prospect rank #${i + 1}. Opportunity ${p.opportunity}, fit ${p.fit.score}%, contact ${p.contact?.name ?? "not available"}.`)}
                  />
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="map-legend">
          <span><i className="legend-prospect" /> prospect/customer</span>
          <span><i className="legend-other" /> supplier/competitor/self</span>
        </div>
      </aside>
    </div>
  );
}
