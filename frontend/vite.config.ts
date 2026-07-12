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
        manualChunks: {
          leaflet: ["leaflet", "react-leaflet"],
          flow: ["@xyflow/react"],
          docx: ["docx"],
          exceljs: ["exceljs"],
          pptx: ["pptxgenjs"],
        },
      },
    },
  },
}));
