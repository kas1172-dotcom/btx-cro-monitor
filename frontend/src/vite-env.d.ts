/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Jarvis proxy (holds the API key). Unset => offline/rule-based. */
  readonly VITE_COPILOT_ENDPOINT?: string;
  readonly VITE_BACKEND_ENDPOINT?: string;
  /** Clerk publishable key (WP10-A). Non-secret; gates sign-in in the browser. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Emergency CRM write gate. Keep unset until disposable-tenant verification passes. */
  readonly VITE_CRM_WRITES_TENANT_VERIFIED?: string;
  readonly VITE_DEPLOYMENT_MODE?: "development" | "demo" | "production";
  readonly VITE_TENANT_ID?: string;
  readonly VITE_SOURCE_TYPE?: string;
  readonly VITE_DATA_PROVENANCE?: string;
  readonly VITE_DEPLOYED_REVISION?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
