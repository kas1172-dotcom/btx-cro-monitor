import { backendHeaders, BACKEND_ENDPOINT } from "./backendApi.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "./llmConfig.ts";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const COPILOT_ENDPOINT = env?.VITE_COPILOT_ENDPOINT ?? processEnv?.VITE_COPILOT_ENDPOINT;

export type AiLiveState = "unknown" | "checking" | "live" | "offline";

export interface AiStatusSnapshot {
  state: AiLiveState;
  reason: string | null;
  model: string;
  checkedAt: string | null;
}

const listeners = new Set<() => void>();
let snapshot: AiStatusSnapshot = {
  state: "unknown",
  reason: null,
  model: LLM_MODELS.chatpil,
  checkedAt: null,
};
let checkPromise: Promise<AiStatusSnapshot> | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: AiStatusSnapshot): AiStatusSnapshot {
  snapshot = next;
  notify();
  return snapshot;
}

export function subscribeAiStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiStatusSnapshot(): AiStatusSnapshot {
  return snapshot;
}

export function llmUnavailableLabel(reason: string): string {
  return `Template fallback (LLM unavailable: ${reason})`;
}

function healthEndpoint(): string | null {
  if (BACKEND_ENDPOINT) return `${BACKEND_ENDPOINT}/health`;
  if (!COPILOT_ENDPOINT) return null;
  try {
    const url = new URL(COPILOT_ENDPOINT);
    url.pathname = url.pathname.replace(/\/llm\/?$/, "/health");
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function runHandshake(): Promise<AiStatusSnapshot> {
  if (!COPILOT_ENDPOINT) {
    return setSnapshot({
      state: "offline",
      reason: "VITE_COPILOT_ENDPOINT is not configured",
      model: LLM_MODELS.chatpil,
      checkedAt: new Date().toISOString(),
    });
  }

  const healthUrl = healthEndpoint();
  if (healthUrl) {
    try {
      const healthResponse = await fetchWithTimeout(healthUrl, { headers: await backendHeaders() }, 5000);
      if (!healthResponse.ok) {
        return setSnapshot({
          state: "offline",
          reason: `/health returned ${healthResponse.status}`,
          model: LLM_MODELS.chatpil,
          checkedAt: new Date().toISOString(),
        });
      }
      const health = (await healthResponse.json()) as { llm?: unknown };
      if (health.llm !== true) {
        return setSnapshot({
          state: "offline",
          reason: "backend health reports LLM unavailable",
          model: LLM_MODELS.chatpil,
          checkedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      return setSnapshot({
        state: "offline",
        reason: error instanceof Error ? `/health failed: ${error.message}` : "/health failed",
        model: LLM_MODELS.chatpil,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  try {
    const response = await fetchWithTimeout(COPILOT_ENDPOINT, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        model: LLM_MODELS.chatpil,
        system: "Reply with the single word ok.",
        messages: [{ role: "user", content: "ping" }],
      }),
    }, LLM_TIMEOUT_MS.routing);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return setSnapshot({
        state: "offline",
        reason: `/llm returned ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
        model: LLM_MODELS.chatpil,
        checkedAt: new Date().toISOString(),
      });
    }
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string" || data.text.trim().length === 0) {
      return setSnapshot({
        state: "offline",
        reason: "/llm returned no text",
        model: LLM_MODELS.chatpil,
        checkedAt: new Date().toISOString(),
      });
    }
    return setSnapshot({
      state: "live",
      reason: null,
      model: LLM_MODELS.chatpil,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return setSnapshot({
      state: "offline",
      reason: error instanceof Error ? `/llm failed: ${error.message}` : "/llm failed",
      model: LLM_MODELS.chatpil,
      checkedAt: new Date().toISOString(),
    });
  }
}

export async function checkAiStatus(): Promise<AiStatusSnapshot> {
  if (snapshot.state === "live" || snapshot.state === "offline") return snapshot;
  if (checkPromise) return checkPromise;
  setSnapshot({ ...snapshot, state: "checking", reason: null });
  checkPromise = runHandshake().finally(() => {
    checkPromise = null;
  });
  return checkPromise;
}

export function markAiOffline(reason: string): AiStatusSnapshot {
  return setSnapshot({
    state: "offline",
    reason,
    model: LLM_MODELS.chatpil,
    checkedAt: new Date().toISOString(),
  });
}

export function markAiLive(model = LLM_MODELS.chatpil): AiStatusSnapshot {
  return setSnapshot({
    state: "live",
    reason: null,
    model,
    checkedAt: new Date().toISOString(),
  });
}
