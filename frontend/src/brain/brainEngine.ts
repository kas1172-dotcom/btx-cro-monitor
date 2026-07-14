import type { World } from "../app/useWorld.ts";
import { classifyQuestion } from "./classifyQuestion.ts";
import { retrieveContext } from "./retrieveContext.ts";
import { generateBrainResponse } from "./generateBrainResponse.ts";
import type { BrainResponse } from "./types.ts";
import { routeBrainQuestion } from "./llmRouter.ts";

export function processBrainQuestion(question: string, world?: World): BrainResponse {
  if (!world) {
    return {
      question,
      directAnswer: "The Revenue Brain is still loading its local demo context.",
      whyThisMatters: "The brain only answers from deterministic engine data, so it waits for account, signal, opportunity, and capacity context before answering.",
      activatedTabs: ["analysis"],
      contextUsed: [{ source: "local demo adapter", reason: "Required before deterministic scoring can run." }],
      recommendedActions: ["Wait for data to load", "Ask again from the cockpit"],
      savedNote: { title: "Brain context unavailable", brainArea: "analysis", summary: "Question received before context loaded.", entities: [] },
      suggestedNextQuestions: ["What should I care about this week?", "Who should I target in Austin?"],
      relatedOpportunities: [],
      confidence: "low",
    };
  }
  const classification = classifyQuestion(question);
  const context = retrieveContext(question, classification.intent, classification.activatedTabs, world);
  return generateBrainResponse(context, world);
}

export async function processBrainQuestionAsync(question: string, world?: World): Promise<BrainResponse> {
  if (!world) return processBrainQuestion(question, world);
  const classification = await routeBrainQuestion(question, world);
  const context = retrieveContext(question, classification.intent, classification.activatedTabs, world);
  const response = generateBrainResponse(context, world);
  return {
    ...response,
    contextUsed: [
      {
        source: classification.routedBy === "llm" ? "LLM router" : "offline routing fallback",
        reason: classification.routedBy === "llm"
          ? "Validated strict JSON routing metadata from the configured proxy."
          : "Keyword classifier used because no valid router response was available.",
      },
      ...response.contextUsed,
    ],
  };
}

export type { BrainResponse };
