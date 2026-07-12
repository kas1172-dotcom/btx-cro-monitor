import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import { App } from "./App.tsx";
import { CockpitAccessGate } from "./app/cockpitAccess.tsx";
import { CockpitAuthGate } from "./app/clerkAuth.tsx";
import "./ui/styles.css";
import { runOverflowAudit } from "./app/overflowAudit.ts";

const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

if (env?.DEV) {
  (window as unknown as Record<string, unknown>).__btxAudit = runOverflowAudit;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <CockpitAuthGate>
      <CockpitAccessGate>
        <App />
      </CockpitAccessGate>
    </CockpitAuthGate>
  </StrictMode>,
);
