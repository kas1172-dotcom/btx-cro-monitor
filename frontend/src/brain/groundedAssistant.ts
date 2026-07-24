import type { World } from "../app/useWorld.ts";
import { displayLabel } from "../app/displayLabels.ts";
import { qualitativeSignalConfidence, prospectQualificationLabel } from "../app/confidence.ts";
import { signalHeadline, signalSourceName } from "../app/signalProvenance.ts";
import { deriveWorkItems } from "../app/workItems.ts";
import { backendHeaders } from "../app/backendApi.ts";
import { COPILOT_ENDPOINT, checkAiStatus, markAiLive, markAiOffline } from "../app/aiStatus.ts";
import { LLM_MODELS, LLM_TIMEOUT_MS } from "../app/llmConfig.ts";
import { VOICE_RULES_PROMPT } from "../app/voiceRules.ts";
import type { BrainChatMessage, BrainResponse } from "./types.ts";

export interface GroundedAssistantResult {
  response: BrainResponse;
  source: "llm" | "offline";
}

function money(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value / 1000)}k`;
}

function plain(value: unknown): string {
  return String(value ?? "").replace(/[{}[\]"`]/g, "").replace(/\s+/g, " ").trim();
}

function contextPack(world: World): string {
  const accounts = world.companies.map((company) => {
    const contact = world.contacts.find((row) => row.company_id === company.id);
    const deals = world.opportunities.filter((row) => row.company_id === company.id);
    const fit = world.prospects.find((row) => row.company.id === company.id)?.fit;
    const qualification = prospectQualificationLabel({
      company,
      contact,
      opportunities: deals,
      fitMatched: fit?.matched ?? [],
    });
    return [
      `Account: ${company.name}`,
      `id: ${company.id}`,
      `relationship: ${company.relationship}`,
      `status: ${company.account_status ?? "not provided"}`,
      `motion: ${company.business_motion ?? "not provided"}`,
      `location: ${company.location.city}${company.location.state ? `, ${company.location.state}` : ""}`,
      `CAGE: ${company.cage_code ?? "not provided"}`,
      `UEI: ${company.uei ?? "not provided"}`,
      `known programs: ${company.known_programs?.join(", ") || "not provided"}`,
      `contact: ${contact ? `${contact.name}, ${contact.title}` : "not provided"}`,
      `pipeline: ${deals.length ? deals.map((deal) => `${deal.name}, ${deal.stage}, ${money(deal.value)}, close ${deal.close_date}`).join(" | ") : "not provided"}`,
      `qualification: ${qualification.label}${qualification.gaps.length ? `, missing ${qualification.gaps.join(", ")}` : ""}`,
    ].join("\n");
  });

  const signals = world.analysis.valid.map((signal) => {
    const confidence = qualitativeSignalConfidence(signal);
    const resolved = world.companies.find((company) => company.id === signal.subject_id || company.canonical_account_id === signal.subject_id);
    return [
      `Signal: ${signalHeadline(signal)}`,
      `id: ${signal.id}`,
      `event type: ${displayLabel(signal.event_type)}`,
      `source: ${signalSourceName(signal)}`,
      `date: ${signal.detected_at}`,
      `value: ${signal.value ? money(signal.value) : "not provided"}`,
      `subject: ${resolved?.name ?? signal.subject_id}`,
      `link: ${signal.scope === "specific_account" ? "verified account link" : "unlinked prospect signal"}`,
      `confidence band: ${confidence.label}`,
      `confidence reason: ${confidence.reason}`,
      `evidence: ${signal.source_quote}`,
    ].join("\n");
  });

  const scores = world.analysis.scores.map((score) => {
    const company = world.companies.find((row) => row.id === score.subject_id);
    return [
      `Score: ${company?.name ?? score.subject_id}`,
      `opportunity: ${score.dimensions.opportunity.score}`,
      `risk: ${score.dimensions.risk.score}`,
      `capacity risk: ${score.dimensions.capacityRisk.score}`,
      `competitive pressure: ${score.dimensions.competitivePressure.score}`,
    ].join("\n");
  });

  const workItems = deriveWorkItems(world).slice(0, 8).map((item) => {
    const company = world.companies.find((row) => row.id === item.canonical_account_id);
    return [
      `Work item: ${item.recommended_action}`,
      `account: ${company?.name ?? item.canonical_account_id ?? "portfolio"}`,
      `type: ${item.type}`,
      `priority: ${item.priority}`,
      `status: ${item.status}`,
      `due: ${item.due_date ?? "not provided"}`,
    ].join("\n");
  });

  return [
    "BTX Revenue Brain context pack",
    `Monitor run: ${world.snapshot?.publicSignals.run_at ?? "not provided"}`,
    `Data source: ${world.dataSource ?? "not provided"}`,
    "",
    "Accounts",
    accounts.join("\n\n"),
    "",
    "Signals",
    signals.join("\n\n"),
    "",
    "Scores",
    scores.join("\n\n"),
    "",
    "Work items",
    workItems.join("\n\n") || "not provided",
  ].join("\n");
}

function systemPrompt(context: string): string {
  return [
    "You are the BTX Revenue Brain assistant inside a sales demo cockpit.",
    "Answer only from the context pack below. Do not use outside knowledge about specific companies.",
    "Do not invent accounts, contacts, scores, dollar values, dates, programs, capacity, CAGE, UEI, CRM fields, or pipeline.",
    "When a value is missing, say it is not in the data.",
    "Use qualitative evidence bands exactly as provided. Do not calculate or display percentage confidence.",
    "For Saronic Technologies, be explicit that it needs qualification when asked about pursuit rationale.",
    "Keep answers concise, conversational, and action-first.",
    "When recommending a next step, phrase it as something the user should confirm, never as an action you already performed.",
    "",
    VOICE_RULES_PROMPT,
    "",
    context,
  ].join("\n");
}

function allowedNumber(answerNumber: string, context: string): boolean {
  const compactAnswer = answerNumber.replace(/[,$%]/g, "");
  const compactContext = context.replace(/[,$%]/g, "");
  if (compactContext.includes(compactAnswer)) return true;
  if (/^\d+$/.test(compactAnswer) && Number(compactAnswer) < 100) return true;
  return false;
}

function groundingProblems(answer: string, context: string, world: World): string[] {
  const problems: string[] = [];
  const numbers = answer.match(/\$?\d+(?:,\d{3})*(?:\.\d+)?%?|\b\d+(?:\.\d+)?B\b|\b\d+(?:\.\d+)?M\b/g) ?? [];
  for (const value of numbers) {
    if (!allowedNumber(value, context)) problems.push(`number ${value} is not in context`);
  }
  const allowedNames = new Set([
    "BTX",
    "Revenue Brain",
    ...world.companies.map((company) => company.name),
    ...world.companies.flatMap((company) => company.aliases ?? []),
    ...world.contacts.map((contact) => contact.name),
    ...world.analysis.valid.flatMap((signal) => signal.entities),
  ].map(plain).filter(Boolean));
  const companyLike = answer.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z0-9]+){1,4}\b/g) ?? [];
  for (const name of companyLike) {
    const normalized = plain(name);
    if (allowedNames.has(normalized)) continue;
    if (["HubSpot", "CAGE", "UEI", "Navy", "Austin", "Texas", "Fort Worth", "United States"].includes(normalized)) continue;
    if (context.includes(normalized)) continue;
    problems.push(`name ${normalized} is not in context`);
  }
  return [...new Set(problems)].slice(0, 4);
}

function actionsFromAnswer(answer: string, world: World): string[] {
  const lower = answer.toLowerCase();
  const actions: string[] = [];
  const namedCompany = world.companies.find((company) => lower.includes(company.name.toLowerCase()));
  if (namedCompany) actions.push(`Open ${namedCompany.name}`);
  if (/brief|call prep|meeting/.test(lower)) actions.push("Create deliverable");
  if (/task|follow up|qualif|research|outreach/.test(lower)) actions.push("Create HubSpot task");
  if (/prospect|saronic|qualif/.test(lower)) actions.push("Open prospecting");
  return [...new Set(actions)].slice(0, 4);
}

async function callLlm(question: string, context: string, history: BrainChatMessage[], correction?: string): Promise<string> {
  if (!COPILOT_ENDPOINT) throw new Error("VITE_COPILOT_ENDPOINT is not configured");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), LLM_TIMEOUT_MS.chatpil);
  try {
    const messages = [
      ...history.slice(-8).map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: correction ? `${question}\n\nGrounding correction: ${correction}` : question },
    ];
    const response = await fetch(COPILOT_ENDPOINT, {
      method: "POST",
      headers: await backendHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        model: LLM_MODELS.chatpil,
        system: systemPrompt(context),
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/llm returned ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string" || data.text.trim().length === 0) throw new Error("/llm returned no text");
    return data.text.trim();
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function composeGroundedBrainResponse(
  question: string,
  world: World,
  fallback: BrainResponse,
  history: BrainChatMessage[] = [],
): Promise<GroundedAssistantResult> {
  const status = await checkAiStatus();
  if (status.state !== "live") {
    const reason = status.reason ?? "AI service is offline";
    const directAnswer = `Limited offline answer: ${fallback.directAnswer}`;
    return {
      response: {
        ...fallback,
        directAnswer,
        whyThisMatters: `${fallback.whyThisMatters} Live chat is unavailable, ${reason}.`,
        contextUsed: [{ source: "offline answer fallback", reason }, ...fallback.contextUsed],
        conversation: [...history, { role: "user", content: question }, { role: "assistant", content: directAnswer, source: "offline" }],
      },
      source: "offline",
    };
  }

  const context = contextPack(world);
  try {
    let answer = await callLlm(question, context, history);
    let problems = groundingProblems(answer, context, world);
    if (problems.length) {
      answer = await callLlm(question, context, history, `Your previous answer used unsupported facts: ${problems.join("; ")}. Rewrite using only exact context values.`);
      problems = groundingProblems(answer, context, world);
    }
    if (problems.length) throw new Error(`grounding failed: ${problems.join("; ")}`);
    markAiLive(LLM_MODELS.chatpil);
    const actions = actionsFromAnswer(answer, world);
    return {
      response: {
        ...fallback,
        directAnswer: answer,
        whyThisMatters: "This answer was composed from the live cockpit context pack: CRM accounts, pinned signals, work items, and engine scores.",
        contextUsed: [
          { source: `LLM grounded assistant (${LLM_MODELS.chatpil})`, reason: "Composed from the compact live world context pack after a grounding check." },
          ...fallback.contextUsed,
        ],
        recommendedActions: actions.length ? actions : fallback.recommendedActions,
        suggestedNextQuestions: fallback.suggestedNextQuestions,
        conversation: [...history, { role: "user", content: question }, { role: "assistant", content: answer, source: "llm" }],
      },
      source: "llm",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "grounded assistant failed";
    markAiOffline(reason);
    const directAnswer = `Limited offline answer: ${fallback.directAnswer}`;
    return {
      response: {
        ...fallback,
        directAnswer,
        whyThisMatters: `${fallback.whyThisMatters} Live chat failed, ${reason}.`,
        contextUsed: [{ source: "offline answer fallback", reason }, ...fallback.contextUsed],
        conversation: [...history, { role: "user", content: question }, { role: "assistant", content: directAnswer, source: "offline" }],
      },
      source: "offline",
    };
  }
}
