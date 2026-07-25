// Geographic prospecting map. Plots the scored companies in the selected market;
// prospects (targets + customers) scale by backend account attractiveness. Click a pin -> the route's
// selected account updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, CircleMarker, Tooltip, ZoomControl } from "react-leaflet";
import { useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { World } from "../../app/useWorld.ts";
import { explainRankingPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { AskButton } from "../ask/AskButton.tsx";
import { buildMapMarkers, mapCenter, mappableCompanies } from "./mapModel.ts";
import { uiTokens } from "../../app/uiTokens.ts";
import { AccountToken } from "../common/AccountToken.tsx";
import { DarkMapTiles } from "./DarkMapTiles.tsx";
import { prospectQualificationLabel } from "../../app/confidence.ts";

function MapSizeInvalidator({ watchKey }: { watchKey: string }) {
  const map = useMap();
  useEffect(() => {
    const invalidate = () => map.invalidateSize();
    const frame = window.requestAnimationFrame(invalidate);
    const timer = window.setTimeout(invalidate, 180);
    window.addEventListener("resize", invalidate);
    window.addEventListener("orientationchange", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("orientationchange", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
    };
  }, [map, watchKey]);
  return null;
}

function FitMapBounds({ points, watchKey }: { points: Array<[number, number]>; watchKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) {
      map.setView([31.5, -97], 5);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 11 });
  }, [map, points, watchKey]);
  return null;
}

export function ProspectMap({ world, selectedAccountId, onSelectAccount }: { world: World; selectedAccountId?: string | null; onSelectAccount?: (accountId: string) => void }) {
  const markers = buildMapMarkers(world.companies, world.analysis.byId, world.scoreResults);
  const center = mapCenter(mappableCompanies(world.companies));
  const omittedCount = world.companies.length - markers.length;
  const marketLabel = world.city ?? "All Markets";
  const initialZoom = world.city ? 11 : 4;
  const watchKey = `${world.city ?? "all"}:${markers.length}:${selectedAccountId ?? "none"}`;

  return (
    <div className="map-shell" data-surface-component="surface-map">
      <MapContainer key={world.city ?? "all"} center={center} zoom={initialZoom} className="map" scrollWheelZoom zoomControl={false}>
        <MapSizeInvalidator watchKey={watchKey} />
        <FitMapBounds points={markers.map((marker) => marker.center)} watchKey={watchKey} />
        <ZoomControl position="bottomright" />
        <DarkMapTiles />
        {markers.map(({ company: c, center: markerCenter, opportunity: opp, scoreStatus, prospect, radius }) => {
          const active = c.id === selectedAccountId;
          const color = prospect ? uiTokens.color.success : uiTokens.color.textMuted;
          return (
            <CircleMarker
              key={c.id}
              center={markerCenter}
              radius={radius}
              pathOptions={{
                color: active ? uiTokens.color.textPrimary : color,
                weight: active ? 3 : 1,
                fillColor: color,
                fillOpacity: prospect ? 0.78 : 0.45,
              }}
              eventHandlers={{ click: () => onSelectAccount?.(c.id) }}
            >
              <Tooltip direction="top" opacity={0.93} permanent={false} sticky={false}>
                <strong>{c.name}</strong>
                {prospect ? `  ·  attractiveness ${Math.round(opp)} (${scoreStatus})` : `  ·  ${c.relationship}`}
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
          {world.prospects.slice(0, 12).map((p, i) => {
            const qualification = prospectQualificationLabel({
              company: p.company,
              contact: p.contact,
              opportunities: world.opportunities.filter((opportunity) => opportunity.company_id === p.company.id),
              fitMatched: p.fit.matched,
            });
            return (
            <button
              key={p.company.id}
              className={p.company.id === selectedAccountId ? "map-prospect active" : "map-prospect"}
              onClick={() => onSelectAccount?.(p.company.id)}
            >
              <span className="map-prospect-rank">
                <span className="rank-badge">#{i + 1}</span>
                <AccountToken name={p.company.name} riskScore={p.score.dimensions.risk.score} size="sm" />
              </span>
              <span className="map-prospect-main">
                <strong>{p.company.name}</strong>
                <em>
                  Attractiveness {p.opportunity} · {qualification.label} · {p.company.location.city}
                </em>
                {p.topSignal && <small>{p.topSignal.event_type}: {p.topSignal.source_quote}</small>}
                <span className="map-prospect-actions">
                  <AskButton
                    label="Explain"
                    prompt={explainRankingPrompt(p.company.name, `Map rank #${i + 1}. Account attractiveness ${p.opportunity}, ${qualification.label}, missing ${qualification.gaps.join(", ") || "none"}, market ${marketLabel}. ${rankingExplanation(world, p.company, { rank: i + 1, dimension: "opportunity", fitScore: p.fit.score }).driverLine} Top signal: ${p.topSignal?.source_quote ?? "none"}.`)}
                  />
                  <AskButton
                    label="Draft outreach"
                    prompt={outreachPrompt(p.company, `Map prospect rank #${i + 1}. Account attractiveness ${p.opportunity}, ${qualification.label}, contact ${p.contact?.name ?? "not available"}.`)}
                  />
                </span>
              </span>
            </button>
            );
          })}
        </div>
        <div className="map-legend">
          <span><i className="legend-prospect" /> prospect/customer</span>
          <span><i className="legend-other" /> supplier/competitor/self</span>
        </div>
        <div className="map-legend">
          <span><AccountToken name="L" riskScore={10} size="sm" /> low urgency</span>
          <span><AccountToken name="M" riskScore={50} size="sm" /> medium urgency</span>
          <span><AccountToken name="H" riskScore={80} size="sm" /> high urgency</span>
        </div>
      </aside>
    </div>
  );
}
