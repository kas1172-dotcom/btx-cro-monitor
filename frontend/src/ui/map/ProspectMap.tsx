// Geographic prospecting map. Plots the scored companies in the selected city;
// prospects (targets + customers) glow by opportunity. Click a pin -> the store's
// activeCompanyId updates -> the dossier opens. The map is just a lens on engine
// output; it computes nothing.

import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { World } from "../../app/useWorld.ts";
import { setState, useStore } from "../../store/store.ts";

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

  return (
    <MapContainer key={world.city ?? "all"} center={center} zoom={11} className="map" scrollWheelZoom>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      {pts.map((c) => {
        const opp = world.analysis.byId.get(c.id)?.dimensions.opportunity.score ?? 0;
        const prospect = isProspect(c.relationship);
        const active = c.id === activeCompanyId;
        const color = prospect ? "#39d98a" : "#5b6472";
        return (
          <CircleMarker
            key={c.id}
            center={[c.location.lat, c.location.lon]}
            radius={prospect ? 9 + opp / 12 : 6}
            pathOptions={{
              color: active ? "#ffffff" : color,
              weight: active ? 3 : 1,
              fillColor: color,
              fillOpacity: prospect ? 0.75 : 0.45,
            }}
            eventHandlers={{ click: () => setState({ activeCompanyId: c.id }) }}
          >
            <Tooltip permanent={prospect} direction="top" opacity={0.92}>
              {c.name}
              {prospect ? ` · opp ${opp}` : ` · ${c.relationship}`}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
