/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Jarvis proxy (holds the API key). Unset => offline/rule-based. */
  readonly VITE_COPILOT_ENDPOINT?: string;
  readonly VITE_BACKEND_ENDPOINT?: string;
  readonly VITE_BACKEND_AUTH_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
