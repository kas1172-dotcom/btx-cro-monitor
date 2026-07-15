import { ClerkProvider, RedirectToSignIn, SignedIn, SignedOut, UserButton, useUser } from "@clerk/clerk-react";
import type React from "react";

const env = (import.meta as ImportMeta & { env?: { VITE_CLERK_PUBLISHABLE_KEY?: string } }).env;
const RAW_CLERK_PUBLISHABLE_KEY = env?.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

function isUsableClerkPublishableKey(value: string): boolean {
  if (!value || value.includes("REPLACE_WITH")) return false;
  return value.startsWith("pk_test_") || value.startsWith("pk_live_");
}

export const CLERK_PUBLISHABLE_KEY = isUsableClerkPublishableKey(RAW_CLERK_PUBLISHABLE_KEY)
  ? RAW_CLERK_PUBLISHABLE_KEY
  : "";

/**
 * Gate the app behind Clerk sign-in. If no publishable key is configured
 * (local demo builds with no backend/auth), render children unguarded rather
 * than crash — the backend will independently 401 anything real.
 *
 * backendApi.ts reads the session token from the global `window.Clerk`
 * singleton that ClerkProvider installs, rather than through a hook, since
 * most backend calls originate from plain async functions (agents,
 * adapters) that aren't React components.
 */
export function CockpitAuthGate({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </ClerkProvider>
  );
}

export function CockpitAuthStatus() {
  if (!CLERK_PUBLISHABLE_KEY) {
    return null;
  }
  return (
    <SignedIn>
      <CockpitAuthStatusInner />
    </SignedIn>
  );
}

function CockpitAuthStatusInner() {
  const { isLoaded, user } = useUser();
  const identity = !isLoaded
    ? "Checking session"
    : user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? "Signed in";
  return (
    <div className="clerk-auth-status" role="status" aria-label="Clerk sign-in status">
      <span>Clerk</span>
      <strong>{identity}</strong>
      <UserButton />
    </div>
  );
}
