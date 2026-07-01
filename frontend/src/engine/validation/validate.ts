// Validation layer. Nothing enters the decision engine without clearing this.
// The prompt's rule: reject confidence < threshold, missing required fields, or
// malformed numeric inference. Plain TS for now (zero dependencies); when we add
// a build toolchain this is the natural seam to swap in Zod — FLAGGED as a new
// dependency to approve at that point, not added silently.

import type { Signal } from "../signals/contract.ts";

export interface Rejection {
  /** Best-effort id so a rejected signal is still traceable. */
  id: string;
  raw: unknown;
  reasons: string[];
}

export interface ValidationResult {
  valid: Signal[];
  rejected: Rejection[];
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** Validate one candidate. Returns the typed Signal or the reasons it failed. */
function validateOne(raw: unknown, minConfidence: number): Signal | string[] {
  const reasons: string[] = [];
  const s = (raw ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(s.id)) reasons.push("missing required field: id");
  if (!isNonEmptyString(s.event_type)) reasons.push("missing required field: event_type");
  if (!isNonEmptyString(s.subject_id)) reasons.push("missing required field: subject_id");
  if (!isNonEmptyString(s.source_quote)) reasons.push("missing required field: source_quote");
  if (!isNonEmptyString(s.detected_at)) reasons.push("missing required field: detected_at");
  if (!Array.isArray(s.entities)) reasons.push("entities must be an array");

  if (!isFiniteNumber(s.confidence)) {
    reasons.push("confidence must be a number");
  } else if (s.confidence < 0 || s.confidence > 1) {
    reasons.push(`confidence ${s.confidence} out of range 0..1`);
  } else if (s.confidence < minConfidence) {
    reasons.push(`confidence ${s.confidence} below threshold ${minConfidence}`);
  }

  // value is optional, but if present it must be a real number (no inferred junk).
  if (s.value !== undefined && !isFiniteNumber(s.value)) {
    reasons.push("value present but not a finite number");
  }

  if (reasons.length > 0) return reasons;
  return raw as Signal;
}

export function validateSignals(rawSignals: unknown[], minConfidence: number): ValidationResult {
  const valid: Signal[] = [];
  const rejected: Rejection[] = [];

  for (const raw of rawSignals) {
    const result = validateOne(raw, minConfidence);
    if (Array.isArray(result)) {
      const id = (raw as Record<string, unknown>)?.id;
      rejected.push({ id: isNonEmptyString(id) ? id : "<unknown>", raw, reasons: result });
    } else {
      valid.push(result);
    }
  }

  return { valid, rejected };
}
