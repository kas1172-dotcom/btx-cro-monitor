import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The cockpit reads all of its data from the backend through the WorldSnapshot
// contract. The JSON files under data/ are test fixtures only and are never
// imported by anything reachable from src/main.tsx.
//
// base must be an absolute path, not "./". A relative base breaks deep links:
// loading /accounts/<id> would resolve assets against /accounts/ and 404. Pages
// serves the cockpit from /btx-cro-monitor/cockpit/, so builds default to that
// and VITE_BASE_PATH can override it for any other host, such as a domain root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? process.env.VITE_BASE_PATH || "/btx-cro-monitor/cockpit/" : "/",
  plugins: [react()],
  build: {
    // Large Office-export vendors are lazy-loaded only after a user requests a
    // download. Keep the mobile landing chunk warning focused on eager code.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replace(/\\/g, "/");
          if (path.includes("/node_modules/@clerk/")) return "clerk";
          if (path.includes("/node_modules/@xyflow/")) return "flow";
          if (path.includes("/node_modules/leaflet/") || path.includes("/node_modules/react-leaflet/")) return "leaflet";
          if (path.includes("/node_modules/docx/")) return "docx";
          if (path.includes("/node_modules/write-excel-file/") || path.includes("/node_modules/fflate/")) return "xlsx";
          if (path.includes("/node_modules/pptxgenjs/")) return "pptx";
          return undefined;
        },
      },
    },
  },
}));
