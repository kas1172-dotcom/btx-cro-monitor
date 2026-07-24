import type { Deliverable, DeliverableSection, ValidationResult } from "../deliverables/types.ts";
import type { AgentContext, SectionSpec } from "./contract.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "../app/llmConfig.ts";
import { backendHeaders } from "../app/backendApi.ts";
import { COPILOT_ENDPOINT, checkAiStatus, llmUnavailableLabel, markAiLive, markAiOffline } from "../app/aiStatus.ts";

interface LlmSection {
  id: string;
  text: string;
}

interface LlmComposeResult {
  sections: LlmSection[];
}

interface GroundingResult {
  ok: boolean;
  violations: string[];
}

export async function maybeComposeWithLlm(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}): Promise<Deliverable> {
  const status = await checkAiStatus();
  if (status.state !== "live") {
    return withFallbackNotice(input.template, status.reason ?? "AI status check failed");
  }

  const first = await composeOnce(input, false);
  if (!first.ok) return withFallbackNotice(input.template, first.reason);
  const critiqued = await critiqueAndRevise(input, first);
  if (!critiqued.ok) return { ...first.deliverable, compositionPath: `Composed: LLM (${LLM_MODELS.composition})` };
  return { ...critiqued.deliverable, compositionPath: `Composed: LLM (${LLM_MODELS.composition})` };
}

function withFallbackNotice(template: Deliverable, reason: string): Deliverable {
  const compositionPath = llmUnavailableLabel(reason);
  if (!/(grounding|validation|unsupported)/i.test(reason)) {
    return { ...template, compositionPath };
  }
  return {
    ...template,
    compositionPath,
    sections: [
      ...template.sections,
      {
        id: "ai-status",
        heading: "AI status",
        blocks: [{ kind: "text", text: `Template fallback is visible because the LLM path is unavailable: ${reason}` }],
      },
    ],
  };
}

async function composeOnce(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}, retry: boolean): Promise<{ ok: true; deliverable: Deliverable } | { ok: false; reason: string }> {
  const system = `You compose CRO deliverable prose for the Revenue Brain.
Use only the provided context facts, output schema, and rubric.
Reproduce every numeric value exactly as provided. Do not invent, recompute, round, or alter numbers.
Do not invent names, accounts, contacts, programs, dates, sources, or metrics.
If data is missing, say what is missing.
Return strict JSON only: {"sections":[{"id":"section-id","text":"prose for that section"}]}.
Keep prose executive-friendly and concise.
Gold outreach example: "Hi Maya, I saw your team is adding production work around a new aerospace program. BTX Precision runs certified 5-axis and build-to-print capacity in Dallas, and the work looks close to where outside machining support can keep schedules moving. Would you be open to a 20-minute call next week? BTX Precision"
Gold memo example: "Verdict: protect the account with the highest delivery risk while keeping sales focused on the strongest current opportunity. Evidence: the open pipeline is concentrated in a few accounts, the top opportunity has a clear public trigger, and the top risk has account-specific delivery evidence. Action: assign one owner to each item this week."
Gold brief example: "This account is worth a focused meeting because the public evidence points to active production need and BTX has matching certified capability. Lead with the capability fit, confirm timing and qualification requirements, and do not overstate capacity until the production window is confirmed."
Gold pitch example: "Your team is balancing new production demand with qualified supplier capacity. BTX Precision helps aerospace and defense manufacturers move machined work through AS9100 and ITAR disciplined production, with 5-axis capacity and build-to-print execution. The reason to talk now is simple: public activity suggests timing matters, and a short fit call can confirm materials, certifications, drawings, and schedule before anyone overpromises. Bring one current print package; BTX will tell you plainly where it can help and where it cannot."
Gold capabilities assessment example: "Inference: the account likely needs certified machined support tied to a current program. Fit is strong on 5-axis and AS9100, weaker on electronics assembly. Capacity is available but constrained by inspection queue, so the verdict is pursue-with-caution until drawings, timing, and inspection load are confirmed."`;

  const payload = {
    agentId: input.agentId,
    facts: input.ctx.facts,
    entityIds: input.ctx.entityIds,
    sources: input.ctx.sources,
    outputSchema: input.outputSchema,
    rubric: input.rubric,
    retry,
  };
  const parsed = await callJson(system, JSON.stringify(payload));
  if (!parsed.ok) return parsed;
  const candidate = applyLlmSections(input.template, parsed.sections);
  const grounding = checkGrounding(candidate, input.ctx);
  if (!grounding.ok) {
    if (!retry) return composeOnce(input, true);
    return { ok: false, reason: `grounding check rejected unsupported claims: ${grounding.violations.join("; ")}` };
  }
  const validation = input.validate(candidate, input.ctx);
  if (!validation.valid) {
    if (!retry) return composeOnce(input, true);
    return { ok: false, reason: `validation failed: ${validation.errors.join("; ")}` };
  }
  return { ok: true, deliverable: candidate };
}

async function critiqueAndRevise(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}, draft: { ok: true; deliverable: Deliverable }): Promise<{ ok: true; deliverable: Deliverable } | { ok: false; reason: string }> {
  const system = `Critique and revise CRO deliverable prose.
Rubric: answer-first, every claim evidenced, no generic filler, each section has a clear so-what.
Use only the provided facts and existing draft. Preserve every numeric value exactly.
Return strict JSON only: {"sections":[{"id":"section-id","text":"revised prose"}]}.`;
  const parsed = await callJson(system, JSON.stringify({
    agentId: input.agentId,
    facts: input.ctx.facts,
    outputSchema: input.outputSchema,
    rubric: input.rubric,
    draftSections: draft.deliverable.sections.map((section) => ({
      id: section.id,
      text: section.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n"),
    })),
  }));
  if (!parsed.ok) return parsed;
  const revised = applyLlmSections(draft.deliverable, parsed.sections);
  const grounding = checkGrounding(revised, input.ctx);
  if (!grounding.ok) return { ok: false, reason: `critique pass introduced unsupported claims: ${grounding.violations.join("; ")}` };
  const validation = input.validate(revised, input.ctx);
  return validation.valid
    ? { ok: true, deliverable: revised }
    : { ok: false, reason: `critique validation failed: ${validation.errors.join("; ")}` };
}

async function callJson(system: string, content: string): Promise<(LlmComposeResult & { ok: true }) | { ok: false; reason: string }> {
  if (!COPILOT_ENDPOINT) return { ok: false, reason: "VITE_COPILOT_ENDPOINT is not configured" };
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS.composition);
  try {
    const response = await fetch(COPILOT_ENDPOINT, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ model: LLM_MODELS.composition, system, messages: [{ role: "user", content }] }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      markAiOffline(`/llm returned ${response.status}`);
      return { ok: false, reason: `/llm returned ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}` };
    }
    const data = (await response.json()) as { text?: string };
    if (!data.text) return { ok: false, reason: "/llm returned no text" };
    const parsed = JSON.parse(data.text) as Partial<LlmComposeResult>;
    if (!Array.isArray(parsed.sections)) return { ok: false, reason: "LLM returned JSON without sections" };
    if (!parsed.sections.every((section) => typeof section.id === "string" && typeof section.text === "string")) {
      return { ok: false, reason: "LLM returned invalid section objects" };
    }
    markAiLive(LLM_MODELS.composition);
    return { ok: true, sections: parsed.sections };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "LLM call failed";
    markAiOffline(reason);
    return { ok: false, reason };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function applyLlmSections(template: Deliverable, sections: LlmSection[]): Deliverable {
  const byId = new Map(sections.map((section) => [section.id, section.text]));
  return {
    ...template,
    sections: template.sections.map((section) => applySection(section, byId.get(section.id))),
  };
}

function applySection(section: DeliverableSection, text: string | undefined): DeliverableSection {
  if (!text) return section;
  let used = false;
  return {
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.kind !== "text") return block;
      if (used) return block;
      used = true;
      return { ...block, text };
    }),
  };
}

function checkGrounding(deliverable: Deliverable, ctx: AgentContext): GroundingResult {
  const groundingText = [
    ...Object.values(ctx.facts)
      .filter((value): value is string | number => typeof value === "number" || typeof value === "string")
      .map(String),
    ...ctx.sources.flatMap((source) => [source.source, source.reason, ...source.records]),
  ];
  const allowedClaims = new Set(
    groundingText.flatMap((value) => claimTokens(String(value))),
  );
  const text = deliverable.sections
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === "text")
    .map((block) => block.text)
    .join(" ");
  const violations: string[] = [];
  for (const token of claimTokens(text)) {
    if (!allowedClaims.has(token)) violations.push(`"${token}" has no source`);
  }
  const allowedNames = new Set(
    groundingText.flatMap((value) => candidateNames(value)),
  );
  for (const name of candidateNames(text)) {
    if (!allowedNames.has(name) && !["Revenue Brain", "Executive Summary"].includes(name)) violations.push(`"${name}" has no source`);
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)].slice(0, 8) };
}

function claimTokens(text: string): string[] {
  const quantities = [...text.matchAll(/\$?\d+(?:,\d{3})*(?:\.\d+)?(?:%|\s?(?:days?|weeks?|months?|years?|hours?|hrs?|units?|parts?|quotes?|opportunities?|deals?))?/gi)]
    .map((match) => normalizeClaim(match[0]));
  const dates = [...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s+\d{4})?|\b\d{4}-\d{2}-\d{2}\b/gi)]
    .map((match) => normalizeClaim(match[0]));
  return [...new Set([...quantities, ...dates])].filter(Boolean);
}

function normalizeClaim(token: string): string {
  return token.replace(/[,$%]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function candidateNames(text: string): string[] {
  return [...text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g)].map((match) => match[0]);
}
