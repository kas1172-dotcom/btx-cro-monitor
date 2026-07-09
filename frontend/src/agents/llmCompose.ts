import type { Deliverable, DeliverableSection, ValidationResult } from "../deliverables/types.ts";
import type { AgentContext, SectionSpec } from "./contract.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "../app/llmConfig.ts";
import { backendHeaders } from "../app/backendApi.ts";

interface LlmSection {
  id: string;
  text: string;
}

interface LlmComposeResult {
  sections: LlmSection[];
}

const ENDPOINT =
  (import.meta as ImportMeta & { env?: { VITE_COPILOT_ENDPOINT?: string } }).env?.VITE_COPILOT_ENDPOINT ??
  ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_COPILOT_ENDPOINT);

export async function maybeComposeWithLlm(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}): Promise<Deliverable> {
  if (!ENDPOINT) return { ...input.template, compositionPath: "Composed: template" };

  const first = await composeOnce(input, false);
  if (!first) return { ...input.template, compositionPath: "Composed: template" };
  const critiqued = await critiqueAndRevise(input, first);
  return { ...(critiqued ?? first), compositionPath: "Composed: LLM (claude-sonnet-4-5)" };
}

async function composeOnce(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}, retry: boolean): Promise<Deliverable | null> {
  const system = `You compose CRO deliverable prose for the Revenue Brain.
Use only the provided context facts, output schema, and rubric.
Reproduce every numeric value exactly as provided. Do not invent, recompute, round, or alter numbers.
Do not invent names, accounts, contacts, programs, dates, sources, or metrics.
If data is missing, say what is missing.
Return strict JSON only: {"sections":[{"id":"section-id","text":"prose for that section"}]}.
Keep prose executive-friendly and concise.
Gold outreach example: "Hi Maya, I saw your team is adding production work around a new aerospace program. BTX Precision runs certified 5-axis and build-to-print capacity in Dallas, and the work looks close to where outside machining support can keep schedules moving. Would you be open to a 20-minute call next week? Alyssa Hart, Chief Revenue Officer, BTX Precision"
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
  if (!parsed) return null;
  const candidate = applyLlmSections(input.template, parsed.sections);
  if (!passesGrounding(candidate, input.ctx)) {
    if (!retry) return composeOnce(input, true);
    return null;
  }
  const validation = input.validate(candidate, input.ctx);
  if (!validation.valid) {
    if (!retry) return composeOnce(input, true);
    return null;
  }
  return candidate;
}

async function critiqueAndRevise(input: {
  agentId: string;
  template: Deliverable;
  ctx: AgentContext;
  outputSchema: SectionSpec[];
  rubric: string;
  validate: (deliverable: Deliverable, ctx: AgentContext) => ValidationResult;
}, draft: Deliverable): Promise<Deliverable | null> {
  const system = `Critique and revise CRO deliverable prose.
Rubric: answer-first, every claim evidenced, no generic filler, each section has a clear so-what.
Use only the provided facts and existing draft. Preserve every numeric value exactly.
Return strict JSON only: {"sections":[{"id":"section-id","text":"revised prose"}]}.`;
  const parsed = await callJson(system, JSON.stringify({
    agentId: input.agentId,
    facts: input.ctx.facts,
    outputSchema: input.outputSchema,
    rubric: input.rubric,
    draftSections: draft.sections.map((section) => ({
      id: section.id,
      text: section.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n"),
    })),
  }));
  if (!parsed) return null;
  const revised = applyLlmSections(draft, parsed.sections);
  if (!passesGrounding(revised, input.ctx)) return null;
  const validation = input.validate(revised, input.ctx);
  return validation.valid ? revised : null;
}

async function callJson(system: string, content: string): Promise<LlmComposeResult | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS.composition);
  try {
    const response = await fetch(ENDPOINT as string, {
      method: "POST",
      headers: backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ model: LLM_MODELS.composition, system, messages: [{ role: "user", content }] }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { text?: string };
    if (!data.text) return null;
    const parsed = JSON.parse(data.text) as Partial<LlmComposeResult>;
    if (!Array.isArray(parsed.sections)) return null;
    if (!parsed.sections.every((section) => typeof section.id === "string" && typeof section.text === "string")) return null;
    return { sections: parsed.sections };
  } catch {
    return null;
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

function passesGrounding(deliverable: Deliverable, ctx: AgentContext): boolean {
  const groundingText = [
    ...Object.values(ctx.facts)
      .filter((value): value is string | number => typeof value === "number" || typeof value === "string")
      .map(String),
    ...ctx.sources.flatMap((source) => [source.source, source.reason, ...source.records]),
  ];
  const allowedNumbers = new Set(
    groundingText.flatMap((value) => numberTokens(String(value))),
  );
  const text = deliverable.sections
    .flatMap((section) => section.blocks)
    .filter((block) => block.kind === "text")
    .map((block) => block.text)
    .join(" ");
  for (const token of numberTokens(text)) {
    if (!allowedNumbers.has(token)) return false;
  }
  const allowedNames = new Set(
    groundingText.flatMap((value) => candidateNames(value)),
  );
  for (const name of candidateNames(text)) {
    if (!allowedNames.has(name) && !["Revenue Brain", "Executive Summary"].includes(name)) return false;
  }
  return true;
}

function numberTokens(text: string): string[] {
  return [...text.matchAll(/\$?\d+(?:\.\d+)?%?|\d+(?:,\d{3})+/g)].map((match) => match[0].replace(/[,$%]/g, ""));
}

function candidateNames(text: string): string[] {
  return [...text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g)].map((match) => match[0]);
}
