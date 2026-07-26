// Validation layer (Zod). Nothing enters the decision engine without clearing
// this. One schema is the single source of truth for a Signal's shape; the
// confidence gate is applied on top. Rejects malformed data and low-confidence
// signals - which matters most for the LLM-extracted signals from news.

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

const SignalScopeSchema = z.enum([
  "market",
  "program",
  "customer",
  "supplier",
  "competitor",
  "specific_account",
  "unlinked",
]);

const SignalRelationshipSchema = z.object({
  canonical_account_id: z.string().min(1),
  canonicalAccountId: z.string().min(1).optional(),
  source_entity_name: z.string().min(1),
  sourceEntityName: z.string().min(1).optional(),
  match_method: z.enum([
    "exact_public_identifier",
    "exact_uei",
    "exact_cage_code",
    "exact_hubspot_company_id",
    "exact_verified_domain",
    "exact_legal_name",
    "verified_alias",
    "parent_subsidiary_mapping",
    "verified_program_relationship",
    "manual_confirmation",
    "exact_domain",
    "cage_uei",
    "alias",
    "program",
    "name_fuzzy",
    "manual",
  ]),
  evidence: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).optional(),
  evidence_ids: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1),
  review_status: z.enum(["confirmed", "accepted", "needs_review", "unconfirmed", "rejected"]),
  reviewStatus: z.enum(["confirmed", "needs_review", "rejected"]).optional(),
  creation_source: z.enum(["resolver", "manual", "public_data", "crm", "derived"]),
  creationSource: z.enum(["public_data", "crm", "manual", "derived"]).optional(),
  last_validated_at: z.string().nullable(),
  lastValidatedAt: z.string().nullable().optional(),
});

const SignalSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  entities: z.array(z.string()),
  subject_id: z.string().min(1),
  scope: SignalScopeSchema.optional(),
  relationships: z.array(SignalRelationshipSchema).optional(),
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
