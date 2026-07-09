// Validation layer (Zod). Nothing enters the decision engine without clearing
// this. One schema is the single source of truth for a Signal's shape; the
// confidence gate is applied on top. Rejects malformed data and low-confidence
// signals — which matters most for the LLM-extracted signals from news.

import { z } from "zod";
import type { Signal } from "../signals/contract.ts";

const AccountStatusSchema = z.enum([
  "current_customer",
  "active_pipeline",
  "past_customer",
  "target_prospect",
  "new_logo",
  "partner",
  "competitor",
]);

const BusinessMotionSchema = z.enum([
  "manage_current_business",
  "grow_existing_business",
  "prospect_new_business",
  "reduce_risk",
]);

const SignalSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  entities: z.array(z.string()),
  subject_id: z.string().min(1),
  account_status: AccountStatusSchema.optional(),
  business_motion: BusinessMotionSchema.optional(),
  value: z.number().optional(),
  confidence: z.number().min(0).max(1),
  source_quote: z.string().min(1),
  source_url: z.string().optional(),
  document_url: z.string().optional(),
  detected_at: z.string().min(1),
}).passthrough();

export interface Rejection {
  id: string;
  raw: unknown;
  reasons: string[];
}

export interface ValidationResult {
  valid: Signal[];
  rejected: Rejection[];
}

export function validateSignals(rawSignals: unknown[], minConfidence: number): ValidationResult {
  const valid: Signal[] = [];
  const rejected: Rejection[] = [];

  for (const raw of rawSignals) {
    const parsed = SignalSchema.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { id?: unknown } | null)?.id;
      rejected.push({
        id: typeof id === "string" && id ? id : "<unknown>",
        raw,
        reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`),
      });
      continue;
    }
    if (parsed.data.confidence < minConfidence) {
      rejected.push({
        id: parsed.data.id,
        raw,
        reasons: [`confidence ${parsed.data.confidence} below threshold ${minConfidence}`],
      });
      continue;
    }
    valid.push(parsed.data as Signal);
  }

  return { valid, rejected };
}
