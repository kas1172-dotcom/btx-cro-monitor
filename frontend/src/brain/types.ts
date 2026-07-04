export type BrainArea =
  | "market"
  | "customer"
  | "capability"
  | "revenue"
  | "geographic"
  | "decision"
  | "workflow";

export const BRAIN_AREA_LABELS: Record<BrainArea, string> = {
  market: "Market",
  customer: "Accounts",
  capability: "Capability",
  revenue: "Revenue",
  geographic: "Geographic",
  decision: "Decision",
  workflow: "Workflow",
};

export interface ContextSource {
  source: string;
  reason: string;
}

export interface SavedBrainNote {
  title: string;
  brainArea: BrainArea;
  summary: string;
  entities: string[];
}

export interface ScoreBreakdownItem {
  label: string;
  value: number;
  note: string;
  positive: boolean;
}

export interface OpportunityCard {
  companyId: string;
  companyName: string;
  city: string;
  relationship: string;
  accountStatus?: string;
  opportunityScore: number;
  fitScore: number;
  whySurfaced: string;
  matchedCapabilities: string[];
  capabilityGaps: string[];
  topSignal?: string;
  confidence: "low" | "medium" | "high";
  recommendedAction: string;
  contactName?: string;
  contactTitle?: string;
  scoreBreakdown: ScoreBreakdownItem[];
}

export interface BrainResponse {
  question: string;
  directAnswer: string;
  whyThisMatters: string;
  activatedBrainAreas: BrainArea[];
  contextUsed: ContextSource[];
  recommendedActions: string[];
  savedNote: SavedBrainNote;
  suggestedNextQuestions: string[];
  relatedOpportunities: OpportunityCard[];
  confidence: "low" | "medium" | "high";
  focusView?: "map" | "signals" | "accounts" | "capabilities" | "brief";
}

export type QuestionIntent =
  | "market_signals"
  | "geographic_prospecting"
  | "account_risk"
  | "sales_focus"
  | "weekly_brief"
  | "capabilities"
  | "outreach"
  | "general";
