import type { ZodSchema } from "zod";
import type { World } from "../app/useWorld.ts";
import type { Deliverable, DeliverableSection, ProvenanceEntry, ValidationResult } from "../deliverables/types.ts";

export type DeliverableAudience = "prospect" | "internal" | "board";
export type DeliverableForm = "email" | "memo" | "brief" | "deck" | "itinerary" | "view" | "one_pager";

export interface AgentContext {
  facts: Record<string, string | number | boolean | null>;
  entityIds: string[];
  sources: ProvenanceEntry[];
}

export interface SectionSpec {
  id: string;
  heading: string;
  required: boolean;
}

export interface DeliverableAgent<I> {
  id: string;
  audience: DeliverableAudience;
  form: DeliverableForm;
  inputs: ZodSchema<I>;
  contextRecipe: (inputs: I, world: World) => AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  compose: (ctx: AgentContext) => Promise<Deliverable>;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}

const PROSPECT_BANNED = [
  "signal",
  "validated",
  "opportunity score",
  "fit %",
  "risk score",
  "pipeline",
  "demo",
  "snapshot",
  "crm",
  "provenance",
  "capacityRisk",
  "competitivePressure",
];

const INTERNAL_BANNED = ["demo", "snapshot", "simulated", "deterministic", "Revenue Brain"];
const HYBRID_INTERNAL_BANNED = ["simulated", "deterministic", "Revenue Brain"];

function blockText(section: DeliverableSection): string {
  return section.blocks.map((block) => {
    if (block.kind === "text") return block.text;
    if (block.kind === "table") return [block.columns.join(" "), ...block.rows.map((row) => row.join(" "))].join(" ");
    if (block.kind === "map-ref") return [block.title, ...(block.stops ?? []).map((stop) => stop.label)].join(" ");
    return block.title;
  }).join(" ");
}

function publicSections(deliverable: Deliverable): DeliverableSection[] {
  if (deliverable.form !== "email") return deliverable.sections;
  return deliverable.sections.filter((section) => ["recipient", "subject", "body"].includes(section.id));
}

function includesBanned(text: string, banned: string[]): string | null {
  const lower = text.toLowerCase();
  return banned.find((term) => lower.includes(term.toLowerCase())) ?? null;
}

export function validateAudienceAndForm(
  deliverable: Deliverable,
  ctx: AgentContext,
  audience: DeliverableAudience,
  form: DeliverableForm,
): ValidationResult {
  const errors: string[] = [];
  const visibleText = publicSections(deliverable).map(blockText).join(" ");
  const allText = deliverable.sections.map(blockText).join(" ");
  const backendGrounding = ctx.sources.some((source) => ["CRM", "monitor-engine artifacts", "Seeded baseline"].includes(source.source));
  const internalBanned = backendGrounding ? HYBRID_INTERNAL_BANNED : INTERNAL_BANNED;
  const banned = audience === "prospect" ? includesBanned(visibleText, PROSPECT_BANNED) : includesBanned(allText, internalBanned);
  if (banned) errors.push(`${audience} ${form} includes banned term "${banned}"`);

  if (form === "email") {
    const recipient = String(ctx.facts.contactName ?? "");
    const firstName = recipient.split(/\s+/)[0];
    const body = deliverable.sections.find((section) => section.id === "body")?.blocks
      .filter((block) => block.kind === "text")
      .map((block) => block.text)
      .join("\n") ?? "";
    const sentenceCount = (body.match(/[.!?](\s|$)/g) ?? []).length;
    if (!firstName || !body.includes(`Hi ${firstName},`)) errors.push("Email missing greeting with recipient first name");
    if (sentenceCount < 2 || sentenceCount > 4) errors.push(`Email body must be 2-4 sentences; found ${sentenceCount}`);
    if (!/\b(call|conversation|talk|meet|schedule|open)\b/i.test(body)) errors.push("Email missing clear call-to-action");
    if (!String(ctx.facts.senderName ?? "") || !body.includes(String(ctx.facts.senderName))) errors.push("Email missing sender sign-off");
  }

  if (form === "memo") {
    const firstText = deliverable.sections[0]?.blocks.find((block) => block.kind === "text");
    if (!firstText || firstText.kind !== "text" || !/^Verdict:/i.test(firstText.text)) errors.push("Memo must open verdict-first");
  }

  const accountEvidence = ctx.entityIds
    .map((id) => String(ctx.facts[`${id}:evidence`] ?? ""))
    .filter(Boolean);
  for (const evidence of accountEvidence) {
    const boundName = evidence.split("::")[0];
    const text = evidence.split("::").slice(1).join("::");
    if (boundName && text && !text.includes(boundName)) errors.push(`Evidence is not bound to ${boundName}: ${text}`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateRequiredSections(
  deliverable: Deliverable,
  requiredSections: DeliverableSection[],
  ctx: AgentContext,
): ValidationResult {
  const errors: string[] = [];
  for (const required of requiredSections) {
    const section = deliverable.sections.find((s) => s.id === required.id);
    if (!section) {
      errors.push(`Missing section ${required.heading}`);
      continue;
    }
    if (section.blocks.length === 0) errors.push(`Section ${required.heading} has no blocks`);
  }
  if (deliverable.sources.length === 0) errors.push("Deliverable has no provenance");
  if (ctx.sources.length > 0 && deliverable.sources.length < ctx.sources.length) errors.push("Deliverable omitted context provenance");
  return { valid: errors.length === 0, errors };
}
