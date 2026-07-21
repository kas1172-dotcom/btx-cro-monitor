import type { AgentId } from "./runAgent.ts";

/**
 * The template catalog the deliverable wizard exposes. Each entry maps to a
 * registered deliverable agent; the wizard never invents templates of its own.
 */
export interface DeliverableTemplateOption {
  id: AgentId;
  label: string;
  description: string;
  requiresAccount: boolean;
  requiresQuarter?: boolean;
  defaultInstructions?: string;
}

export const DELIVERABLE_TEMPLATE_OPTIONS: DeliverableTemplateOption[] = [
  {
    id: "meeting_brief",
    label: "Meeting brief",
    description: "Prep notes, evidence, contacts, and next actions for a target account.",
    requiresAccount: true,
  },
  {
    id: "capabilities_assessment",
    label: "Capabilities one-pager",
    description: "A fit assessment of BTX capabilities against the account's demand.",
    requiresAccount: true,
  },
  {
    id: "outreach",
    label: "Outreach email",
    description: "A value-led email draft grounded in the strongest account evidence.",
    requiresAccount: true,
    defaultInstructions: "Keep it concise and tied to the strongest available evidence.",
  },
  {
    id: "sales_pitch",
    label: "Sales pitch",
    description: "A prospect-facing pitch with problem, evidence, and value framing.",
    requiresAccount: true,
  },
  {
    id: "board_deck",
    label: "Board deck",
    description: "Quarterly revenue review built from the metric catalog.",
    requiresAccount: false,
    requiresQuarter: true,
  },
  {
    id: "weekly_memo",
    label: "Newsletter memo",
    description: "An internal newsletter-style memo on what changed and where attention should go.",
    requiresAccount: false,
  },
  {
    id: "itinerary",
    label: "Field itinerary",
    description: "A calendar-ready market visit plan with map stops and per-stop talking points.",
    requiresAccount: false,
    defaultInstructions: "Keep the trip practical and prioritize validated account context.",
  },
  {
    id: "analysis_annotation",
    label: "Analysis figure",
    description: "A saved analysis annotation with a figure spec for spreadsheet, PDF, and CSV export.",
    requiresAccount: false,
    requiresQuarter: true,
  },
];

export function deliverableTemplateOption(id: AgentId): DeliverableTemplateOption {
  const option = DELIVERABLE_TEMPLATE_OPTIONS.find((item) => item.id === id);
  if (!option) throw new Error(`Unknown deliverable template ${id}`);
  return option;
}
