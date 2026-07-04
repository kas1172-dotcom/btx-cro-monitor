import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./ui/styles.css";
import { runOverflowAudit } from "./app/overflowAudit.ts";

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__btxAudit = runOverflowAudit;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
