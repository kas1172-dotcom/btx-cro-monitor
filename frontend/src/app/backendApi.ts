const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const BACKEND_ENDPOINT = env?.VITE_BACKEND_ENDPOINT ?? processEnv?.VITE_BACKEND_ENDPOINT;
export const BACKEND_AUTH_TOKEN = env?.VITE_BACKEND_AUTH_TOKEN ?? processEnv?.VITE_BACKEND_AUTH_TOKEN;

export function backendHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    ...(BACKEND_AUTH_TOKEN ? { authorization: `Bearer ${BACKEND_AUTH_TOKEN}` } : {}),
  };
}

export async function backendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BACKEND_ENDPOINT) throw new Error("VITE_BACKEND_ENDPOINT is not configured.");
  const headers = backendHeaders({ ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) });
  const response = await fetch(`${BACKEND_ENDPOINT}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Backend ${path} failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}
