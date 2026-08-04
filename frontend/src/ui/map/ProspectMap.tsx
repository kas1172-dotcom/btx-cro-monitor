// Geographic prospecting map. Plots the scored companies in the selected market;
// prospects (targets + customers) scale by backend account attractiveness. Click a pin -> the route's
// selected account updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, CircleMarker, Popup, Tooltip, ZoomControl } from "react-leaflet";
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
import { EmptyState } from "../primitives.tsx";
import { canonicalMetrics, formatCanonicalMetric } from "../../app/canonicalMetrics.ts";
import { navigateTo } from "../../app/router.ts";

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

function SelectedMarkerController({ markers, selectedAccountId }: { markers: ReturnType<typeof buildMapMarkers>; selectedAccountId?: string | null }) {
  const map = useMap();
  useEffect(() => {
    const marker = markers.find((item) => item.company.id === selectedAccountId);
    if (!marker) return;
    map.flyTo(marker.center, Math.max(map.getZoom(), 10), { duration: 0.45 });
  }, [map, markers, selectedAccountId]);
  return null;
}

function FullBoundsControl({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  if (!points.length) return null;
  return (
    <button
      type="button"
      className="map-full-bounds"
      onClick={() => map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 11 })}
    >
      Show all markers
    </button>
  );
}

export function ProspectMap({ world, selectedAccountId, onSelectAccount, prospectsOnly = false }: { world: World; selectedAccountId?: string | null; onSelectAccount?: (accountId: string) => void; prospectsOnly?: boolean }) {
  const prospectCompanies = world.prospects
    .map((prospect) => prospect.company)
    .filter((company) => company.relationship === "target" || String(company.relationship) === "prospect");
  const mapCompanies = prospectsOnly ? prospectCompanies : world.companies;
  const markers = buildMapMarkers(mapCompanies, world.analysis.byId, world.scoreResults);
  const center = mapCenter(mappableCompanies(mapCompanies));
  const omittedCount = mapCompanies.length - markers.length;
  const marketLabel = world.city ?? "All Markets";
  const initialZoom = world.city ? 11 : 4;
  const watchKey = `${world.city ?? "all"}:${markers.length}:${selectedAccountId ?? "none"}`;
  const mappedMetric = prospectsOnly
    ? formatCanonicalMetric({ ...canonicalMetrics(world).mapped_accounts, label: "Mapped prospects", value: markers.length, scope: "Prospect records with latitude and longitude" })
    : formatCanonicalMetric(canonicalMetrics(world).mapped_accounts);
  const omittedCompanies = mapCompanies.filter((company) => !markers.some((marker) => marker.company.id === company.id));

  return (
    <div className="map-shell" data-surface-component="surface-map">
      {markers.length > 0 ? (
        <MapContainer key={world.city ?? "all"} center={center} zoom={initialZoom} className="map" scrollWheelZoom zoomControl={false}>
          <MapSizeInvalidator watchKey={watchKey} />
          <FitMapBounds points={markers.map((marker) => marker.center)} watchKey={watchKey} />
          <SelectedMarkerController markers={markers} selectedAccountId={selectedAccountId} />
          <FullBoundsControl points={markers.map((marker) => marker.center)} />
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
                <Popup>
                  <strong>{c.name}</strong>
                  <p>{c.location.city}{c.location.state ? `, ${c.location.state}` : ""} · {c.relationship}</p>
                  <button type="button" onClick={() => navigateTo(`/accounts/${encodeURIComponent(c.id)}`)}>Open Account 360</button>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      ) : (
        <section className="map-empty-remediation">
          <EmptyState headline="No accounts have coordinates yet" body="The map is hidden until at least one account has latitude and longitude." icon="map" />
          <div className="assumption-box">
            <strong>Coordinate remediation workflow</strong>
            <ol>
              <li>Add latitude and longitude to the account record or canonical account record.</li>
              <li>Re-run the account import/geocoding job.</li>
              <li>Refresh this page and confirm the mapped-account count increases.</li>
            </ol>
          </div>
        </section>
      )}

      <aside className="map-rail">
        <div className="map-rail-head">
          <span>{marketLabel}</span>
          <strong>{mappedMetric.displayValue} mapped</strong>
          <em>{mappedMetric.provenanceLabel}</em>
        </div>
        {omittedCount > 0 && (
          <details className="map-rail-note">
          <summary>{omittedCount} {prospectsOnly ? "prospect" : "account"}{omittedCount === 1 ? "" : "s"} omitted: missing coordinates</summary>
            <p>Add coordinates to show these records on the map.</p>
            <ul>{omittedCompanies.slice(0, 8).map((company) => <li key={company.id}>{company.name} · {company.location.city || "city unavailable"}</li>)}</ul>
          </details>
        )}
        <div className="map-prospect-list">
          {world.prospects
            .filter((p) => !prospectsOnly || prospectCompanies.some((company) => company.id === p.company.id))
            .filter((p) => !prospectsOnly || markers.some((marker) => marker.company.id === p.company.id))
            .slice(0, 12).map((p, i) => {
            const qualification = prospectQualificationLabel({
              company: p.company,
              contact: p.contact,
              opportunities: world.opportunities.filter((opportunity) => opportunity.company_id === p.company.id),
              fitMatched: p.fit.matched,
            });
            const scoreText = p.score ? String(p.opportunity) : "Not scored";
            return (
            <article
              key={p.company.id}
              className={p.company.id === selectedAccountId ? "map-prospect active" : "map-prospect"}
            >
              <span className="map-prospect-rank">
                <span className="rank-badge">#{i + 1}</span>
                <AccountToken name={p.company.name} riskScore={p.score.dimensions.risk.score} size="sm" />
              </span>
              <span className="map-prospect-main">
                <strong>{p.company.name}</strong>
                <em>
                  Attractiveness {scoreText} · {qualification.label} · {p.company.location.city}
                </em>
                {p.topSignal && <small>{p.topSignal.event_type}: {p.topSignal.source_quote}</small>}
                <span className="map-prospect-actions">
                  <button type="button" onClick={() => onSelectAccount?.(p.company.id)}>Show on map</button>
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
            </article>
            );
          })}
        </div>
        <div className="map-legend">
          <span><i className="legend-prospect" /> prospect</span>
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
