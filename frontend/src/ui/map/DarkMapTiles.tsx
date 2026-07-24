import { TileLayer } from "react-leaflet";

export function DarkMapTiles() {
  return (
    <TileLayer
      attribution="© OpenStreetMap, © CARTO"
      maxZoom={19}
      subdomains={["a", "b", "c", "d"]}
      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    />
  );
}
