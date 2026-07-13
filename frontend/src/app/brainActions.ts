import type { World } from "./useWorld.ts";
import { processBrainQuestionAsync } from "../brain/brainEngine.ts";
import type { TabId } from "./surfaces.ts";
import type { BrainResponse } from "../brain/types.ts";
import type { Deliverable } from "../deliverables/types.ts";
import { runAgent } from "../agents/runAgent.ts";
import { saveBrainMemoryNote, saveDeliverable } from "../memory/localMemory.ts";
import { setState } from "../store/store.ts";
import type { MetricId } from "../metrics/types.ts";
import { defaultDateAnchor, defaultTripWindow, latestCompletedQuarter } from "./dateDefaults.ts";

export interface BrainActionOptions {
  accountId?: string;
  city?: string;
  startDate?: string;
  endDate?: string;
  quarter?: string;
  metric?: MetricId;
  instructions?: string;
}

export interface BrainActionEvents {
  routed?: (response: BrainResponse, usedFallback: boolean) => void;
  retrieved?: (response: BrainResponse) => void;
  scored?: (response: BrainResponse, scoredCount: number) => void;
  composing?: (label: string) => void;
  completed?: (result: BrainActionResult) => void;
}

export type BrainActionCompletion =
  | "response"
  | "deliverable"
  | "analysis"
  | "activity";

export interface BrainActionResult {
  completion: BrainActionCompletion;
  response: BrainResponse | null;
  deliverable: Deliverable | null;
}

function firstAvailableAccountId(world: World): string | undefined {
  return world.prospects[0]?.company.id ?? world.companies[0]?.id;
}

function namedAccountId(question: string, world: World): string | undefined {
  const lower = question.toLowerCase();
  const accounts = world.prospects.map((prospect) => prospect.company);
  return accounts.find((account) => lower.includes(account.name.toLowerCase()))?.id;
}

function routeArea(response: BrainResponse, fallback: TabId = "analysis"): TabId {
  return response.activatedTabs[0] ?? fallback;
}

export async function dispatchBrainQuestion(
  question: string,
  world: World,
  options: BrainActionOptions = {},
  events: BrainActionEvents = {},
): Promise<BrainActionResult> {
  const q = question.trim();
  if (!q) throw new Error("Cannot dispatch an empty brain question");

  const response = await processBrainQuestionAsync(q, world);
  const usedFallback = response.contextUsed.some((source) => source.source === "offline routing fallback");
  events.routed?.(response, usedFallback);
  events.retrieved?.(response);
  events.scored?.(response, response.relatedOpportunities.length || world.prospects.length);
  events.composing?.("Composing the answer");
  saveBrainMemoryNote(response.savedNote);

  const lower = q.toLowerCase();
  const instructions = options.instructions?.trim();
  let result: BrainActionResult;

  if (lower.includes("plan a trip") || lower.includes("who should i talk to") || lower.includes("who should i see")) {
    const tripDefaults = defaultTripWindow(defaultDateAnchor(world));
    const cities = [...new Set(world.companies.map((company) => company.location.city))].sort();
    const city = cities.find((candidate) => lower.includes(candidate.toLowerCase())) ?? world.city ?? options.city ?? "Austin";
    events.composing?.("Clustering stops by day");
    const deliverable = await runAgent("itinerary", {
      city,
      startDate: options.startDate ?? tripDefaults.startDate,
      endDate: options.endDate ?? tripDefaults.endDate,
      focus: "mixed",
      instructions,
    }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "map", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("board deck") || lower.includes("quarterly board")) {
    events.composing?.("Building board deck");
    const deliverable = await runAgent("board_deck", {
      quarter: options.quarter ?? latestCompletedQuarter(defaultDateAnchor(world)),
      audience: "board",
      instructions,
    }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "analysis", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("analysis view") || lower.includes("show revenue by client") || lower.includes("revenue heatmap")) {
    events.composing?.("Preparing analysis view");
    const quarter = options.quarter ?? latestCompletedQuarter(defaultDateAnchor(world));
    const deliverable = await runAgent("analysis_annotation", {
      metric: options.metric ?? "revenue",
      quarter,
      instructions,
    }, world);
    saveDeliverable(deliverable);
    setState({
      brainResponse: response,
      activeTab: "analysis",
      activeDeliverable: null,
      activeAnalysisSpec: {
        viz: "heatmap",
        metric: options.metric ?? "revenue",
        rows: "account",
        cols: "quarter",
        color: "revenue_yoy_change",
      },
    });
    result = { completion: "analysis", response, deliverable: null };
  } else if (lower.includes("meeting brief")) {
    const selectedAccountId = namedAccountId(q, world) ?? options.accountId ?? firstAvailableAccountId(world);
    if (!selectedAccountId) throw new Error("No account available for meeting brief");
    events.composing?.("Composing meeting brief");
    const deliverable = await runAgent("meeting_brief", { accountId: selectedAccountId, instructions }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "accounts", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("sales pitch") || lower.includes("draft a pitch") || lower.includes("one-page pitch") || lower.includes("one page pitch")) {
    const selectedAccountId = namedAccountId(q, world) ?? options.accountId ?? firstAvailableAccountId(world);
    if (!selectedAccountId) throw new Error("No account available for sales pitch");
    events.composing?.("Drafting sales pitch");
    const deliverable = await runAgent("sales_pitch", { accountId: selectedAccountId, instructions }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "work_queue", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("capabilities assessment") || lower.includes("can we actually serve") || lower.includes("should we chase") || lower.includes("can btx serve")) {
    const selectedAccountId = namedAccountId(q, world) ?? options.accountId ?? firstAvailableAccountId(world);
    if (!selectedAccountId) throw new Error("No account available for capabilities assessment");
    events.composing?.("Checking fit and capacity");
    const deliverable = await runAgent("capabilities_assessment", { accountId: selectedAccountId, instructions }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "capacity", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("draft outreach") || lower.includes("outreach")) {
    events.composing?.("Drafting outreach");
    const deliverable = await runAgent("outreach", { instructions }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: "work_queue", activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("weekly brief") || lower.includes("care about this week")) {
    events.composing?.("Composing weekly brief");
    const deliverable = await runAgent("weekly_memo", { title: "Weekly CRO Memo", instructions }, world);
    saveDeliverable(deliverable);
    setState({ brainResponse: response, activeTab: routeArea(response), activeDeliverable: deliverable, activeAnalysisSpec: null });
    result = { completion: "deliverable", response, deliverable };
  } else if (lower.includes("activity log") || lower.includes("saved to brain")) {
    setState({ activeTab: "settings", brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null });
    result = { completion: "activity", response: null, deliverable: null };
  } else {
    setState({ brainResponse: response, activeTab: routeArea(response), activeDeliverable: null, activeAnalysisSpec: null });
    result = { completion: "response", response, deliverable: null };
  }

  events.completed?.(result);
  return result;
}
