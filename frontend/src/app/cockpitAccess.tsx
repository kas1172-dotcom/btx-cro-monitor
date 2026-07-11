import { useMemo, useState } from "react";
import type React from "react";

const env = (import.meta as ImportMeta & { env?: { VITE_COCKPIT_PASSWORD_HASH?: string } }).env;
const ACCESS_HASH = env?.VITE_COCKPIT_PASSWORD_HASH?.trim() ?? "";
const STORAGE_KEY = "btx.cockpit.access.v1";

function isHexSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function CockpitAccessGate({ children }: { children: React.ReactNode }) {
  const accessEnabled = useMemo(() => isHexSha256(ACCESS_HASH), []);
  const [unlocked, setUnlocked] = useState(() => {
    if (!accessEnabled) return true;
    return window.localStorage.getItem(STORAGE_KEY) === ACCESS_HASH;
  });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "denied">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("checking");
    const candidate = await sha256Hex(password);
    if (candidate === ACCESS_HASH) {
      window.localStorage.setItem(STORAGE_KEY, ACCESS_HASH);
      setUnlocked(true);
      return;
    }
    setStatus("denied");
  }

  if (unlocked) return <>{children}</>;

  return (
    <main className="access-shell">
      <form className="access-panel" onSubmit={submit}>
        <p className="eyebrow">BTX Revenue Brain</p>
        <h1>Cockpit Access</h1>
        <label>
          <span>Password</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (status === "denied") setStatus("idle");
            }}
          />
        </label>
        <button type="submit" disabled={!password || status === "checking"}>
          {status === "checking" ? "Checking..." : "Enter"}
        </button>
        {status === "denied" && <small>Incorrect password.</small>}
      </form>
    </main>
  );
}
