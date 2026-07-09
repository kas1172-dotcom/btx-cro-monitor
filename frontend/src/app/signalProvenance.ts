import type { Signal } from "../engine/signals/contract.ts";

export function signalSourceName(signal: Signal): string {
  return signal.artifact?.source_name ?? "Simulated Market Signal Feed";
}

export function signalSourceDate(signal: Signal): string {
  return (signal.artifact?.source_date ?? signal.detected_at).slice(0, 10);
}

export function signalHeadline(signal: Signal): string {
  return signal.artifact?.headline ?? signal.event_type.replace(/_/g, " ");
}

export function signalCitation(signal: Signal): string {
  return `${signalSourceName(signal)}, ${signalSourceDate(signal)}`;
}

export function signalEvidence(signal: Signal | undefined, fallback = "No validated signal attached"): string {
  if (!signal) return fallback;
  if (!signal.artifact) return signal.source_quote;
  return `${signal.source_quote} [${signalCitation(signal)}]`;
}

export function signalEvidenceForCompany(companyName: string, signal: Signal | undefined, fallback = "No validated signal attached"): string {
  if (!signal) return fallback;
  return `${companyName}: ${signalEvidence(signal)}`;
}

export function signalFigureContext(signals: Signal[]): string {
  return signals
    .flatMap((signal) => signal.artifact?.dollar_figures ?? [])
    .map((figure) => String(figure))
    .join(" ");
}
