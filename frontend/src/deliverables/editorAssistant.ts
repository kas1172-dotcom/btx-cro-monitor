import { backendHeaders } from "../app/backendApi.ts";
import { LLM_MODELS } from "../app/llmConfig.ts";
import type { Deliverable, DeliverableSection } from "./types.ts";

export interface RevisionRequest {
  endpoint: string;
  deliverable: Pick<Deliverable, "title" | "audience" | "form">;
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
  bannedVocabulary = [],
  fetchImpl = fetch,
}: RevisionRequest): Promise<string> {
  const bannedLine = bannedVocabulary.length
    ? `Avoid these banned terms exactly: ${bannedVocabulary.join(", ")}.`
    : "No banned vocabulary list was provided.";
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: await backendHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      model: LLM_MODELS.composition,
      system: `Revise one deliverable section. Preserve facts and numbers. Respect audience/form rules and banned vocabulary. ${bannedLine} Return only revised prose.`,
      messages: [{ role: "user", content: JSON.stringify({ title: deliverable.title, audience: deliverable.audience, form: deliverable.form, section, instruction, bannedVocabulary }) }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Assistant revision failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = (await res.json()) as { text?: string };
  if (!data.text?.trim()) throw new Error("Assistant revision returned no text.");
  return data.text;
}
