// Deterministic capability-fit score: how much of what a prospect NEEDS the
// client can actually serve. No AI. This is the "how BTX can serve them" readout
// — separate from the signal-driven scores (it doesn't touch the locked scorer).
// The client's capabilities come from config (data layer), never hardcoded here.

export interface FitResult {
  /** 0..100 — share of the prospect's needs the client's capabilities cover. */
  score: number;
  /** Capabilities the client HAS that the prospect needs — the pitch. */
  matched: string[];
  /** Needs the client cannot serve — gaps / teaming opportunities. */
  missing: string[];
}

export function scoreFit(needs: string[], capabilities: string[]): FitResult {
  const caps = new Set(capabilities);
  const matched = needs.filter((n) => caps.has(n));
  const missing = needs.filter((n) => !caps.has(n));
  const score = needs.length === 0 ? 0 : Math.round((matched.length / needs.length) * 100);
  return { score, matched, missing };
}
