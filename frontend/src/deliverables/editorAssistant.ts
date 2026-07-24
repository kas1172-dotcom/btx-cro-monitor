import { backendHeaders } from "../app/backendApi.ts";
import { LLM_MODELS } from "../app/llmConfig.ts";
import { BANNED_WORDS, VOICE_RULES_PROMPT, findVoiceViolations } from "../app/voiceRules.ts";
import type { Deliverable, DeliverableSection } from "./types.ts";

export interface RevisionRequest {
  endpoint: string;
  deliverable: Pick<Deliverable, "title" | "audience" | "form" | "sources">;
  section: DeliverableSection;
  instruction: string;
  bannedVocabulary?: string[];
  fetchImpl?: typeof fetch;
}

export async function requestSectionRevision({
  endpoint,
  deliverable,
  section,
  instruction,
  bannedVocabulary = [...BANNED_WORDS],
  fetchImpl = fetch,
}: RevisionRequest): Promise<string> {
  const bannedLine = `Avoid these banned terms exactly: ${bannedVocabulary.join(", ")}.`;
  const sourceContext = deliverable.sources.map((source) => ({
    source: source.source,
    reason: source.reason,
    records: source.records,
  }));
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: await backendHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      model: LLM_MODELS.composition,
      system: `Revise one deliverable section. Use only the provided source context. Preserve names, dates, quantities, and units exactly unless the instruction asks to remove them. Do not introduce facts, numbers, dates, or names that are absent from source context. Respect audience/form rules and banned vocabulary. ${bannedLine}\n\n${VOICE_RULES_PROMPT}\n\nReturn only revised prose.`,
      messages: [{
        role: "user",
        content: JSON.stringify({
          title: deliverable.title,
          audience: deliverable.audience,
          form: deliverable.form,
          section,
          instruction,
          bannedVocabulary,
          sourceContext,
        }),
      }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Assistant revision failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = (await res.json()) as { text?: string };
  if (!data.text?.trim()) throw new Error("Assistant revision returned no text.");
  const violations = findVoiceViolations(data.text);
  if (violations.length) throw new Error(`Revision broke the BTX voice rules: ${violations.join("; ")}`);
  return data.text;
}
