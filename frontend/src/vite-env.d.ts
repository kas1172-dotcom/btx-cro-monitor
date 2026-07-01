/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Jarvis proxy (holds the API key). Unset => offline/rule-based. */
  readonly VITE_COPILOT_ENDPOINT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
