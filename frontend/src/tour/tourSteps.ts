import type { World } from "../app/useWorld.ts";
import { dispatchBrainQuestion } from "../app/brainActions.ts";
import { getState, setState, waitForState } from "../store/store.ts";
import { runAgent } from "../agents/runAgent.ts";
import { saveDeliverable } from "../memory/localMemory.ts";

export type TourCompletion = "response" | "deliverable" | "analysis" | "dossier" | "hold" | "home";
export type TourExecution = "ask" | "dossier" | "hold" | "analysis" | "agent" | "home";

export interface TourStep {
  title: string;
  prompt?: string;
  actionLabel: string;
  completion: TourCompletion;
  execution: TourExecution;
  agentId?: "outreach" | "sales_pitch" | "capabilities_assessment" | "board_deck";
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Monday, 7am — the brain already did the reading.",
    prompt: "What should I care about this week?",
    actionLabel: "Ask: What should I care about this week?",
    completion: "deliverable",
    execution: "ask",
  },
  {
    title: "One opportunity stands out — and the brain says why.",
    actionLabel: "Open the top opportunity dossier",
    completion: "dossier",
    execution: "dossier",
  },
  {
    title: "Everything known about them, in one place — scores, signals, pipeline, provenance.",
    actionLabel: "Hold on the dossier",
    completion: "hold",
    execution: "hold",
  },
  {
    title: "Why them, why now? The brain shows its work.",
    actionLabel: "Ask why this account is a good target",
    completion: "response",
    execution: "ask",
  },
  {
    title: "Where do they sit in the market we can serve?",
    actionLabel: "Open account-segment revenue and fit analysis",
    completion: "analysis",
    execution: "analysis",
  },
  {
    title: "Can BTX actually deliver this work? Honest answer, before we promise anything.",
    actionLabel: "Run capabilities assessment",
    completion: "deliverable",
    execution: "agent",
    agentId: "capabilities_assessment",
  },
  {
    title: "The brain drafts the outreach — grounded in their world, not boilerplate.",
    actionLabel: "Draft outreach under 100 words",
    completion: "deliverable",
    execution: "agent",
    agentId: "outreach",
  },
  {
    title: "A one-page pitch, ready for the meeting.",
    actionLabel: "Create sales pitch",
    completion: "deliverable",
    execution: "agent",
    agentId: "sales_pitch",
  },
  {
    title: "And the full deck — figures computed, sources attached, PowerPoint ready.",
    actionLabel: "Generate board deck",
    completion: "deliverable",
    execution: "agent",
    agentId: "board_deck",
  },
  {
    title: "A morning's work in four minutes — and the brain remembered all of it.",
    actionLabel: "Return Home and show the Library",
    completion: "home",
    execution: "home",
  },
];

function completionPredicate(step: TourStep): boolean {
  const current = getState();
  if (step.completion === "deliverable") return current.activeDeliverable !== null;
  if (step.completion === "analysis") return current.activeAnalysisSpec !== null;
  if (step.completion === "dossier") return current.activeCompanyId !== null;
  if (step.completion === "hold") return current.activeCompanyId !== null;
  if (step.completion === "home") return current.activeHome && !current.brainResponse && !current.activeDeliverable && !current.activeAnalysisSpec && !current.activeCompanyId;
  return current.brainResponse !== null;
}

function topTourAccount(world: World) {
  const account = world.prospects[0]?.company ?? world.companies.find((company) => company.relationship === "target" || company.relationship === "customer");
  if (!account) throw new Error("No account available for tour");
  return account;
}

function agentInputs(step: TourStep, world: World) {
  const account = topTourAccount(world);
  if (step.agentId === "board_deck") return { quarter: "Q2 2026", audience: "board" };
  if (step.agentId === "outreach") return { accountId: account.id, instructions: "lead with 5-axis capacity, keep it under 100 words" };
  if (step.agentId === "capabilities_assessment") return { accountId: account.id };
  return { accountId: account.id };
}

function askPrompt(step: TourStep, world: World): string {
  if (step.prompt) return step.prompt;
  const account = topTourAccount(world);
  return `Why is ${account.name} a good target right now?`;
}

export async function executeTourStep(step: TourStep, world: World, timeoutMs = 15000): Promise<void> {
  const account = topTourAccount(world);
  if (step.execution === "ask") {
    await dispatchBrainQuestion(askPrompt(step, world), world, { accountId: account.id });
  }
  if (step.execution === "dossier") {
    setState({ activeCompanyId: account.id, activeDeliverable: null, activeAnalysisSpec: null, brainResponse: null, activeBrainArea: "customer" });
  }
  if (step.execution === "hold") {
    setState({ activeCompanyId: account.id, activeDeliverable: null, activeAnalysisSpec: null, brainResponse: null, activeBrainArea: "customer" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  if (step.execution === "analysis") {
    setState({
      activeCompanyId: null,
      activeDeliverable: null,
      brainResponse: null,
      activeBrainArea: "decision",
      activeAnalysisSpec: {
        viz: "heatmap",
        metric: "revenue",
        rows: "account",
        cols: "quarter",
        color: "revenue_yoy_change",
        filters: { segment: account.account_status ?? account.relationship },
      },
    });
  }
  if (step.execution === "agent") {
    if (!step.agentId) throw new Error("Tour agent step missing agentId");
    const deliverable = await runAgent(step.agentId, agentInputs(step, world), world);
    saveDeliverable(deliverable);
    setState({ activeDeliverable: deliverable, activeCompanyId: null, activeAnalysisSpec: null, brainResponse: null, activeBrainArea: deliverable.brainArea });
  }
  if (step.execution === "home") {
    setState({ activeHome: true, brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null });
  }
  await waitForState(() => completionPredicate(step), timeoutMs);
}
