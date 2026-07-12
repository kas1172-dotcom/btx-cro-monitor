// Model ids must be valid for the configured API key.
// Override via env: VITE_MODEL_CHATPIL and VITE_MODEL_COMPOSE.
// Defaults: claude-haiku-4-5-20251001 (chat), claude-sonnet-4-5 (composition).
function viteEnv(): Record<string, string | undefined> | undefined {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  } catch {
    return undefined;
  }
}

const env = viteEnv();
const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const LLM_MODELS = {
  // Chatpil conversational chat
  chatpil: env?.VITE_MODEL_CHATPIL ?? processEnv?.VITE_MODEL_CHATPIL ?? "claude-haiku-4-5-20251001",
  // Brain-area router (lightweight classification, same model as chatpil)
  routing: env?.VITE_MODEL_CHATPIL ?? processEnv?.VITE_MODEL_CHATPIL ?? "claude-haiku-4-5-20251001",
  // Deliverable composition and critique
  composition: env?.VITE_MODEL_COMPOSE ?? processEnv?.VITE_MODEL_COMPOSE ?? "claude-sonnet-4-5",
} as const;

export const LLM_TIMEOUT_MS = {
  chatpil: 12000,
  routing: 8000,
  composition: 30000,
} as const;
