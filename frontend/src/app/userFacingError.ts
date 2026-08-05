const AUTH_PATTERN = /\b(?:401|403|auth|token|session|clerk)\b/i;
const NETWORK_PATTERN = /\b(?:fetch|network|offline|timeout|timed out|503)\b/i;

/** Returns stable UI copy without exposing backend payloads, endpoints, or stack details. */
export function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (AUTH_PATTERN.test(message)) return "Sign in again to continue.";
  if (NETWORK_PATTERN.test(message)) return "The service is temporarily unavailable. Try again.";
  return fallback;
}
