import type { BrainArea } from "../brain/types.ts";

export type DeliverableType =
  | "itinerary"
  | "meeting_brief"
  | "board_deck"
  | "weekly_memo"
  | "analysis_view"
  | "outreach"
  | "sales_pitch"
  | "capabilities_assessment";

export interface ProvenanceEntry {
  source: string;
  records: string[];
  reason: string;
}

export type DeliverableBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "chart-spec"; title: string; spec: Record<string, unknown> }
  | {
      kind: "map-ref";
      title: string;
      entityIds: string[];
      stops?: Array<{ entityId: string; label: string; day: number; lat: number; lon: number }>;
    };

export interface DeliverableSection {
  id: string;
  heading: string;
  blocks: DeliverableBlock[];
  audience?: "prospect" | "internal" | "board";
}

export interface DeliverableAction {
  id: string;
  label: string;
  kind: "copy" | "download_markdown" | "simulated_send" | "simulated_crm_task";
}

export interface Deliverable {
  id: string;
  type: DeliverableType;
  title: string;
  createdAt: string;
  brainArea: BrainArea;
  entityIds: string[];
  sections: DeliverableSection[];
  sources: ProvenanceEntry[];
  confidence: "low" | "medium" | "high";
  confidenceReason?: string;
  audience?: "prospect" | "internal" | "board";
  form?: "email" | "memo" | "brief" | "deck" | "itinerary" | "view" | "one_pager";
  compositionPath?: string;
  actions: DeliverableAction[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
