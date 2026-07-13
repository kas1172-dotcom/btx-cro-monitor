import type { AgentId } from "./runAgent.ts";

export type WizardMode = "single" | "multi-select" | "insert-into-existing";

export interface DeliverableAgentOption {
  id: AgentId;
  label: string;
  description: string;
  requiresAccount?: boolean;
  requiresTrip?: boolean;
  requiresQuarter?: boolean;
  requiresMetric?: boolean;
  defaultInstructions?: string;
}

export const DELIVERABLE_AGENT_OPTIONS: DeliverableAgentOption[] = [
  {
    id: "meeting_brief",
    label: "Meeting brief",
    description: "Prep notes, evidence, contacts, and next actions for a target account.",
    requiresAccount: true,
  },
  {
    id: "weekly_memo",
    label: "Weekly memo",
    description: "A concise internal memo on what changed and where attention should go.",
  },
  {
    id: "board_deck",
    label: "Board deck",
    description: "Quarterly revenue review built from the metric catalog.",
    requiresQuarter: true,
  },
  {
    id: "itinerary",
    label: "Itinerary",
    description: "A field visit plan with stops, routing notes, and outreach drafts.",
    requiresTrip: true,
  },
  {
    id: "outreach",
    label: "Outreach",
    description: "A value-led email draft grounded in the strongest account evidence.",
    requiresAccount: true,
    defaultInstructions: "Keep it concise and tied to the strongest available evidence.",
  },
  {
    id: "analysis_annotation",
    label: "Analysis view",
    description: "A short narrative annotation for a metric and quarter.",
    requiresMetric: true,
    requiresQuarter: true,
  },
  {
    id: "sales_pitch",
    label: "Sales pitch",
    description: "A prospect-facing pitch with problem, evidence, and value framing.",
    requiresAccount: true,
  },
  {
    id: "capabilities_assessment",
    label: "Capabilities assessment",
    description: "A fit assessment for BTX capabilities against account demand.",
    requiresAccount: true,
  },
];

export const ASK_DELIVERABLE_ACTIONS: Record<string, AgentId> = {
  "Meeting brief": "meeting_brief",
  "Sales pitch": "sales_pitch",
  "Capabilities assessment": "capabilities_assessment",
};

export function deliverableOption(id: AgentId): DeliverableAgentOption {
  const option = DELIVERABLE_AGENT_OPTIONS.find((item) => item.id === id);
  if (!option) throw new Error(`Unknown deliverable agent ${id}`);
  return option;
}
