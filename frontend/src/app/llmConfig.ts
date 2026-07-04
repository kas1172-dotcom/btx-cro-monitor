// Model ids must be valid for the configured API key.
// Override via env: VITE_MODEL_CHATPIL and VITE_MODEL_COMPOSE.
// Defaults: claude-haiku-4-5-20251001 (chat), claude-sonnet-4-5 (composition).
export const LLM_MODELS = {
  // Chatpil conversational chat
  chatpil: (import.meta.env.VITE_MODEL_CHATPIL as string | undefined) ?? "claude-haiku-4-5-20251001",
  // Brain-area router (lightweight classification, same model as chatpil)
  routing: (import.meta.env.VITE_MODEL_CHATPIL as string | undefined) ?? "claude-haiku-4-5-20251001",
  // Deliverable composition and critique
  composition: (import.meta.env.VITE_MODEL_COMPOSE as string | undefined) ?? "claude-sonnet-4-5",
} as const;

export const LLM_TIMEOUT_MS = {
  chatpil: 12000,
  routing: 8000,
  composition: 30000,
} as const;
