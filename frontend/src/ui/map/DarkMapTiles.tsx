import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { uiTokens } from "../../app/uiTokens.ts";

type CanvasGridLayer = L.GridLayer & {
  createTile: (coords: L.Coords) => HTMLElement;
};

function drawTile(ctx: CanvasRenderingContext2D, size: L.Point, coords: L.Coords, map: L.Map): void {
  ctx.fillStyle = uiTokens.color.page;
  ctx.fillRect(0, 0, size.x, size.y);

  const gradient = ctx.createLinearGradient(0, 0, size.x, size.y);
  gradient.addColorStop(0, `rgba(${uiTokens.rgb.panel}, 0.92)`);
  gradient.addColorStop(1, `rgba(${uiTokens.rgb.rail}, 0.98)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size.x, size.y);

  const drawGrid = (spacing: number, alpha: number, width: number) => {
    ctx.strokeStyle = `rgba(${uiTokens.rgb.accent}, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    const xOffset = ((coords.x * size.x) % spacing + spacing) % spacing;
    const yOffset = ((coords.y * size.y) % spacing + spacing) % spacing;
    for (let x = -xOffset; x <= size.x; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.y);
    }
    for (let y = -yOffset; y <= size.y; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(size.x, y);
    }
    ctx.stroke();
  };

  drawGrid(32, 0.06, 1);
  drawGrid(128, 0.14, 1.2);

  const worldX = coords.x * size.x;
  const worldY = coords.y * size.y;
  const topLeft = map.unproject([worldX, worldY], coords.z);
  const bottomRight = map.unproject([worldX + size.x, worldY + size.y], coords.z);
  const label = `${Math.round((topLeft.lat + bottomRight.lat) / 2)}° / ${Math.round((topLeft.lng + bottomRight.lng) / 2)}°`;
  ctx.fillStyle = `rgba(${uiTokens.rgb.accent}, 0.2)`;
  ctx.font = `${uiTokens.font.weightSemibold} 11px Inter, Arial, sans-serif`;
  ctx.fillText(label, 14, size.y - 14);
}

export function DarkMapTiles() {
  const map = useMap();

  useEffect(() => {
    const layer = L.gridLayer({
      attribution: "Self-rendered dark basemap",
      keepBuffer: 3,
      tileSize: 256,
      updateWhenIdle: true,
    }) as CanvasGridLayer;

    layer.createTile = (coords) => {
      const tile = document.createElement("canvas");
      const size = layer.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext("2d");
      if (ctx) drawTile(ctx, size, coords, map);
      return tile;
    };

    layer.addTo(map);
    return () => {
      layer.removeFrom(map);
    };
  }, [map]);

  return null;
}
