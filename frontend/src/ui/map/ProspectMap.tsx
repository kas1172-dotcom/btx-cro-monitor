// Geographic prospecting map. Plots the scored companies in the selected market;
// prospects (targets + customers) glow by opportunity. Click a pin -> the store's
// activeCompanyId updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from "react-leaflet";
import type { World } from "../../app/useWorld.ts";
import { setState, useStore } from "../../store/store.ts";
import { explainRankingPrompt, outreachPrompt } from "../../app/copilotPrompts.ts";
import { rankingExplanation } from "../../app/rankingExplain.ts";
import { formatAddress } from "../../app/format.ts";
import { AskChatpilButton } from "../copilot/AskChatpilButton.tsx";
import { RankingWhy } from "../ranking/RankingWhy.tsx";

const avg = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

function isProspect(rel: string): boolean {
  return rel === "target" || rel === "customer";
}

export function ProspectMap({ world }: { world: World }) {
  const { activeCompanyId } = useStore();
  const pts = world.companies;
  const center: [number, number] = pts.length
    ? [avg(pts.map((p) => p.location.lat)), avg(pts.map((p) => p.location.lon))]
    : [31.5, -97];
  const marketLabel = world.city ?? "All Markets";
  const initialZoom = world.city ? 11 : 4;

  return (
    <div className="map-shell">
      <MapContainer key={world.city ?? "all"} center={center} zoom={initialZoom} className="map" scrollWheelZoom zoomControl={false}>
        <ZoomControl position="bottomright" />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />
        {pts.map((c) => {
          const opp = world.analysis.byId.get(c.id)?.dimensions.opportunity.score ?? 0;
          const prospect = isProspect(c.relationship);
          const active = c.id === activeCompanyId;
          const color = prospect ? "#9ecf6a" : "#7b8467";
          return (
            <CircleMarker
              key={c.id}
              center={[c.location.lat, c.location.lon]}
              radius={prospect ? Math.min(18, 8 + opp / 10) : 6}
              pathOptions={{
                color: active ? "#f4f1dc" : color,
                weight: active ? 3 : 1,
                fillColor: color,
                fillOpacity: prospect ? 0.78 : 0.45,
              }}
              eventHandlers={{ click: () => setState({ activeCompanyId: c.id }) }}
            >
              <Tooltip permanent={prospect} direction="top" opacity={0.92}>
                {c.name}
                {prospect ? ` · opp ${opp}` : ` · ${c.relationship}`}
                {formatAddress(c.location) ? ` · ${formatAddress(c.location)}` : ""}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <aside className="map-rail">
        <div className="map-rail-head">
          <span>{marketLabel}</span>
          <strong>{world.prospects.length} prospects</strong>
        </div>
        {world.prospects.slice(0, 6).map((p, i) => (
          <button
            key={p.company.id}
            className={p.company.id === activeCompanyId ? "map-prospect active" : "map-prospect"}
            onClick={() => setState({ activeCompanyId: p.company.id })}
          >
            <span className="rank-badge">#{i + 1}</span>
            <span className="map-prospect-main">
              <strong>{p.company.name}</strong>
              <em>Opportunity {p.opportunity} · fit {p.fit.score}%</em>
              {formatAddress(p.company.location) && <small>{formatAddress(p.company.location)}</small>}
              <RankingWhy explanation={rankingExplanation(world, p.company, { rank: i + 1, dimension: "opportunity", fitScore: p.fit.score })} />
              {p.topSignal && <small>{p.topSignal.event_type}: {p.topSignal.source_quote}</small>}
              {p.contact && <small>Call {p.contact.name}, {p.contact.title}</small>}
              <AskChatpilButton
                label="Explain"
                prompt={explainRankingPrompt(p.company.name, `Map rank #${i + 1}. Opportunity ${p.opportunity}, fit ${p.fit.score}%, market ${marketLabel}. ${rankingExplanation(world, p.company, { rank: i + 1, dimension: "opportunity", fitScore: p.fit.score }).driverLine} Top signal: ${p.topSignal?.source_quote ?? "none"}.`)}
              />
              <AskChatpilButton
                label="Draft outreach"
                prompt={outreachPrompt(p.company, `Map prospect rank #${i + 1}. Opportunity ${p.opportunity}, fit ${p.fit.score}%, contact ${p.contact?.name ?? "not available"}.`)}
              />
            </span>
          </button>
        ))}
        <div className="map-legend">
          <span><i className="legend-prospect" /> prospect/customer</span>
          <span><i className="legend-other" /> supplier/competitor/self</span>
        </div>
      </aside>
    </div>
  );
}
