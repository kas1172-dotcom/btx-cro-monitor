import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app imports the engine (src/engine) and the frozen JSON fixtures (data/)
// directly. No backend. The data/engine wall is preserved: engine code is
// industry-free; everything BTX-specific is the imported data.
// base: relative ("./") for production builds so assets resolve when the app is
// served from a GitHub Pages project subpath (…/btx-cro-monitor/); "/" for local dev.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  build: {
    modulePreload: false,
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
          if (path.includes("/node_modules/exceljs/")) return "exceljs";
          if (path.includes("/node_modules/pptxgenjs/")) return "pptx";
          return undefined;
        },
      },
    },
  },
}));
