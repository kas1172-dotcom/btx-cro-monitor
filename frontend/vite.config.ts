import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app imports the engine (src/engine) and the frozen JSON fixtures (data/)
// directly. No backend. The data/engine wall is preserved: engine code is
// industry-free; everything BTX-specific is the imported data.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ["leaflet", "react-leaflet"],
          flow: ["@xyflow/react"],
        },
      },
    },
  },
});
