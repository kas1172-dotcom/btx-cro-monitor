export const LLM_MODELS = {
  routing: "claude-3-5-haiku-latest",
  composition: "claude-sonnet-4-5",
} as const;

export const LLM_TIMEOUT_MS = {
  routing: 3000,
  composition: 20000,
} as const;
