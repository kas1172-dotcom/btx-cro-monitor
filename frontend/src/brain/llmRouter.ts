import { z } from "zod";
import type { World } from "../app/useWorld.ts";
import { classifyQuestion } from "./classifyQuestion.ts";
import type { Classification } from "./classifyQuestion.ts";
import { TAB_IDS } from "../app/surfaces.ts";
import type { QuestionIntent } from "./types.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "../app/llmConfig.ts";
import { backendHeaders } from "../app/backendApi.ts";
import { COPILOT_ENDPOINT, checkAiStatus, markAiLive, markAiOffline } from "../app/aiStatus.ts";

const INTENTS: QuestionIntent[] = [
  "market_signals",
  "geographic_prospecting",
  "account_risk",
  "sales_focus",
  "weekly_brief",
  "capabilities",
  "outreach",
  "general",
];
const RouterResult = z.object({
  intent: z.enum(INTENTS),
  activatedTabs: z.array(z.enum(TAB_IDS)).min(1),
  entities: z.array(z.string()).default([]),
  deliverableType: z.enum(["itinerary", "meeting_brief", "board_deck", "weekly_memo", "analysis_view", "outreach", "sales_pitch", "capabilities_assessment"]).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export interface RoutedClassification extends Classification {
  routedBy: "llm" | "offline_fallback";
  entities: string[];
  deliverableType?: string;
  params: Record<string, unknown>;
}

function routerSystem(world: World): string {
  const names = world.companies.map((c) => c.name).join(", ");
  const cities = [...new Set(world.companies.map((c) => c.location.city))].join(", ");
  return `Route a CRO question for the BTX Revenue Brain. Return strict JSON only.
Allowed intents: ${INTENTS.join(", ")}.
Allowed tabs: ${TAB_IDS.join(", ")}.
Known account names: ${names}.
Known cities: ${cities}.
Do not answer the user. Do not compute scores or numbers. Extract only routing metadata present in the question or known names.`;
}

async function withTimeout(url: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS.routing);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`router status ${response.status}`);
    return response.json();
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function routeBrainQuestion(question: string, world: World): Promise<RoutedClassification> {
  const fallback = classifyQuestion(question);
  const status = await checkAiStatus();
  if (status.state !== "live" || !COPILOT_ENDPOINT) return { ...fallback, routedBy: "offline_fallback", entities: [], params: {} };

  try {
    const raw = await withTimeout(COPILOT_ENDPOINT, {
      model: LLM_MODELS.routing,
      system: routerSystem(world),
      messages: [{ role: "user", content: question }],
    });
    const text = (raw as { text?: unknown }).text;
    if (typeof text !== "string") throw new Error("router returned no text");
    const parsed = RouterResult.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(parsed.error.message);
    markAiLive(LLM_MODELS.routing);
    return {
      intent: parsed.data.intent,
      activatedTabs: parsed.data.activatedTabs,
      routedBy: "llm",
      entities: parsed.data.entities,
      deliverableType: parsed.data.deliverableType,
      params: parsed.data.params,
    };
  } catch (error) {
    markAiOffline(error instanceof Error ? error.message : "router failed");
    return { ...fallback, routedBy: "offline_fallback", entities: [], params: {} };
  }
}
