// Geographic prospecting map. Plots the scored companies in the selected market;
// prospects (targets + customers) glow by opportunity. Click a pin -> the store's
// activeCompanyId updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from "react-leaflet";
import { useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { World } from "../../app/useWorld.ts";
import { setState, useStore } from "../../store/store.ts";
import { explainRankingPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { buildMapMarkers, filterCompaniesByCandidateIds, mapCenter, mappableCompanies } from "./mapModel.ts";
import { uiTokens } from "../../app/uiTokens.ts";

export interface MapCandidateMeta {
  rank: number;
  confidence: number;
}

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

function confidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.72) return "medium";
  return "low";
}

export function ProspectMap({
  world,
  candidateIds,
  candidateMeta = {},
  selectedCompanyId,
  onCompanyClick,
}: {
  world: World;
  candidateIds?: string[];
  candidateMeta?: Record<string, MapCandidateMeta>;
  selectedCompanyId?: string;
  onCompanyClick?: (companyId: string) => void;
}) {
  const { activeCompanyId } = useStore();
  const companies = filterCompaniesByCandidateIds(world.companies, candidateIds);
  const candidateMode = Boolean(candidateIds?.length);
  const markers = buildMapMarkers(world.companies, world.analysis.byId, candidateIds);
  const center = mapCenter(mappableCompanies(companies));
  const omittedCount = companies.length - markers.length;
  const marketLabel = world.city ?? "All Markets";
  const initialZoom = world.city ? 11 : 4;
  const watchKey = `${world.city ?? "all"}:${markers.length}:${activeCompanyId ?? "none"}:${candidateIds?.join(",") ?? "all"}`;
  const candidateProspects = candidateMode
    ? (candidateIds ?? []).flatMap((id) => {
      const company = world.companies.find((item) => item.id === id || item.canonical_account_id === id);
      return company ? [{ company, opportunity: 0, fit: { score: 0 }, contact: undefined, topSignal: null }] : [];
    })
    : world.prospects.slice(0, 12);

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
          const active = c.id === (selectedCompanyId ?? activeCompanyId);
          const meta = candidateMeta[c.id] ?? (c.canonical_account_id ? candidateMeta[c.canonical_account_id] : undefined);
          const tier = meta ? confidenceTier(meta.confidence) : null;
          const color = tier === "high"
            ? uiTokens.color.success
            : tier === "medium"
              ? uiTokens.color.warning
              : prospect
                ? uiTokens.color.success
                : uiTokens.color.textMuted;
          return (
            <CircleMarker
              key={c.id}
              center={markerCenter}
              radius={meta ? Math.min(17, 8 + meta.confidence * 8) : radius}
              pathOptions={{
                color: active ? uiTokens.color.textPrimary : color,
                weight: active ? 3 : 1,
                fillColor: color,
                fillOpacity: prospect ? 0.78 : 0.45,
              }}
              eventHandlers={{ click: () => onCompanyClick ? onCompanyClick(c.id) : setState({ activeCompanyId: c.id }) }}
            >
              <Tooltip direction="top" opacity={0.93} permanent={false} sticky={false}>
                <strong>{c.name}</strong>
                {meta ? `  ·  #${meta.rank}  ·  ${tier}` : prospect ? `  ·  opp ${opp}` : `  ·  ${c.relationship}`}
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
          {candidateProspects.map((p, i) => {
            const meta = candidateMeta[p.company.id] ?? (p.company.canonical_account_id ? candidateMeta[p.company.canonical_account_id] : undefined);
            const tier = meta ? confidenceTier(meta.confidence) : null;
            return (
            <button
              key={p.company.id}
              className={p.company.id === (selectedCompanyId ?? activeCompanyId) ? "map-prospect active" : "map-prospect"}
              onClick={() => onCompanyClick ? onCompanyClick(p.company.id) : setState({ activeCompanyId: p.company.id })}
            >
              <span className="rank-badge">#{meta?.rank ?? i + 1}</span>
              <span className="map-prospect-main">
                <strong>{p.company.name}</strong>
                <em>{candidateMode && tier ? `${tier} confidence · ${p.company.location.city}` : `Opp ${p.opportunity} · fit ${p.fit.score}% · ${p.company.location.city}`}</em>
                {!candidateMode && p.topSignal && <small>{p.topSignal.event_type}: {p.topSignal.source_quote}</small>}
                {!candidateMode && (
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
                )}
              </span>
            </button>
          );})}
        </div>
        <div className="map-legend">
          <span><i className="legend-prospect" /> prospect/customer</span>
          <span><i className="legend-other" /> supplier/competitor/self</span>
        </div>
      </aside>
    </div>
  );
}
