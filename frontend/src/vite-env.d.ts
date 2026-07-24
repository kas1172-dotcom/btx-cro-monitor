/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Jarvis proxy (holds the API key). Unset => offline/rule-based. */
  readonly VITE_COPILOT_ENDPOINT?: string;
  readonly VITE_BACKEND_ENDPOINT?: string;
  /** Clerk publishable key (WP10-A). Non-secret; gates sign-in in the browser. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
